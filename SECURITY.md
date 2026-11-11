# Security

`mcp-ios` drives a physical iPhone/iPad through a running **Appium** server
(XCUITest / WebDriverAgent). It can tap, type, swipe, launch apps, open URLs,
run Shortcuts, and — in admin mode — install/terminate/reset apps. Treat it like
any other privileged automation and grant it least access.

## Principles

- **Start read-only.** Leave `IOS_MODE=read-only` until you need to act on the
  device. Tools above the current mode are never registered.
- **Gate app management explicitly.** `install_app`, `terminate_app`, and
  `reset_app` require both `admin` mode **and** `IOS_ALLOW_MANAGE=true` — they are
  not even advertised otherwise.
- **Interactive confirmation on destructive ops.** `install_app`, `terminate_app` and
  `reset_app` ask the human to approve the exact action via MCP elicitation
  before running. For `install_app` the prompt shows the absolute path of the `.ipa`/`.app`, the
  bundle ID, version and build read from it, the device (UDID + iOS version), and whether it replaces
  an installed app (and which version); with `IOS_DRY_RUN` nothing is asked or read from the device.
  `install_app` installs only a local path (a relative path is made absolute first, and a URL is
  refused, so what is approved is what Appium installs). Clients without elicitation fall back to the
  `IOS_ALLOW_MANAGE` gate — never *more* permissive.
- **Require a human for destructive ops.** Set `IOS_REQUIRE_HUMAN_APPROVAL=true` so
  `install_app`, `terminate_app` and `reset_app` are refused when the client cannot show an approval prompt.
  Each approval is bound to the exact tool and arguments (fingerprint) and to a version token read
  before the prompt and again after the answer; if it changed, the action is refused. The token is
  the app's CFBundleShortVersionString + CFBundleVersion (from `mobile: listApps`) plus the device
  UDID and iOS version; if the WebDriverAgent build cannot list apps, only the device is pinned. It
  does not cover the app's running state or data, and a reinstall of the same version is not
  detected. For `install_app` the token is the `.ipa` file's (or `.app` directory's) size, mtime and
  inode plus the device; for a `.app` directory that is the directory entry itself, so a file rewritten
  in place inside the bundle without touching the directory is not detected. The bundle ID/version
  shown come from the bundle's `Info.plist`; binary plists are only readable on macOS (`plutil`), and
  when they cannot be read the prompt says so instead of guessing. A prompt nobody answers is a refusal. Approval receipts are written to the audit log
  (`"audit":"approval"`, with `approvedBy` = `human` or `flag-only`).
- **Protect critical apps.** Add bundle IDs to `IOS_PROTECTED_APPS` so they can be
  inspected/launched but never terminated, reset, or uninstalled. Use
  `IOS_APP_ALLOWLIST` to pin the entire blast radius to a known set of apps.
  `install_app` applies both lists to the bundle ID read from the `.ipa`/`.app` itself, before the
  approval prompt and also in dry-run; when the ID cannot be read (for example a binary plist without
  macOS `plutil`) it is refused while an allowlist is set or, since installing replaces the app, while
  the protected list is non-empty (the default). `open_url` and `run_shortcut` are checked against the
  stock Apple app that handles them (e.g. Safari for http(s), `com.apple.shortcuts`); an alternative
  default browser or mail app chosen on the device is not tracked.
- **`open_url` only opens a short list of URL schemes.** `http`, `https`, `tel`, `mailto`, `facetime`
  and `maps` by default, plus `IOS_EXTRA_URL_SCHEMES`. Anything else (`shortcuts:`, `prefs:`,
  `App-Prefs:`, `itms-services:`, custom app schemes) is refused, as is a URL with control characters,
  because iOS dispatches a URL to whichever app registered the scheme. While `IOS_APP_ALLOWLIST` is set,
  an extra scheme is refused because its handler app is unknown. Use `run_shortcut` (which needs
  `com.apple.shortcuts` allowlisted if an allowlist is set) to run a Shortcut.
- **Scope at the device + Appium layer first.** The flags are defence in depth.
  The device must be physically connected and trusted, WebDriverAgent must be
  signed to it, and the Appium endpoint should be loopback/local — restrict who
  can reach it as the primary control.
- **Preview with dry-run.** `IOS_DRY_RUN=true` validates and logs write/admin
  intent without touching the device.
- **Keep the audit log on.** `IOS_AUDIT_LOG=true` (default) writes a JSON line per
  guarded operation to stderr.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a
public issue.
