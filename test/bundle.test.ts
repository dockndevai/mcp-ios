import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it, vi } from "vitest";
import { inspectBundle } from "../src/ios/bundle.js";
import { IosClient } from "../src/ios/client.js";

const root = mkdtempSync(join(tmpdir(), "mcp-ios-bundle-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const plist = (id: string, v = "1.2.3", b = "45") =>
  `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>x</string>` +
  `<key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${v}</string>` +
  `<key>CFBundleVersion</key><string>${b}</string></dict></plist>`;

/** Minimal zip writer (stored or deflated entries) — enough to exercise the in-process reader. */
function zip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function appDirWith(name: string, info: string | Buffer): string {
  const d = join(root, name);
  mkdirSync(d);
  writeFileSync(join(d, "Info.plist"), info);
  return d;
}

describe("inspectBundle", () => {
  it("reads a .app directory", async () => {
    expect(await inspectBundle(appDirWith("A.app", plist("com.example.a")))).toEqual({
      kind: "app", bundleId: "com.example.a", version: "1.2.3", build: "45",
    });
  });

  it("reads an .ipa (stored and deflated) and ignores nested frameworks' Info.plist", async () => {
    for (const deflate of [false, true]) {
      const f = join(root, `x${deflate}.ipa`);
      writeFileSync(
        f,
        zip([
          { name: "Payload/Demo.app/Frameworks/Evil.framework/Info.plist", data: Buffer.from(plist("com.evil.framework")), deflate },
          { name: "Payload/Demo.app/Info.plist", data: Buffer.from(plist("com.example.ipa", "9.0", "9")), deflate },
          { name: "Payload/Demo.app/Demo", data: Buffer.from("binary"), deflate },
        ]),
      );
      expect(await inspectBundle(f)).toEqual({ kind: "ipa", bundleId: "com.example.ipa", version: "9.0", build: "9" });
    }
  });

  it("decodes XML entities and drops values that are not safe to show in a prompt", async () => {
    const ok = await inspectBundle(appDirWith("B.app", plist("com.example.b", "1 &amp; 2", "1")));
    expect(ok.version).toBe("1 & 2");
    const hostile = await inspectBundle(appDirWith("C.app", plist("com.x\n  • replaces the installed app: no", "1\n2‮", "x".repeat(200))));
    expect(hostile.bundleId).toBeUndefined();
    expect(hostile.version).toBe("12"); // control / bidi-override characters stripped
    expect(hostile.build).toBeUndefined(); // over-long
  });

  it("returns just the kind for garbage, a truncated zip, or a missing plist, and never throws on them", async () => {
    const junk = join(root, "junk.ipa");
    writeFileSync(junk, "not a zip");
    expect(await inspectBundle(junk)).toEqual({ kind: "ipa" });
    const trunc = join(root, "trunc.ipa");
    writeFileSync(trunc, zip([{ name: "Payload/D.app/Info.plist", data: Buffer.from(plist("com.x")) }]).subarray(0, 60));
    expect(await inspectBundle(trunc)).toEqual({ kind: "ipa" });
    const empty = join(root, "E.app");
    mkdirSync(empty);
    expect(await inspectBundle(empty)).toEqual({ kind: "app" });
  });

  it("throws ENOENT for a path that does not exist", async () => {
    await expect(inspectBundle(join(root, "missing.ipa"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform !== "darwin")("reads a binary plist (the form real builds use) via plutil", async () => {
    const xml = join(root, "bin.xml");
    writeFileSync(xml, plist("com.example.bin", "7.7", "77"));
    execFileSync("plutil", ["-convert", "binary1", xml]);
    const { readFileSync } = await import("node:fs");
    const d = appDirWith("F.app", readFileSync(xml));
    expect(await inspectBundle(d)).toEqual({ kind: "app", bundleId: "com.example.bin", version: "7.7", build: "77" });
  });
});

describe("IosClient install helpers", () => {
  const client = () => new IosClient({ appiumUrl: "http://127.0.0.1:1", timeout: 1000 });

  it("resolveAppPath makes paths absolute and refuses URLs", () => {
    expect(client().resolveAppPath("rel/App.ipa")).toBe(join(process.cwd(), "rel/App.ipa"));
    for (const u of ["https://evil.example/a.ipa", "http://x/a.ipa", "ftp://x/a.ipa", "file:///tmp/a.ipa"]) {
      expect(() => client().resolveAppPath(u)).toThrow(/local/);
    }
  });

  it("bundleVersion tracks size/mtime/inode and the device; undefined when missing", async () => {
    const c = client();
    vi.spyOn(c, "deviceIdentity").mockResolvedValue("U1|18");
    const f = join(root, "v.ipa");
    expect(await c.bundleVersion(f)).toBeUndefined();
    writeFileSync(f, "one");
    utimesSync(f, 1000, 1000);
    const v1 = await c.bundleVersion(f);
    expect(v1).toMatch(/^3B mtime=1000000 ino=\d+ #[0-9a-f]{8}$/);
    expect(await c.bundleVersion(f)).toBe(v1);
    writeFileSync(f, "three");
    utimesSync(f, 2000, 2000);
    expect(await c.bundleVersion(f)).not.toBe(v1);
    vi.spyOn(c, "deviceIdentity").mockResolvedValue("U2|18");
    writeFileSync(f, "one");
    utimesSync(f, 1000, 1000);
    expect(await c.bundleVersion(f)).not.toBe(v1);
  });
});
