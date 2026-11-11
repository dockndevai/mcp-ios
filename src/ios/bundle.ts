/**
 * Read the identity (bundle ID, version, build) of an app bundle on this computer so the human who
 * is asked to approve `install_app` sees WHAT will be installed, not just a path. Read-only; no
 * shell is involved (the zip is parsed in-process, `plutil` is run with an argument array).
 *
 * Everything returned here is displayed in the approval prompt and comes from a file the agent may
 * have chosen, so values are validated/sanitised: an unparseable or odd value is dropped, never shown raw.
 */
import { execFile } from "node:child_process";
import { open, readFile, stat } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

export interface BundleInfo {
  kind: "app" | "ipa" | "other";
  bundleId?: string;
  version?: string;
  build?: string;
}

const MAX_PLIST = 4 * 1024 * 1024;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;

function cleanVersion(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[^\x20-\x7e]/g, "").trim();
  return s && s.length <= 64 ? s : undefined;
}

function fromDict(d: Record<string, unknown>): Omit<BundleInfo, "kind"> {
  const id = typeof d.CFBundleIdentifier === "string" && BUNDLE_ID.test(d.CFBundleIdentifier) ? d.CFBundleIdentifier : undefined;
  return { bundleId: id, version: cleanVersion(d.CFBundleShortVersionString), build: cleanVersion(d.CFBundleVersion) };
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

/** The three keys we need from an XML property list (top-level string values only). */
function parseXmlPlist(xml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]) {
    const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
    if (m) out[key] = m[1].replace(/&(amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]);
  }
  return out;
}

/** Binary plists (the usual form inside real builds) need Apple's `plutil`; absent elsewhere, we just show less. */
function binaryPlistToDict(buf: Buffer): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const child = execFile("plutil", ["-convert", "json", "-o", "-", "-"], { timeout: 10_000, maxBuffer: MAX_PLIST }, (err, stdout) => {
      if (err) return resolve(undefined);
      try {
        const v = JSON.parse(stdout);
        resolve(v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(buf);
  });
}

async function parsePlist(buf: Buffer): Promise<Omit<BundleInfo, "kind">> {
  if (buf.subarray(0, 6).toString("latin1") === "bplist") {
    const d = await binaryPlistToDict(buf);
    return d ? fromDict(d) : {};
  }
  return fromDict(parseXmlPlist(buf.toString("utf8")));
}

/** `Payload/<Name>.app/Info.plist` — the app's own plist, not a nested framework's. */
const IPA_INFO = /^Payload\/[^/]+\.app\/Info\.plist$/;

/** Extract one entry from a zip without touching the filesystem. Returns undefined for anything unusual (zip64, too big, no match). */
export async function readZipEntry(path: string, match: RegExp): Promise<Buffer | undefined> {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, 0xffff + 22);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return undefined;
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (tail.readUInt16LE(eocd + 10) === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return undefined; // zip64
    if (cdSize > 64 * 1024 * 1024 || cdOffset + cdSize > size) return undefined;
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (!match.test(name)) continue;
      if (compSize === 0xffffffff || localOffset === 0xffffffff || compSize > MAX_PLIST) return undefined;
      const local = Buffer.alloc(30);
      await fh.read(local, 0, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) return undefined;
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const data = Buffer.alloc(compSize);
      await fh.read(data, 0, compSize, dataStart);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PLIST });
      return undefined;
    }
    return undefined;
  } finally {
    await fh.close();
  }
}

/**
 * Identify the app at `path` (a `.app` directory or an `.ipa`). Best effort: a bundle we can read but
 * not parse yields `{ kind }` alone. A path that does not exist throws (with the underlying `code`).
 */
export async function inspectBundle(path: string): Promise<BundleInfo> {
  const s = await stat(path);
  try {
    if (s.isDirectory()) {
      const plist = await readFile(`${path}/Info.plist`);
      return { kind: "app", ...(plist.length <= MAX_PLIST ? await parsePlist(plist) : {}) };
    }
    const entry = await readZipEntry(path, IPA_INFO);
    return { kind: "ipa", ...(entry ? await parsePlist(entry) : {}) };
  } catch {
    return { kind: s.isDirectory() ? "app" : "other" };
  }
}
