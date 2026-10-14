/**
 * Security policy engine (pure, unit-testable) — same shape as the rest of the
 * suite. Decides which tools register for the access mode and gates each call
 * (app/bundleId scoping, protected apps, the manage opt-in for install/terminate/
 * reset, destructive ops, dry-run, audit).
 */
export type Capability = "read" | "write" | "admin";
export type AccessMode = "read-only" | "read-write" | "admin";

const MODE_RANK: Record<AccessMode, number> = { "read-only": 0, "read-write": 1, admin: 2 };
const CAP_RANK: Record<Capability, number> = { read: 0, write: 1, admin: 2 };

export interface SecurityConfig {
  mode: AccessMode;
  /** If set, only these bundle IDs may be launched/installed/terminated/reset. Empty = all. */
  appAllowlist: string[];
  /** Apps that can be inspected/launched but never terminated, reset, or uninstalled. */
  protectedApps: string[];
  /** install_app / terminate_app / reset_app require this in addition to admin mode. */
  allowManage: boolean;
  /** Validate + log write/admin actions without executing them on the device. */
  dryRun: boolean;
  auditLog: boolean;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface GuardContext {
  tool: string;
  capability: Capability;
  /** Target app bundle ID, if any. */
  bundleId?: string;
  /** Destructive (terminate / reset / uninstall) — needs the manage gate + protection check. */
  destructive?: boolean;
  /** install_app / terminate_app / reset_app — needs allowManage in addition to admin mode. */
  requiresManage?: boolean;
}

export class SecurityPolicy {
  constructor(private readonly config: SecurityConfig) {}

  get mode(): AccessMode {
    return this.config.mode;
  }
  get manageEnabled(): boolean {
    return this.isCapabilityEnabled("admin") && this.config.allowManage;
  }

  isCapabilityEnabled(c: Capability): boolean {
    return CAP_RANK[c] <= MODE_RANK[this.config.mode];
  }
  isAppAllowed(bundleId: string): boolean {
    if (this.config.appAllowlist.length === 0) return true;
    return this.config.appAllowlist.includes(bundleId);
  }
  isAppProtected(bundleId: string): boolean {
    return this.config.protectedApps.includes(bundleId);
  }

  guard(ctx: GuardContext): { dryRun: boolean } {
    if (!this.isCapabilityEnabled(ctx.capability)) {
      this.audit(ctx, "DENY", `capability '${ctx.capability}' exceeds mode '${this.config.mode}'`);
      throw new PolicyError(
        `Operation '${ctx.tool}' requires '${ctx.capability}' access but the server runs in '${this.config.mode}' mode.`,
      );
    }
    if (ctx.bundleId !== undefined) {
      if (!this.isAppAllowed(ctx.bundleId)) {
        this.audit(ctx, "DENY", `app '${ctx.bundleId}' not in allowlist`);
        throw new PolicyError(`App '${ctx.bundleId}' is not in the configured allowlist (IOS_APP_ALLOWLIST).`);
      }
      if (ctx.destructive && this.isAppProtected(ctx.bundleId)) {
        this.audit(ctx, "DENY", `app '${ctx.bundleId}' is protected`);
        throw new PolicyError(`App '${ctx.bundleId}' is protected (IOS_PROTECTED_APPS); refused.`);
      }
    }
    if (ctx.requiresManage && !this.config.allowManage) {
      this.audit(ctx, "DENY", "manage not enabled");
      throw new PolicyError(`Operation '${ctx.tool}' is disabled. Set IOS_ALLOW_MANAGE=true to enable install/terminate/reset.`);
    }

    const dryRun = ctx.capability !== "read" && this.config.dryRun;
    this.audit(ctx, dryRun ? "DRY_RUN" : "ALLOW");
    return { dryRun };
  }

  private audit(ctx: GuardContext, decision: string, reason?: string): void {
    if (!this.config.auditLog) return;
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        audit: "ios-mcp",
        decision,
        tool: ctx.tool,
        capability: ctx.capability,
        bundleId: ctx.bundleId ?? null,
        destructive: ctx.destructive ?? false,
        ...(reason ? { reason } : {}),
      })}\n`,
    );
  }
}
