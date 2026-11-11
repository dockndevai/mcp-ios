import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../src/config.js";
import { IosClient } from "../src/ios/client.js";
import { buildServer } from "../src/server.js";

const config = (requireHumanApproval = false): AppConfig => ({
  connection: { appiumUrl: "http://127.0.0.1:1", timeout: 1000 },
  security: {
    mode: "admin",
    appAllowlist: [],
    protectedApps: ["com.apple.Preferences"],
    allowManage: true,
    dryRun: false,
    auditLog: false,
    requireHumanApproval,
  },
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

/** Connect an in-memory MCP client (optionally able to answer elicitation) to a freshly built server. */
async function connect(opts: { requireHuman?: boolean; answer?: (message: string) => Answer | Promise<Answer>; elicits?: boolean }) {
  const { server } = buildServer(config(opts.requireHuman));
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

afterEach(() => vi.restoreAllMocks());

describe("terminate_app approval (end to end)", () => {
  it("shows the tool, full arguments, version and fingerprint, then terminates", async () => {
    vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue("2.4.1 (812) #ab12cd34");
    const terminate = vi.spyOn(IosClient.prototype, "terminateApp").mockResolvedValue(true);
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "terminate_app", arguments: { bundleId: "com.example.app" } });
    expect(text(res)).toContain('"terminated": "com.example.app"');
    expect(terminate).toHaveBeenCalledWith("com.example.app");
    expect(prompts[0]).toContain("tool: terminate_app");
    expect(prompts[0]).toContain('{"bundleId":"com.example.app"}');
    expect(prompts[0]).toContain("resource version: 2.4.1 (812) #ab12cd34");
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("does NOT terminate when the app was updated while the human was deciding", async () => {
    const versions = ["2.4.1 (812) #aaaa", "2.5.0 (900) #aaaa"];
    vi.spyOn(IosClient.prototype, "appVersion").mockImplementation(async () => versions.shift());
    const terminate = vi.spyOn(IosClient.prototype, "terminateApp").mockResolvedValue(true);
    const { client } = await connect({});
    const res = await client.callTool({ name: "terminate_app", arguments: { bundleId: "com.example.app" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(terminate).not.toHaveBeenCalled();
  });

  it("does NOT terminate when the human declines", async () => {
    vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue("v1");
    const terminate = vi.spyOn(IosClient.prototype, "terminateApp").mockResolvedValue(true);
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    await client.callTool({ name: "terminate_app", arguments: { bundleId: "com.example.app" } });
    expect(terminate).not.toHaveBeenCalled();
  });
});

describe("reset_app approval (end to end)", () => {
  it("proceeds when the version is stable", async () => {
    vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue("v1");
    const reset = vi.spyOn(IosClient.prototype, "resetApp").mockResolvedValue();
    const { client, prompts } = await connect({});
    await client.callTool({ name: "reset_app", arguments: { bundleId: "com.example.app" } });
    expect(reset).toHaveBeenCalledWith("com.example.app");
    expect(prompts[0]).toContain("tool: reset_app");
  });

  it("does NOT reset when the app version changed", async () => {
    const versions = ["v1", "v2"];
    vi.spyOn(IosClient.prototype, "appVersion").mockImplementation(async () => versions.shift());
    const reset = vi.spyOn(IosClient.prototype, "resetApp").mockResolvedValue();
    const { client } = await connect({});
    const res = await client.callTool({ name: "reset_app", arguments: { bundleId: "com.example.app" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(reset).not.toHaveBeenCalled();
  });
});

describe("IOS_REQUIRE_HUMAN_APPROVAL", () => {
  it("falls back to the flags when the client cannot elicit (default)", async () => {
    vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue("v1");
    const terminate = vi.spyOn(IosClient.prototype, "terminateApp").mockResolvedValue(true);
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "terminate_app", arguments: { bundleId: "com.example.app" } });
    expect(terminate).toHaveBeenCalledWith("com.example.app");
  });

  it("refuses when the client cannot elicit and human approval is required", async () => {
    vi.spyOn(IosClient.prototype, "appVersion").mockResolvedValue("v1");
    const terminate = vi.spyOn(IosClient.prototype, "terminateApp").mockResolvedValue(true);
    const reset = vi.spyOn(IosClient.prototype, "resetApp").mockResolvedValue();
    const { client, prompts } = await connect({ elicits: false, requireHuman: true });
    const a = await client.callTool({ name: "terminate_app", arguments: { bundleId: "com.example.app" } });
    const b = await client.callTool({ name: "reset_app", arguments: { bundleId: "com.example.app" } });
    expect(text(a)).toContain("no human approval channel");
    expect(text(b)).toContain("no human approval channel");
    expect(terminate).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
  });
});

describe("version tokens (appVersion / deviceIdentity)", () => {
  type Exec = (script: string, args?: Record<string, unknown>) => Promise<unknown>;

  function clientWith(opts: { exec: Exec; caps?: Record<string, unknown>; udid?: string }) {
    const c = new IosClient({ appiumUrl: "http://127.0.0.1:1", timeout: 1000, udid: opts.udid });
    (c as unknown as { driver: unknown }).driver = {
      capabilities: opts.caps ?? { udid: "UDID-1", platformVersion: "18.1" },
      execute: opts.exec,
    };
    return c;
  }
  const listApps =
    (user: Record<string, unknown>, system: Record<string, unknown> = {}): Exec =>
    async (script, args) =>
      script === "mobile: listApps" ? (args?.applicationType === "System" ? system : user) : undefined;

  it("is readable, stable across calls, and tracks the installed version", async () => {
    const mk = (v: string, b: string) =>
      clientWith({ exec: listApps({ "com.example.app": { CFBundleShortVersionString: v, CFBundleVersion: b } }) });
    const a = await mk("2.4.1", "812").appVersion("com.example.app");
    expect(a).toMatch(/^2\.4\.1 \(812\) #[0-9a-f]{8}$/);
    expect(await mk("2.4.1", "812").appVersion("com.example.app")).toBe(a);
    expect(await mk("2.5.0", "900").appVersion("com.example.app")).not.toBe(a);
  });

  it("changes when a different device is attached; finds system apps; undefined when not installed", async () => {
    const user = { "com.example.app": { CFBundleShortVersionString: "1", CFBundleVersion: "1" } };
    const base = await clientWith({ exec: listApps(user) }).appVersion("com.example.app");
    const other = await clientWith({ exec: listApps(user), caps: { udid: "UDID-2", platformVersion: "18.1" } }).appVersion("com.example.app");
    expect(other).not.toBe(base);
    const sys = clientWith({ exec: listApps(user, { "com.apple.mobilesafari": { CFBundleShortVersionString: "18.1", CFBundleVersion: "1" } }) });
    expect(await sys.appVersion("com.apple.mobilesafari")).toMatch(/^18\.1 \(1\) #/);
    expect(await sys.appVersion("com.nope")).toBeUndefined();
  });

  it("degrades to the device identity (and says so) when the WDA build cannot list apps", async () => {
    const c = clientWith({
      exec: async () => {
        throw new Error("unknown command");
      },
    });
    expect(await c.appVersion("com.example.app")).toMatch(/^version-unavailable #[0-9a-f]{8}$/);
  });

  it("deviceIdentity reads udid/platformVersion from session capabilities (with or without the appium: prefix)", async () => {
    expect(await clientWith({ exec: listApps({}) }).deviceIdentity()).toBe("UDID-1|18.1");
    expect(
      await clientWith({ exec: listApps({}), caps: { "appium:udid": "U9", "appium:platformVersion": "17.5" } }).deviceIdentity(),
    ).toBe("U9|17.5");
    expect(await clientWith({ exec: listApps({}), caps: {}, udid: "CFG" }).deviceIdentity()).toBe("CFG|?");
  });
});
