import { describe, expect, it } from "vitest";
import { SecurityPolicy, type SecurityConfig } from "../src/security.js";

const policy = (over: Partial<SecurityConfig>) =>
  new SecurityPolicy({ mode: "admin", appAllowlist: [], protectedApps: [], allowManage: true, dryRun: false, auditLog: false, ...over } as SecurityConfig);

describe("bundle ids compare case-insensitively", () => {
  it("a differently-cased id does not slip past a protected entry", () => {
    const p = policy({ protectedApps: ["com.apple.Preferences"] });
    expect(p.isAppProtected("COM.APPLE.PREFERENCES")).toBe(true);
    expect(() => p.guard({ tool: "terminate_app", capability: "write", bundleId: "com.apple.preferences", destructive: true })).toThrow(/protected/);
  });

  it("allowlist matching ignores case too, and unrelated ids stay out", () => {
    const p = policy({ appAllowlist: ["com.example.App"] });
    expect(p.isAppAllowed("com.EXAMPLE.app")).toBe(true);
    expect(p.isAppAllowed("com.example.other")).toBe(false);
  });
});
