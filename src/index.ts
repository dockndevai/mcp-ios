#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`[ios-mcp] Configuration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const { server, client, enabled } = buildServer(config);
  process.stderr.write(
    `[ios-mcp] Starting in '${config.security.mode}' mode${config.security.dryRun ? " (DRY RUN)" : ""}. ` +
      `Appium: ${config.connection.appiumUrl}${config.connection.udid ? ` (udid ${config.connection.udid})` : ""}. ` +
      `${enabled.length} tools enabled: ${enabled.join(", ")}\n`,
  );
  process.stderr.write(
    `[ios-mcp] The XCUITest session connects lazily on first tool call. If a call fails to reach Appium, ` +
      `start it with 'appium' and make sure WebDriverAgent is signed and the device is connected + trusted.\n`,
  );

  const shutdown = async (): Promise<void> => {
    await client.deleteSession().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[ios-mcp] Fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
