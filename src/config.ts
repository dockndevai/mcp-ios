/**
 * Configuration from environment variables. The server drives a tethered
 * iPhone/iPad through a running **Appium** server (XCUITest / WebDriverAgent).
 */
import type { AccessMode, SecurityConfig } from "./security.js";

export interface IosConnection {
  /** Base URL of the running Appium server. */
  appiumUrl: string;
  /** Target device UDID (from `xcrun xctrace list devices` / `idevice_id -l`). Empty = Appium's default. */
  udid?: string;
  /** Optional default app bundle ID to attach the session to (otherwise the session attaches to no app). */
  bundleId?: string;
  /** New-command / session timeout (ms). */
  timeout: number;
}

export interface AppConfig {
  connection: IosConnection;
  security: SecurityConfig;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseMode(): AccessMode {
  const raw = (process.env.IOS_MODE ?? "read-only").toLowerCase();
  if (raw === "read-only" || raw === "read-write" || raw === "admin") return raw;
  throw new Error(`Invalid IOS_MODE '${raw}'. Expected one of: read-only, read-write, admin.`);
}

export function loadConfig(): AppConfig {
  return {
    connection: {
      appiumUrl: process.env.IOS_APPIUM_URL || "http://127.0.0.1:4723",
      udid: process.env.IOS_UDID || undefined,
      bundleId: process.env.IOS_BUNDLE_ID || undefined,
      timeout: Number(process.env.IOS_TIMEOUT_MS ?? 60000),
    },
    security: {
      mode: parseMode(),
      appAllowlist: list("IOS_APP_ALLOWLIST"),
      protectedApps: list("IOS_PROTECTED_APPS").length
        ? list("IOS_PROTECTED_APPS")
        : ["com.apple.Preferences", "com.apple.springboard"],
      allowManage: bool("IOS_ALLOW_MANAGE", false),
      dryRun: bool("IOS_DRY_RUN", false),
      auditLog: bool("IOS_AUDIT_LOG", true),
    },
  };
}
