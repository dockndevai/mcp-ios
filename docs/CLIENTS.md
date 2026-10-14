# Installing `mcp-ios` in your MCP client

`mcp-ios` is a **stdio** MCP server. Any MCP-compatible agent can run it. It must
run **on a Mac** with a running **Appium** server driving a tethered iPhone/iPad
(see the [README](../README.md) for the one-time Appium/WebDriverAgent setup).

Two ways to launch it:

- **From source (works today):** `node /ABSOLUTE/PATH/TO/mcp-ios/dist/index.js` after `npm install && npm run build`.
- **From npm (after it is published):** `npx -y @dockndevai/mcp-ios` — replace the `command`/`args` below with `"command": "npx", "args": ["-y", "@dockndevai/mcp-ios"]`.

> Replace `/ABSOLUTE/PATH/TO/mcp-ios` with the real absolute path on your machine, and set the environment variables for your device. **Start in `read-only` mode** and raise it deliberately. See [`.env.example`](../.env.example) for every supported variable.

## Prerequisites

```bash
cd mcp-ios
npm install
npm run build
# and, in another terminal, a running Appium server:
appium
```

## Claude Code (CLI)

```bash
claude mcp add ios \
  -e IOS_APPIUM_URL="http://127.0.0.1:4723" \
  -e IOS_MODE="read-only" \
  -- node /ABSOLUTE/PATH/TO/mcp-ios/dist/index.js
```

Add `-s user` to install it for all your projects, or `-s project` to write it into a shared `.mcp.json`. List with `claude mcp list`, remove with `claude mcp remove ios`.

## Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`) and merge:

```json
{
  "mcpServers": {
    "ios": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/mcp-ios/dist/index.js"
      ],
      "env": {
        "IOS_APPIUM_URL": "http://127.0.0.1:4723",
        "IOS_MODE": "read-only"
      }
    }
  }
}
```

Restart Claude Desktop. The server appears under the tools (🔨) menu.

## Cursor

Create `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "ios": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/mcp-ios/dist/index.js"
      ],
      "env": {
        "IOS_APPIUM_URL": "http://127.0.0.1:4723",
        "IOS_MODE": "read-only"
      }
    }
  }
}
```

Then enable it in **Cursor Settings → MCP**.

## OpenAI Codex CLI

Edit `~/.codex/config.toml` and add:

```toml
[mcp_servers.ios]
command = "node"
args = ["/ABSOLUTE/PATH/TO/mcp-ios/dist/index.js"]
env = { IOS_APPIUM_URL = "http://127.0.0.1:4723", IOS_MODE = "read-only" }
```

Codex reads MCP servers from `config.toml` on startup.

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "ios": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/mcp-ios/dist/index.js"
      ],
      "env": {
        "IOS_APPIUM_URL": "http://127.0.0.1:4723",
        "IOS_MODE": "read-only"
      }
    }
  }
}
```

Then **Refresh** in the Windsurf MCP settings panel.

## VS Code (GitHub Copilot / Agent mode)

Create `.vscode/mcp.json` (note the top-level key is `servers`):

```json
{
  "servers": {
    "ios": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/mcp-ios/dist/index.js"
      ],
      "env": {
        "IOS_APPIUM_URL": "http://127.0.0.1:4723",
        "IOS_MODE": "read-only"
      }
    }
  }
}
```

Open the Copilot Chat **Agent** view and confirm the server is listed.

## Any other MCP client

Point it at the command `node /ABSOLUTE/PATH/TO/mcp-ios/dist/index.js` (transport: **stdio**) with the same environment variables.

## Verify

On startup the server logs lines to **stderr** like:

```
[ios-mcp] Starting in 'read-only' mode. Appium: http://127.0.0.1:4723. N tools enabled: …
[ios-mcp] The XCUITest session connects lazily on first tool call. …
```

If you see `Configuration error: …` instead, fix the reported variable. Ask your agent to *"take a screenshot of the phone"* — the first tool call opens the XCUITest session. If it reports it cannot reach Appium, make sure `appium` is running, the XCUITest driver is installed, WebDriverAgent is signed, and the device is connected + trusted.
