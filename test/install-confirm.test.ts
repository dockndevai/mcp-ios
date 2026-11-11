import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../src/config.js";
import { IosClient } from "../src/ios/client.js";
import { buildServer } from "../src/server.js";

const config = (o: { requireHumanApproval?: boolean; dryRun?: boolean } = {}): AppConfig => ({
  connection: { appiumUrl: "http://127.0.0.1:1", timeout: 1000 },
  security: {
    mode: "admin",
    appAllowlist: [],
    protectedApps: ["com.apple.Preferences"],
    allowManage: true,
    dryRun: o.dryRun ?? false,
    auditLog: false,
    requireHumanApproval: o.requireHumanApproval ?? false,
  },
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

async function connect(opts: { requireHuman?: boolean; dryRun?: boolean; answer?: (message: string) => Answer | Promise<Answer>; elicits?: boolean }) {
  const { server } = buildServer(config({ requireHumanApproval: opts.requireHuman, dryRun: opts.dryRun }));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return (await opts.answer?.(req.params.message)) ?? { action: "accept", content: { confirm: true } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

const INFO_PLIST = (id: string, v: string, b: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>${v}</string>
<key>CFBundleVersion</key><string>${b}</string>
</dict></plist>`;

const root = mkdtempSync(join(tmpdir(), "mcp-ios-install-"));
let appDir: string;
beforeAll(() => {
  appDir = join(root, "Demo.app");
  mkdirSync(appDir);
  writeFileSync(join(appDir, "Info.plist"), INFO_PLIST("com.example.demo", "3.1.0", "310"));
  utimesSync(appDir, 1_700_000_000, 1_700_000_000);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

function stubDevice(installed: string | null = "3.0.0 (300) #ab12cd34") {
  vi.spyOn(IosClient.prototype, "deviceIdentity").mockResolvedValue("UDID-1|18.1");
  vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue(installed ?? undefined);
  return vi.spyOn(IosClient.prototype, "installApp").mockResolvedValue();
}

describe("install_app approval (end to end)", () => {
  it("asks the human first, showing the bundle path, app, device and that it replaces an installed app", async () => {
    const install = stubDevice();
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(prompts).toHaveLength(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(text(res)).toContain("installed");
    const p = prompts[0];
    expect(p).toContain("tool: install_app");
    expect(p).toContain(`"appPath":${JSON.stringify(appDir)}`);
    expect(p).toContain(`bundle path: ${appDir}`);
    expect(p).toContain("com.example.demo");
    expect(p).toContain("3.1.0 (310)");
    expect(p).toContain("device: UDID-1|18.1");
    expect(p).toMatch(/replaces the installed app: yes.*3\.0\.0 \(300\)/);
    expect(p).toMatch(/resource version: \d+B mtime=\d+ ino=\d+ #[0-9a-f]{8}/);
    expect(p).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("says when it is a fresh install and when that cannot be determined", async () => {
    stubDevice(null);
    const a = await connect({});
    await a.client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(a.prompts[0]).toMatch(/replaces the installed app: no/);
    vi.restoreAllMocks();
    stubDevice("version-unavailable #deadbeef");
    const b = await connect({});
    await b.client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(b.prompts[0]).toMatch(/replaces the installed app: yes/);
    expect(b.prompts[0]).toContain("version unavailable");
  });

  it("does NOT install when the human declines", async () => {
    const install = stubDevice();
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(install).not.toHaveBeenCalled();
    expect(text(res)).toContain("declined by the user");
  });

  it("does NOT install when the bundle changed while the human was deciding", async () => {
    const install = stubDevice();
    const { client } = await connect({
      answer: () => {
        writeFileSync(join(appDir, "extra-file"), "new content"); // changes the bundle directory's mtime
        utimesSync(appDir, 1_700_000_500, 1_700_000_500);
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(install).not.toHaveBeenCalled();
    rmSync(join(appDir, "extra-file"));
    utimesSync(appDir, 1_700_000_000, 1_700_000_000);
  });

  it("dry-run returns before the prompt (nothing asked, nothing read from the device)", async () => {
    const install = stubDevice();
    const { client, prompts } = await connect({ dryRun: true });
    const res = await client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(text(res)).toContain("[dry-run] Would install");
    expect(prompts).toHaveLength(0);
    expect(install).not.toHaveBeenCalled();
    expect(IosClient.prototype.appVersion).not.toHaveBeenCalled();
  });

  it("IOS_REQUIRE_HUMAN_APPROVAL refuses without elicitation; the default falls back to the flags", async () => {
    const install = stubDevice();
    const strict = await connect({ elicits: false, requireHuman: true });
    const res = await strict.client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(text(res)).toContain("no human approval channel");
    expect(install).not.toHaveBeenCalled();
    const lax = await connect({ elicits: false });
    await lax.client.callTool({ name: "install_app", arguments: { appPath: appDir } });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("refuses (before any prompt) a path that does not exist, and a remote URL", async () => {
    const install = stubDevice();
    const { client, prompts } = await connect({});
    const missing = await client.callTool({ name: "install_app", arguments: { appPath: join(root, "nope.ipa") } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/not found/i);
    const url = await client.callTool({ name: "install_app", arguments: { appPath: "https://evil.example/app.ipa" } });
    expect(url.isError).toBe(true);
    expect(text(url)).toMatch(/local/i);
    expect(prompts).toHaveLength(0);
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the absolute path that was shown, not a different relative one", async () => {
    const install = stubDevice();
    const { client, prompts } = await connect({});
    const cwd = process.cwd();
    process.chdir(root);
    try {
      await client.callTool({ name: "install_app", arguments: { appPath: "./Demo.app" } });
    } finally {
      process.chdir(cwd);
    }
    expect(install).toHaveBeenCalledWith(expect.stringMatching(/Demo\.app$/));
    const arg = install.mock.calls[0][0] as string;
    expect(arg.startsWith("/")).toBe(true);
    expect(prompts[0]).toContain(`bundle path: ${arg}`);
  });
});
