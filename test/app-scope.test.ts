import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { IosClient } from "../src/ios/client.js";
import { buildServer } from "../src/server.js";

interface Opts {
  allowlist?: string[];
  protectedApps?: string[];
  dryRun?: boolean;
  extraUrlSchemes?: string[];
}

const config = (o: Opts): AppConfig => ({
  connection: { appiumUrl: "http://127.0.0.1:1", timeout: 1000, extraUrlSchemes: o.extraUrlSchemes },
  security: {
    mode: "admin",
    appAllowlist: o.allowlist ?? [],
    protectedApps: o.protectedApps ?? ["com.apple.Preferences", "com.apple.springboard"],
    allowManage: true,
    dryRun: o.dryRun ?? false,
    auditLog: false,
    requireHumanApproval: false,
  },
});

async function connect(o: Opts = {}) {
  const { server } = buildServer(config(o));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    prompts.push(req.params.message);
    return { action: "accept", content: { confirm: true } };
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

const plist = (id: string | null) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
${id === null ? "" : `<key>CFBundleIdentifier</key><string>${id}</string>`}
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>`;

const root = mkdtempSync(join(tmpdir(), "mcp-ios-scope-"));
const bundles: Record<string, string> = {};
beforeAll(() => {
  for (const [name, id] of [["Demo", "com.example.demo"], ["Unreadable", null]] as const) {
    const dir = join(root, `${name}.app`);
    mkdirSync(dir);
    writeFileSync(join(dir, "Info.plist"), plist(id));
    bundles[name] = dir;
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

function stubInstall() {
  vi.spyOn(IosClient.prototype, "deviceIdentity").mockResolvedValue("UDID-1|18.1");
  vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue(undefined);
  return vi.spyOn(IosClient.prototype, "installApp").mockResolvedValue();
}

describe("install_app honours IOS_APP_ALLOWLIST / IOS_PROTECTED_APPS using the bundle ID read from the bundle", () => {
  it("refuses, before any prompt, a bundle whose ID is not in the allowlist", async () => {
    const install = stubInstall();
    const { client, prompts } = await connect({ allowlist: ["com.example.other"] });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Demo } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/com\.example\.demo.*allowlist/);
    expect(prompts).toHaveLength(0);
    expect(install).not.toHaveBeenCalled();
  });

  it("installs a bundle whose ID is in the allowlist (after the prompt)", async () => {
    const install = stubInstall();
    const { client, prompts } = await connect({ allowlist: ["com.example.demo"] });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Demo } });
    expect(res.isError).toBeFalsy();
    expect(prompts).toHaveLength(1);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("refuses a bundle whose ID is a protected app (installing replaces it)", async () => {
    const install = stubInstall();
    const { client, prompts } = await connect({ protectedApps: ["com.example.demo"] });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Demo } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/protected/);
    expect(prompts).toHaveLength(0);
    expect(install).not.toHaveBeenCalled();
  });

  it("fails closed when the bundle ID cannot be read and an allowlist is configured", async () => {
    const install = stubInstall();
    const { client, prompts } = await connect({ allowlist: ["com.example.demo"] });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Unreadable } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/Cannot tell which app 'install_app' targets/);
    expect(prompts).toHaveLength(0);
    expect(install).not.toHaveBeenCalled();
  });

  it("fails closed when the bundle ID cannot be read and the protected list is non-empty (the default)", async () => {
    const install = stubInstall();
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Unreadable } });
    expect(res.isError).toBe(true);
    expect(prompts).toHaveLength(0);
    expect(install).not.toHaveBeenCalled();
  });

  it("with no allowlist and no protected apps there is no scope to enforce: an unreadable ID still goes to the human", async () => {
    const install = stubInstall();
    const { client, prompts } = await connect({ protectedApps: [] });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Unreadable } });
    expect(res.isError).toBeFalsy();
    expect(prompts).toHaveLength(1);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("enforces the scope in dry-run too (dry-run must not report a refused install as 'would install')", async () => {
    const install = stubInstall();
    const { client } = await connect({ allowlist: ["com.example.other"], dryRun: true });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: bundles.Demo } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/allowlist/);
    expect(install).not.toHaveBeenCalled();
  });
});

describe("open_url scheme allowlist", () => {
  const refused = [
    "shortcuts://run-shortcut?name=x",
    "prefs:root=General",
    "App-Prefs:root=Privacy",
    "itms-services://?action=download-manifest&url=https://evil.example/m.plist",
    "myapp://do/something",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hi",
    "not a url",
    " shortcuts://run-shortcut?name=x",
    "https://example.com/\nshortcuts://x",
    "https://example.com/\u0000",
  ];
  for (const url of refused) {
    it(`refuses ${JSON.stringify(url)} without touching the device (also in dry-run)`, async () => {
      const open = vi.spyOn(IosClient.prototype, "openUrl").mockResolvedValue();
      for (const dryRun of [false, true]) {
        const { client } = await connect({ dryRun });
        const res = await client.callTool({ name: "open_url", arguments: { url } });
        expect(res.isError).toBe(true);
        expect(text(res)).not.toContain("[dry-run]");
      }
      expect(open).not.toHaveBeenCalled();
    });
  }

  for (const url of ["https://example.com/a?b=c", "HTTP://example.com", "tel:+15551234567", "mailto:a@example.com", "facetime:a@example.com", "maps://?q=coffee"]) {
    it(`allows ${url}`, async () => {
      const open = vi.spyOn(IosClient.prototype, "openUrl").mockResolvedValue();
      const { client } = await connect();
      const res = await client.callTool({ name: "open_url", arguments: { url } });
      expect(res.isError).toBeFalsy();
      expect(open).toHaveBeenCalledWith(url);
    });
  }

  it("dry-run of an allowed URL still previews", async () => {
    const open = vi.spyOn(IosClient.prototype, "openUrl").mockResolvedValue();
    const { client } = await connect({ dryRun: true });
    const res = await client.callTool({ name: "open_url", arguments: { url: "https://example.com" } });
    expect(text(res)).toContain("[dry-run] Would open");
    expect(open).not.toHaveBeenCalled();
  });

  it("IOS_EXTRA_URL_SCHEMES opens extra schemes (case-insensitive) and only those", async () => {
    const open = vi.spyOn(IosClient.prototype, "openUrl").mockResolvedValue();
    const { client } = await connect({ extraUrlSchemes: ["myapp"] });
    const ok = await client.callTool({ name: "open_url", arguments: { url: "MyApp://do/something" } });
    expect(ok.isError).toBeFalsy();
    expect(open).toHaveBeenCalledTimes(1);
    const no = await client.callTool({ name: "open_url", arguments: { url: "shortcuts://run-shortcut?name=x" } });
    expect(no.isError).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("the client itself also refuses a disallowed scheme (no session is created)", async () => {
    const c = new IosClient({ appiumUrl: "http://127.0.0.1:1", timeout: 1000 });
    await expect(c.openUrl("shortcuts://run-shortcut?name=x")).rejects.toThrow(/Refused URL scheme 'shortcuts:'/);
  });
});

describe("IOS_APP_ALLOWLIST also scopes the apps open_url / run_shortcut drive", () => {
  it("run_shortcut is refused when com.apple.shortcuts is not allowlisted, allowed when it is", async () => {
    const run = vi.spyOn(IosClient.prototype, "runShortcut").mockResolvedValue();
    const denied = await (await connect({ allowlist: ["com.example.demo"] })).client.callTool({ name: "run_shortcut", arguments: { name: "Wipe" } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/com\.apple\.shortcuts.*allowlist/);
    expect(run).not.toHaveBeenCalled();
    const ok = await (await connect({ allowlist: ["com.apple.shortcuts"] })).client.callTool({ name: "run_shortcut", arguments: { name: "Wipe" } });
    expect(ok.isError).toBeFalsy();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("open_url is refused when the stock handler for its scheme is not allowlisted", async () => {
    const open = vi.spyOn(IosClient.prototype, "openUrl").mockResolvedValue();
    const denied = await (await connect({ allowlist: ["com.example.demo"] })).client.callTool({ name: "open_url", arguments: { url: "https://example.com" } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/com\.apple\.mobilesafari.*allowlist/);
    expect(open).not.toHaveBeenCalled();
    const ok = await (await connect({ allowlist: ["com.apple.mobilesafari"] })).client.callTool({ name: "open_url", arguments: { url: "https://example.com" } });
    expect(ok.isError).toBeFalsy();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("an extra scheme (handler unknown) is refused while an allowlist is configured", async () => {
    const open = vi.spyOn(IosClient.prototype, "openUrl").mockResolvedValue();
    const { client } = await connect({ allowlist: ["com.apple.mobilesafari"], extraUrlSchemes: ["myapp"] });
    const res = await client.callTool({ name: "open_url", arguments: { url: "myapp://x" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/IOS_APP_ALLOWLIST/);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("IOS_EXTRA_URL_SCHEMES parsing", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is read from the environment, lower-cased; an invalid scheme fails startup", () => {
    vi.stubEnv("IOS_EXTRA_URL_SCHEMES", "MyApp, other+x");
    expect(loadConfig().connection.extraUrlSchemes).toEqual(["myapp", "other+x"]);
    vi.stubEnv("IOS_EXTRA_URL_SCHEMES", "bad scheme");
    expect(() => loadConfig()).toThrow(/Invalid URL scheme/);
    vi.stubEnv("IOS_EXTRA_URL_SCHEMES", "");
    expect(loadConfig().connection.extraUrlSchemes).toEqual([]);
  });
});
