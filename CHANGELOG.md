# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-11

### Security
- **Approval no longer fails open on timeout.** The human-approval prompt used the MCP SDK's default
  60 s request timeout, and a timeout fell through to "approved" (the `IOS_ALLOW_MANAGE` gate had
  already passed). A prompt nobody answered therefore auto-approved a destructive operation. A timeout
  is now a refusal, and the wait defaults to 5 minutes.
- Dependencies: `@modelcontextprotocol/sdk` 1.32.1 -> 1.32.2, `webdriverio` 10.0.2 -> 10.2.0 and
  `npm audit fix` clear the `body-parser`, `fast-uri`, `qs`, `undici` and `glob` advisories in the
  production tree. `npm audit --omit=dev` still reports `zod` (3.x line; the only fix is `zod@4`) and a
  `minimatch` advisory reached through `webdriverio` -> `archiver` -> `readdir-glob` (still present in the
  latest `webdriverio` 10.2.0); both would need a major version change and are not part of this release.

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
