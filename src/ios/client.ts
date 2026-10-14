/**
 * Thin wrapper over `webdriverio` talking to a running **Appium** server that
 * drives **WebDriverAgent (XCUITest)** on a tethered iPhone/iPad.
 *
 * The session is created lazily on first use (so `build`/`typecheck`/startup
 * never require a device or a running Appium), and `webdriverio` is imported
 * dynamically for the same reason — importing it has no side effects, but the
 * dynamic import keeps the heavy dependency off the module-load path and makes
 * the "can't reach Appium" failure a clean, actionable error instead of a crash.
 */
import { execFile } from "node:child_process";
import type { IosConnection } from "../config.js";

export class IosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IosError";
  }
}

/** Minimal structural type for the bits of the WebdriverIO browser we use. */
interface WdioBrowser {
  capabilities: Record<string, unknown>;
  sessionId: string;
  takeScreenshot(): Promise<string>;
  getPageSource(): Promise<string>;
  getUrl(): Promise<string>;
  url(url: string): Promise<void>;
  keys(value: string | string[]): Promise<void>;
  execute<T = unknown>(script: string, ...args: unknown[]): Promise<T>;
  executeScript<T = unknown>(script: string, args: unknown[]): Promise<T>;
  deleteSession(): Promise<void>;
}

type RemoteFn = (opts: Record<string, unknown>) => Promise<WdioBrowser>;

/** Parse an Appium base URL into the parts webdriverio's `remote()` wants. */
function parseAppiumUrl(raw: string): { protocol: string; hostname: string; port: number; path: string } {
  const u = new URL(raw);
  const protocol = u.protocol.replace(":", "");
  const port = u.port ? Number(u.port) : protocol === "https" ? 443 : 80;
  const path = u.pathname && u.pathname !== "/" ? u.pathname : "/";
  return { protocol, hostname: u.hostname, port, path };
}

export class IosClient {
  private driver: WdioBrowser | null = null;

  constructor(private readonly conn: IosConnection) {}

  /** Lazily create (or reuse) the XCUITest session. */
  private async session(): Promise<WdioBrowser> {
    if (this.driver) return this.driver;

    let remote: RemoteFn;
    try {
      ({ remote } = (await import("webdriverio")) as unknown as { remote: RemoteFn });
    } catch (err) {
      throw new IosError(
        `Could not load the 'webdriverio' client: ${(err as Error).message}. Run 'npm install' in the server directory.`,
      );
    }

    const { protocol, hostname, port, path } = parseAppiumUrl(this.conn.appiumUrl);
    const capabilities: Record<string, unknown> = {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:newCommandTimeout": Math.round(this.conn.timeout / 1000),
    };
    if (this.conn.udid) capabilities["appium:udid"] = this.conn.udid;
    if (this.conn.bundleId) capabilities["appium:bundleId"] = this.conn.bundleId;

    try {
      this.driver = await remote({
        protocol,
        hostname,
        port,
        path,
        logLevel: "error",
        connectionRetryTimeout: this.conn.timeout,
        capabilities,
      });
    } catch (err) {
      this.driver = null;
      throw new IosError(
        `Could not start an XCUITest session via Appium at ${this.conn.appiumUrl}: ${(err as Error).message}. ` +
          `Make sure the Appium server is running ('appium'), the XCUITest driver is installed ` +
          `('appium driver install xcuitest'), WebDriverAgent is signed to the device, and the iPhone is connected and trusted.`,
      );
    }
    return this.driver;
  }

  async deleteSession(): Promise<void> {
    if (!this.driver) return;
    try {
      await this.driver.deleteSession();
    } finally {
      this.driver = null;
    }
  }

  // --- Targets (no session needed) ------------------------------------------

