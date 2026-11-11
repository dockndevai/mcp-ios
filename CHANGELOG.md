# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-11

### Security
- `IOS_APP_ALLOWLIST` / `IOS_PROTECTED_APPS` now compare bundle ids case-insensitively, so a differently-cased id cannot slip past a protected entry.
- Strict mode (`*_REQUIRE_HUMAN_APPROVAL`) now refuses an action whose target's version cannot be read (it used to proceed unpinned), and the approval prompt no longer calls reversible changes (moves, config changes) irreversible.
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
- **`install_app` now asks the human to approve.** It was the only destructive tool with no
  confirmation (just admin mode + `IOS_ALLOW_MANAGE`), unlike `terminate_app`/`reset_app` here and
  `install_apk` in `mcp-android`. The prompt shows the bundle path, the bundle ID/version/build read from the
  `.ipa`/`.app`, the device and whether it replaces an installed app; the file's size, mtime and inode and the
  device are pinned across the prompt, `IOS_DRY_RUN` returns before it, and `IOS_REQUIRE_HUMAN_APPROVAL=true`
  refuses without a human. `install_app` also now installs only a local path: it is made absolute (so the path shown is
  the path installed, not one Appium resolves against its own working directory) and a URL is refused (Appium's
  `app` argument can be a URL; the approval is about a local file).
- **`install_app` now enforces `IOS_APP_ALLOWLIST` and `IOS_PROTECTED_APPS`.** It called the policy guard
  with no bundle ID, so neither list applied to installs. The bundle ID is now read from the `.ipa`/`.app`
  and passed to the guard before the approval prompt (and before the dry-run return); a bundle outside the
  allowlist, or whose ID is protected (installing replaces the app), is refused. If the ID cannot be read
  the install is refused while an allowlist is set or the protected list is non-empty (it is by default);
  with neither configured there is nothing to enforce and the human still approves as before. A path that
  does not exist is now reported in dry-run as well.
- **`open_url` has a URL-scheme allowlist.** It passed any scheme to `mobile: deepLink`, so `shortcuts://`,
  `prefs:`/`App-Prefs:`, `itms-services://` or any custom app scheme could be opened. Only `http`, `https`,
  `tel`, `mailto`, `facetime` and `maps` are opened by default (`IOS_EXTRA_URL_SCHEMES` adds more); other
  schemes and URLs with control characters are refused before the dry-run branch, in the tool and in the client.
- **`open_url` and `run_shortcut` respect `IOS_APP_ALLOWLIST`.** They launch Safari / Phone / Mail / FaceTime /
  Maps or the Shortcuts app without going through the app scope; they are now checked against the stock app
  for the scheme (`com.apple.shortcuts` for `run_shortcut`). With an allowlist set, an extra scheme (handler
  unknown) is refused. An alternative default browser/mail app chosen on the device is not tracked.
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
