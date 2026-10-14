import { describe, expect, it } from "vitest";
import { PolicyError, SecurityPolicy, type SecurityConfig } from "../src/security.js";

function makePolicy(o: Partial<SecurityConfig> = {}): SecurityPolicy {
  return new SecurityPolicy({
    mode: "read-only",
    appAllowlist: [],
    protectedApps: ["com.apple.Preferences"],
    allowManage: false,
    dryRun: false,
    auditLog: false,
    ...o,
  });
}

describe("capability gating", () => {
  it("read-only enables read only", () => {
    const p = makePolicy();
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
  it("read-write enables read + write but not admin", () => {
    const p = makePolicy({ mode: "read-write" });
    expect(p.isCapabilityEnabled("write")).toBe(true);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
  it("rejects tap in read-only", () => {
    expect(() => makePolicy().guard({ tool: "tap", capability: "write" })).toThrow(PolicyError);
  });
});

describe("app allowlist + protection", () => {
  it("blocks apps outside allowlist", () => {
    const p = makePolicy({ mode: "read-write", appAllowlist: ["com.app"] });
    expect(() => p.guard({ tool: "launch_app", capability: "write", bundleId: "com.other" })).toThrow(/allowlist/);
  });
  it("allows allowlisted apps", () => {
    const p = makePolicy({ mode: "read-write", appAllowlist: ["com.app"] });
    expect(p.guard({ tool: "launch_app", capability: "write", bundleId: "com.app" }).dryRun).toBe(false);
  });
  it("refuses terminating a protected app", () => {
    const p = makePolicy({ mode: "admin", allowManage: true });
    expect(() =>
      p.guard({ tool: "terminate_app", capability: "admin", bundleId: "com.apple.Preferences", destructive: true, requiresManage: true }),
    ).toThrow(/protected/);
  });
});

describe("manage gating", () => {
  it("blocks install without IOS_ALLOW_MANAGE", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() => p.guard({ tool: "install_app", capability: "admin", requiresManage: true })).toThrow(/ALLOW_MANAGE/);
  });
  it("blocks reset without IOS_ALLOW_MANAGE", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() =>
      p.guard({ tool: "reset_app", capability: "admin", bundleId: "com.app", destructive: true, requiresManage: true }),
    ).toThrow(/ALLOW_MANAGE/);
  });
  it("manageEnabled needs both admin and the flag", () => {
    expect(makePolicy({ mode: "admin", allowManage: false }).manageEnabled).toBe(false);
    expect(makePolicy({ mode: "read-write", allowManage: true }).manageEnabled).toBe(false);
    expect(makePolicy({ mode: "admin", allowManage: true }).manageEnabled).toBe(true);
  });
  it("allows managed admin ops when admin + flag", () => {
    const p = makePolicy({ mode: "admin", allowManage: true });
    expect(p.guard({ tool: "install_app", capability: "admin", requiresManage: true }).dryRun).toBe(false);
  });
});

describe("dry run", () => {
  it("flags writes but not reads", () => {
    const p = makePolicy({ mode: "read-write", dryRun: true });
    expect(p.guard({ tool: "screenshot", capability: "read" }).dryRun).toBe(false);
    expect(p.guard({ tool: "tap", capability: "write" }).dryRun).toBe(true);
  });
});