  /**
   * Best-effort list of attached devices/simulators via local Xcode tooling.
   * Enumerating devices is not something the Appium REST API exposes, so this
   * shells out to `xcrun xctrace list devices` when available. Returns the
   * configured connection either way so the caller always has something useful.
   */
  async listTargets(): Promise<{ configured: { appiumUrl: string; udid: string | null; bundleId: string | null }; devices: string[]; note?: string }> {
    const configured = {
      appiumUrl: this.conn.appiumUrl,
      udid: this.conn.udid ?? null,
      bundleId: this.conn.bundleId ?? null,
    };
    const devices = await new Promise<string[]>((resolve) => {
      execFile("xcrun", ["xctrace", "list", "devices"], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && /\(([0-9A-F-]{8,})\)/i.test(l)),
        );
      });
    });
    return devices.length
      ? { configured, devices }
      : { configured, devices, note: "Device enumeration needs Xcode command-line tools on this Mac (xcrun xctrace / idevice_id -l). Set IOS_UDID to target a specific device." };
  }

  // --- Reads -----------------------------------------------------------------

  async deviceInfo(): Promise<Record<string, unknown>> {
    const d = await this.session();
    const caps = d.capabilities ?? {};
    let info: Record<string, unknown> = {};
    try {
      info = (await d.execute("mobile: deviceInfo")) as Record<string, unknown>;
    } catch {
      /* mobile: deviceInfo not available on every WDA version — capabilities still carry the basics. */
    }
    return { sessionId: d.sessionId, capabilities: caps, deviceInfo: info };
  }

  /** PNG screenshot as a base64 string. */
  async screenshot(): Promise<string> {
    const d = await this.session();
    return d.takeScreenshot();
  }

  /** XCUITest element tree (XML) for element targeting. */
  async pageSource(): Promise<string> {
    const d = await this.session();
    return d.getPageSource();
  }

  async currentApp(): Promise<unknown> {
    const d = await this.session();
    return d.execute("mobile: activeAppInfo");
  }

  /** Best-effort list of installed apps (needs a WDA that supports `mobile: listApps`). */
  async listApps(): Promise<unknown> {
    const d = await this.session();
    try {
      return await d.execute("mobile: listApps");
    } catch {
      return {
        note: "This WebDriverAgent build does not expose 'mobile: listApps'. Launch apps by bundle ID (e.g. com.apple.mobilesafari) with launch_app, or read the foreground app with current_app.",
      };
    }
  }

  // --- Writes (UI control) ---------------------------------------------------

  async tap(x: number, y: number): Promise<void> {
    const d = await this.session();
    await d.execute("mobile: tap", { x, y });
  }

  async swipe(fromX: number, fromY: number, toX: number, toY: number, durationMs = 300): Promise<void> {
    const d = await this.session();
    await d.execute("mobile: dragFromToForDuration", {
      duration: Math.max(durationMs, 1) / 1000,
      fromX,
      fromY,
      toX,
      toY,
    });
  }

  /** Type into the currently focused field. */
  async inputText(text: string): Promise<void> {
    const d = await this.session();
    await d.keys(text);
  }

  /** Press a hardware button (home, volumeup, volumedown, …). */
  async pressButton(name: string): Promise<void> {
    const d = await this.session();
    await d.execute("mobile: pressButton", { name });
  }

  async launchApp(bundleId: string): Promise<void> {
    const d = await this.session();
    await d.execute("mobile: launchApp", { bundleId });
  }

  async openUrl(url: string): Promise<void> {
    const d = await this.session();
    if (/^https?:\/\//i.test(url)) {
      // http(s) → open in Safari.
      await d.url(url);
      return;
    }
    // Custom scheme / deep link — route through Safari's deep-link handling.
    await d.execute("mobile: deepLink", { url, bundleId: "com.apple.mobilesafari" });
  }

  /** Run a named iOS Shortcut via the `shortcuts://` deep link. */
  async runShortcut(name: string, input?: string): Promise<void> {
    const d = await this.session();
    const params = new URLSearchParams({ name });
    if (input) params.set("input", input);
    const url = `shortcuts://run-shortcut?${params.toString()}`;
    await d.execute("mobile: deepLink", { url, bundleId: "com.apple.shortcuts" });
  }

  // --- Admin (manage-gated) --------------------------------------------------

  async installApp(appPath: string): Promise<void> {
    const d = await this.session();
    await d.execute("mobile: installApp", { app: appPath });
  }

  async terminateApp(bundleId: string): Promise<unknown> {
    const d = await this.session();
    return d.execute("mobile: terminateApp", { bundleId });
  }

  /** Reset an app to a fresh launch (terminate, then relaunch). */
  async resetApp(bundleId: string): Promise<void> {
    const d = await this.session();
    await d.execute("mobile: terminateApp", { bundleId }).catch(() => undefined);
    await d.execute("mobile: launchApp", { bundleId });
  }
}
