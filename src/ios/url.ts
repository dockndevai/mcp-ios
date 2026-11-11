/**
 * URL-scheme policy for `open_url`. A URL handed to `mobile: deepLink` is dispatched by iOS to
 * whichever app registered its scheme, so an unrestricted scheme is an unrestricted "run anything
 * installed": `shortcuts://` runs a user Shortcut, `prefs:` / `App-Prefs:` open Settings panes,
 * `itms-services://` starts an over-the-air install, and any custom scheme drives a third-party app.
 * Only a short list is allowed by default; more come from IOS_EXTRA_URL_SCHEMES.
 */

/** Schemes `open_url` accepts by default. Anything else is refused. */
export const DEFAULT_URL_SCHEMES = ["http", "https", "tel", "mailto", "facetime", "maps"] as const;

/**
 * The stock Apple app that handles each default scheme; this is what IOS_APP_ALLOWLIST is checked
 * against. A different default browser/mail app chosen on the device is not tracked. Extra schemes have
 * no entry: their handler is unknown.
 */
const STOCK_HANDLER: Record<string, string> = {
  http: "com.apple.mobilesafari",
  https: "com.apple.mobilesafari",
  tel: "com.apple.mobilephone",
  mailto: "com.apple.mobilemail",
  facetime: "com.apple.facetime",
  maps: "com.apple.Maps",
};

/** The Shortcuts app `run_shortcut` drives. */
export const SHORTCUTS_BUNDLE_ID = "com.apple.shortcuts";

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

export class UrlSchemeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlSchemeError";
  }
}

/** Validate and normalise a list of extra URL schemes from configuration. */
export function parseUrlSchemes(list: string[]): string[] {
  return list.map((s) => {
    if (!SCHEME.test(s)) throw new Error(`Invalid URL scheme '${s}' (expected letters, digits, '+', '-' or '.').`);
    return s.toLowerCase();
  });
}

/** Throw unless `url` is a single-line URL whose scheme is allowed. Returns the lower-cased scheme. */
export function assertUrlScheme(url: string, extraSchemes: readonly string[] = []): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) throw new UrlSchemeError("Invalid URL: control characters are not allowed.");
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  const allowed = [...DEFAULT_URL_SCHEMES, ...extraSchemes.map((s) => s.toLowerCase())];
  const scheme = m?.[1].toLowerCase();
  if (!scheme || !allowed.includes(scheme)) {
    throw new UrlSchemeError(
      `Refused URL scheme ${scheme ? `'${scheme}:'` : "(none)"}: allowed schemes are ${allowed.join(", ")} (add more with IOS_EXTRA_URL_SCHEMES).`,
    );
  }
  return scheme;
}

/** Bundle ID of the stock app that opens `scheme`, or undefined when unknown (extra schemes). */
export function stockHandlerFor(scheme: string): string | undefined {
  return STOCK_HANDLER[scheme.toLowerCase()];
}
