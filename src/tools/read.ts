import type { ToolDef } from "./types.js";
import { imageResult, jsonResult, textResult } from "./types.js";

export const readTools: ToolDef[] = [
  {
    name: "list_targets",
    capability: "read",
    config: {
      title: "List targets",
      description:
        "Show the configured Appium connection (URL, target UDID, default bundle ID) and, best-effort, the devices/simulators attached to this Mac.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "list_targets", capability: "read" });
      return jsonResult(await client.listTargets());
    },
  },
  {
    name: "device_info",
    capability: "read",
    config: {
      title: "Device info",
      description: "Session capabilities and device info (model, iOS version, screen) reported by WebDriverAgent.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "device_info", capability: "read" });
      return jsonResult(await client.deviceInfo());
    },
  },
  {
    name: "screenshot",
    capability: "read",
    config: {
      title: "Screenshot",
      description: "Capture the current screen as a PNG image so you can see what's on the phone before acting.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "screenshot", capability: "read" });
      return imageResult(await client.screenshot(), "Current screen:");
    },
  },
  {
    name: "page_source",
    capability: "read",
    config: {
      title: "Element tree",
      description:
        "Dump the current screen's XCUITest element tree (XML) with labels, types, and bounds — use it to find exact tap coordinates.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "page_source", capability: "read" });
      const xml = await client.pageSource();
      return textResult(xml.length > 40000 ? xml.slice(0, 40000) + "\n… (truncated)" : xml);
    },
  },
  {
    name: "current_app",
    capability: "read",
    config: { title: "Current app", description: "The app (bundle ID / process) currently in the foreground.", inputSchema: {} },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "current_app", capability: "read" });
      return jsonResult(await client.currentApp());
    },
  },
  {
    name: "list_apps",
    capability: "read",
    config: {
      title: "List apps",
      description: "List installed apps (best-effort; depends on the WebDriverAgent build).",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "list_apps", capability: "read" });
      return jsonResult(await client.listApps());
    },
  },
];
