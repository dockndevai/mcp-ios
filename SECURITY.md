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
- **Interactive confirmation on destructive ops.** `terminate_app` and
  `reset_app` ask the human to approve the exact bundle ID via MCP elicitation
  before running. Clients without elicitation fall back to the
  `IOS_ALLOW_MANAGE` gate — never *more* permissive.
- **Require a human for destructive ops.** Set `IOS_REQUIRE_HUMAN_APPROVAL=true` so
  `terminate_app` and `reset_app` are refused when the client cannot show an approval prompt.
  Each approval is bound to the exact tool and arguments (fingerprint) and to a version token read
  before the prompt and again after the answer; if it changed, the action is refused. The token is
  the app's CFBundleShortVersionString + CFBundleVersion (from `mobile: listApps`) plus the device
  UDID and iOS version; if the WebDriverAgent build cannot list apps, only the device is pinned. It
  does not cover the app's running state or data, and a reinstall of the same version is not
  detected. A prompt nobody answers is a refusal. Approval receipts are written to the audit log
  (`"audit":"approval"`, with `approvedBy` = `human` or `flag-only`).
- **Protect critical apps.** Add bundle IDs to `IOS_PROTECTED_APPS` so they can be
  inspected/launched but never terminated, reset, or uninstalled. Use
  `IOS_APP_ALLOWLIST` to pin the entire blast radius to a known set of apps.
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
