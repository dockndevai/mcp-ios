import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

// Hardware buttons XCUITest's `mobile: pressButton` understands.
const BUTTONS = ["home", "volumeup", "volumedown"] as const;

export const writeTools: ToolDef[] = [
  {
    name: "tap",
    capability: "write",
    config: {
      title: "Tap",
      description: "Tap at screen coordinates (x, y). Get coordinates from screenshot + page_source first.",
      inputSchema: { x: z.number().int().describe("X coordinate"), y: z.number().int().describe("Y coordinate") },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "tap", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would tap (${a.x}, ${a.y}).`);
      await client.tap(a.x as number, a.y as number);
      return jsonResult({ tapped: [a.x, a.y] });
    },
  },
  {
    name: "swipe",
    capability: "write",
    config: {
      title: "Swipe",
      description: "Swipe/scroll from (x1,y1) to (x2,y2) over a duration.",
      inputSchema: {
        x1: z.number().int().describe("Start X"),
        y1: z.number().int().describe("Start Y"),
        x2: z.number().int().describe("End X"),
        y2: z.number().int().describe("End Y"),
        durationMs: z.number().int().min(50).max(5000).optional().describe("Gesture duration in ms (default 300)"),
      },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "swipe", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would swipe (${a.x1},${a.y1})→(${a.x2},${a.y2}).`);
      await client.swipe(a.x1 as number, a.y1 as number, a.x2 as number, a.y2 as number, (a.durationMs as number) ?? 300);
      return jsonResult({ swiped: true });
    },
  },
  {
    name: "input_text",
    capability: "write",
    config: {
      title: "Type text",
      description: "Type text into the currently focused field.",
      inputSchema: { text: z.string().describe("Text to type into the focused element") },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "input_text", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would type: ${a.text}`);
      await client.inputText(a.text as string);
      return jsonResult({ typed: true });
    },
  },
  {
    name: "press_button",
    capability: "write",
    config: {
      title: "Press button",
      description: "Press a hardware button: home, volumeup, or volumedown.",
      inputSchema: { button: z.enum(BUTTONS).describe("Hardware button") },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "press_button", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would press ${a.button}.`);
      await client.pressButton(a.button as string);
      return jsonResult({ pressed: a.button });
    },
  },
  {
    name: "launch_app",
    capability: "write",
    config: {
      title: "Launch app",
      description: "Open (or foreground) an app by bundle ID (e.g. com.apple.mobilesafari).",
      inputSchema: { bundleId: z.string().describe("App bundle ID") },
    },
    handler: async (a, { client, policy }) => {
      const bundleId = a.bundleId as string;
      const { dryRun } = policy.guard({ tool: "launch_app", capability: "write", bundleId });
      if (dryRun) return textResult(`[dry-run] Would launch ${bundleId}.`);
      await client.launchApp(bundleId);
      return jsonResult({ launched: bundleId });
    },
  },
  {
    name: "open_url",
    capability: "write",
    config: {
      title: "Open URL",
      description: "Open a URL or deep link (http(s) opens in Safari; custom schemes route through the system handler).",
      inputSchema: { url: z.string().describe("URL or deep link to open") },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "open_url", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would open ${a.url}.`);
      await client.openUrl(a.url as string);
      return jsonResult({ opened: a.url });
    },
  },
  {
    name: "run_shortcut",
    capability: "write",
    config: {
      title: "Run Shortcut",
      description:
        "Run a named iOS Shortcut via the shortcuts:// deep link. Safe way to trigger user-defined actions (alarms, toggles, messages) without arbitrary UI control.",
      inputSchema: {
        name: z.string().describe("Shortcut name exactly as it appears in the Shortcuts app"),
        input: z.string().optional().describe("Optional text input passed to the Shortcut"),
      },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "run_shortcut", capability: "write" });
      const name = a.name as string;
      if (dryRun) return textResult(`[dry-run] Would run Shortcut '${name}'.`);
      await client.runShortcut(name, a.input as string | undefined);
      return jsonResult({ ranShortcut: name });
    },
  },
];
