# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-11

### Security
- **Approval prompts are fully reviewable.** Arguments are shown in full up to 16 000 characters (previously cut at 1500, so a padded prefix could hide the tail of a long statement); a longer action is refused instead of approved blind. Secret redaction in prompts matches whole words (`bypass`/`tokenizer` are no longer shown as `[redacted]`).
- **Approval no longer fails open on timeout.** The human-approval prompt used the MCP SDK's default
  60 s request timeout, and a timeout fell through to "approved" (the `IOS_ALLOW_MANAGE` gate had
  already passed). A prompt nobody answered therefore auto-approved a destructive operation. A timeout
  is now a refusal, and the wait defaults to 5 minutes.
- Dependencies: `@modelcontextprotocol/sdk` 1.32.1 -> 1.32.2, `webdriverio` 10.0.2 -> 10.2.0, `npm audit fix`
  and `zod` 3 -> 4 (4.6.7) clear the `body-parser`, `fast-uri`, `qs`, `undici`, `glob` and high `zod`
  advisories in the production tree (the `zod` one had no 3.x fix). No tool schema changed: a new test
  (`test/schemas.test.ts`) pins every tool's advertised input schema. The only differences in the generated
  JSON Schema are cosmetic and do not change what a tool accepts: zod 4 no longer emits
  `additionalProperties: false` (unknown keys are still stripped) and adds safe-integer bounds to integer
  fields.
- Known, not fixed: `npm audit --omit=dev` still reports one moderate `minimatch` advisory
  (GHSA-g3hv-75wg-m249) through `webdriverio` -> `archiver@8` -> `readdir-glob@3`. `archiver` is only used by
  `webdriverio`'s `installExtension` (zipping a browser extension), which this server never calls; it is
  not reachable from any tool. npm's only offered fix is a downgrade to `webdriverio@9`, which was not taken.

### Added
- **Approvals are bound to the exact action.** The prompt shows the tool, the full (secret-redacted)
  arguments and a fingerprint; every approval and refusal is written to the audit log as
  `"audit":"approval"` with the fingerprint, resource version and `approvedBy` (`human` / `flag-only`).
- **Approvals are bound to the target's version.** `terminate_app` and `reset_app` read a version token
  before the prompt and again after the human answers, and refuse if it changed: the app's
  CFBundleShortVersionString + CFBundleVersion and the device (UDID + iOS version).
- `IOS_REQUIRE_HUMAN_APPROVAL=true` — refuse destructive ops when the client cannot elicit.
- **Tool annotations.** Every tool now registers `readOnlyHint` / `destructiveHint` / `idempotentHint` /
  `openWorldHint`, derived from its capability (`src/tools/annotations.ts`).

Tracking issue: https://github.com/dockndevai/mcp-core/issues/1

## [0.1.0]

- Initial implementation (Appium + WebDriverAgent).
