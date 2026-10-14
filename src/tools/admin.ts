import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

/**
 * Admin tools: only registered in admin mode, and every one additionally
 * requires IOS_ALLOW_MANAGE=true (so they aren't even advertised otherwise).
 * The destructive ones (terminate_app, reset_app) also ask the human to confirm
 * via MCP elicitation before running.
 */
const manageEnabled = (p: import("../security.js").SecurityPolicy) => p.manageEnabled;

export const adminTools: ToolDef[] = [
  {
    name: "install_app",
    capability: "admin",
    enabledWhen: manageEnabled,
    config: {
      title: "Install app",
      description: "Install (or upgrade) a signed .ipa/.app from a local path. Requires admin mode AND IOS_ALLOW_MANAGE=true.",
      inputSchema: { appPath: z.string().describe("Path to a signed .ipa or .app on this Mac") },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "install_app", capability: "admin", requiresManage: true });
      const appPath = a.appPath as string;
      if (dryRun) return textResult(`[dry-run] Would install ${appPath}.`);
      await client.installApp(appPath);
      return jsonResult({ installed: appPath });
    },
  },
  {
    name: "terminate_app",
    capability: "admin",
    destructive: true,
    enabledWhen: manageEnabled,
    config: {
      title: "Terminate app",
      description:
        "Force-quit a running app by bundle ID. Requires admin mode AND IOS_ALLOW_MANAGE=true. Protected apps refused.",
      inputSchema: { bundleId: z.string().describe("App bundle ID") },
    },
    handler: async (a, { client, policy, confirm }) => {
      const bundleId = a.bundleId as string;
      const { dryRun } = policy.guard({
        tool: "terminate_app",
        capability: "admin",
        bundleId,
        destructive: true,
        requiresManage: true,
      });
      if (dryRun) return textResult(`[dry-run] Would terminate ${bundleId}.`);
      const ok = await confirm.confirm({ action: "terminate app", target: bundleId });
      if (!ok.approved) return textResult(`Termination cancelled — ${ok.reason}.`);
      return jsonResult({ terminated: bundleId, result: await client.terminateApp(bundleId) });
    },
  },
  {
    name: "reset_app",
    capability: "admin",
    destructive: true,
    enabledWhen: manageEnabled,
    config: {
      title: "Reset app",
      description:
        "Reset an app to a fresh launch (terminate, then relaunch). Requires admin mode AND IOS_ALLOW_MANAGE=true. Protected apps refused. Can discard transient app state.",
      inputSchema: { bundleId: z.string().describe("App bundle ID") },
    },
    handler: async (a, { client, policy, confirm }) => {
      const bundleId = a.bundleId as string;
      const { dryRun } = policy.guard({
        tool: "reset_app",
        capability: "admin",
        bundleId,
        destructive: true,
        requiresManage: true,
      });
      if (dryRun) return textResult(`[dry-run] Would reset ${bundleId}.`);
      const ok = await confirm.confirm({ action: "reset app", target: bundleId });
      if (!ok.approved) return textResult(`Reset cancelled — ${ok.reason}.`);
      await client.resetApp(bundleId);
      return jsonResult({ reset: bundleId });
    },
  },
];
