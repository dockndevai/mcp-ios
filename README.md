# mcp-ios

[![CI](https://github.com/dockndevai/mcp-ios/actions/workflows/ci.yml/badge.svg)](https://github.com/dockndevai/mcp-ios/actions/workflows/ci.yml)
[![CodeQL](https://github.com/dockndevai/mcp-ios/actions/workflows/codeql.yml/badge.svg)](https://github.com/dockndevai/mcp-ios/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@dockndevai/mcp-ios)](https://www.npmjs.com/package/@dockndevai/mcp-ios)

A [Model Context Protocol](https://modelcontextprotocol.io) server to drive an **iPhone/iPad** — the iOS counterpart to `mcp-android`. **Read this first: iOS is fundamentally more locked down than Android or macOS**, so this server takes the only legitimate route to real UI control.

## The honest landscape

A stock iPhone does **not** allow a background app to see and control other apps the way Android's Accessibility service (or macOS) does. Apple's sandbox forbids it. So there is **no on-device "iOS-use" agent** like the Mac/Android ones. The viable routes, in order of capability:

| Route | Control level | Needs | Notes |
| --- | --- | --- | --- |
| **Appium + WebDriverAgent (XCUITest)** ✅ *(this server)* | Full UI: tap, type, swipe, read elements, screenshots, launch apps | A **Mac** with Xcode; iPhone connected by **USB** (or same-network); WDA signed to the device | The real "phone-use". Built for automation/QA — perfect for a personal agent on your own device. |
| **Shortcuts** | Run user-defined actions (set alarm, send message, toggles) | Shortcuts app; a URL/x-callback bridge | No arbitrary UI control, but great for safe, specific actions. Exposed here via `run_shortcut`. |
| **MDM** | Policy/config, app install | Enrollment | Device management, not interactive control. |

This server implements the **Appium/WDA** route: it runs on a Mac, talks to a local Appium server driving WebDriverAgent on the tethered iPhone, and exposes the same safe-by-default MCP shape as the rest of the suite. A `set_alarm`-style action can also go through **Shortcuts** (`run_shortcut`) when the device isn't tethered.

> If you want control *from the phone itself with nothing attached*, that isn't possible on iOS — use `mcp-android` on the Fold 7 for that experience, or the Shortcuts subset here.

## Setup (Appium route)

```bash
brew install node
npm i -g appium
appium driver install xcuitest
# Xcode + command line tools installed; sign WebDriverAgent to your device once (Xcode)
# Connect the iPhone by USB, Trust the Mac, enable Developer Mode on the device
appium        # starts the Appium server (default http://127.0.0.1:4723)
```

The server creates the XCUITest session **lazily** on the first tool call, so it starts even before Appium or the device are up — the first call that needs the device returns a clear "start `appium` / sign WDA / connect the device" message if it can't connect.

## Security model

| Concern | Flag | Default | Effect |
| --- | --- | --- | --- |
| What can the server do? | `IOS_MODE` | `read-only` | `read-only` exposes inspection only; `read-write` adds UI control; `admin` adds app management. Tools above the mode are **never registered**. |
| Which apps are in scope? | `IOS_APP_ALLOWLIST` | *(all)* | When set, launching/managing any other bundle ID is refused. |
| Which apps are read-only forever? | `IOS_PROTECTED_APPS` | `com.apple.Preferences`, `com.apple.springboard` | Inspectable/launchable but never terminated, reset, or uninstalled. |
| Can it install/terminate/reset apps? | `IOS_ALLOW_MANAGE` | `false` | The admin tools need this **and** admin mode; otherwise they aren't even advertised. |
| Interactive confirmation | *(automatic)* | — | `terminate_app` and `reset_app` prompt the human to approve the exact bundle ID via MCP elicitation before running; clients without elicitation fall back to the `IOS_ALLOW_MANAGE` gate. |
| Preview without touching the device | `IOS_DRY_RUN` | `false` | Write/admin tools validate + log intent, then return. |
| Audit trail | `IOS_AUDIT_LOG` | `true` | Emits a JSON line to stderr per guarded operation. |

Connection: `IOS_APPIUM_URL` (default `http://127.0.0.1:4723`), `IOS_UDID` (target device), `IOS_BUNDLE_ID` (optional default app). See [`.env.example`](.env.example) for all variables and [docs/CLIENTS.md](docs/CLIENTS.md) for the full per-client install guide.

## Tools

**Read** (`read-only`+): `list_targets`, `device_info`, `screenshot`, `page_source` (element tree), `current_app`, `list_apps`

**Write** (`read-write`+): `tap`, `swipe`, `input_text`, `press_button` (home/volume), `launch_app`, `open_url`, `run_shortcut` (via Shortcuts)

**Admin** (`admin` + `IOS_ALLOW_MANAGE`): `install_app`, `terminate_app`, `reset_app` (the last two confirm via elicitation; protected apps refused)

`screenshot` returns an MCP image content block so the agent can see the screen before acting.

## Quickstart — add to your agent

Published on npm as [`@dockndevai/mcp-ios`](https://www.npmjs.com/package/@dockndevai/mcp-ios). No clone or build needed — your MCP client runs it on demand with `npx`. It must run **on the Mac** with a running Appium server. **Start in `read-only` mode.**

**Claude Code** (CLI)

```bash
claude mcp add ios -e IOS_APPIUM_URL="http://127.0.0.1:4723" -e IOS_MODE="read-only" -- npx -y @dockndevai/mcp-ios
```

**Claude Desktop · Cursor · Windsurf** — same block in `claude_desktop_config.json`, `.cursor/mcp.json`, or `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "ios": {
      "command": "npx",
      "args": [
        "-y",
        "@dockndevai/mcp-ios"
      ],
      "env": {
        "IOS_APPIUM_URL": "http://127.0.0.1:4723",
        "IOS_MODE": "read-only"
      }
    }
  }
}
```

**VS Code (GitHub Copilot, Agent mode)** — in `.vscode/mcp.json`:

```json
{
  "servers": {
    "ios": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@dockndevai/mcp-ios"
      ],
      "env": {
        "IOS_APPIUM_URL": "http://127.0.0.1:4723",
        "IOS_MODE": "read-only"
      }
    }
  }
}
```

## Example prompts

- *"Take a screenshot of my phone and tell me what's on screen."*
- *"Open Safari and go to news.ycombinator.com."* (needs `read-write`)
- *"Run my 'Good morning' Shortcut."* (needs `read-write`)

## Run from source (development)

```bash
npm install
npm run build
node dist/index.js   # with the environment variables set, and `appium` running
```

## Develop

```bash
npm run dev
npm test          # security policy + elicitation confirmation (pure; no device needed)
npm run typecheck
```

> The policy and elicitation tests are pure and run anywhere. The device-driving path can't be smoke-tested without a Mac + Xcode + signed WDA + a tethered iPhone, so it's built against your real device setup.

## Publishing

This server ships a [`server.json`](server.json) for the official MCP registry and an [`mcpName`](package.json) for npm ownership validation. See **[PUBLISHING.md](PUBLISHING.md)** for publishing to npm and listing on the MCP registry, Smithery, Glama, Cursor, and PulseMCP.

## License

MIT
