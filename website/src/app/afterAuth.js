/**
 * Where to send someone once they have signed in.
 *
 * Both auth pages used to end with `router.push("/extractor")`, which is a
 * fine guess when the only reason to have an account was the extractor. It
 * stopped being one the moment /clipping needed a sign-in: you press "Sign in
 * to clip", type your password, and land on a different product with no
 * explanation and no way back to what you were doing.
 *
 * So the pages accept `?next=`, and default to the extractor when nothing asks
 * for anything else — no other link on the site changes behaviour.
 *
 * ── Why this is not one line ──────────────────────────────────────────────
 *
 * `next` arrives in the URL, so it is attacker-supplied. A page that redirects
 * to whatever it is handed is an open redirect: send somebody
 * /login?next=https://evil.example, they see your domain in the address bar
 * while they type a password, and they land somewhere else afterwards trusting
 * that you sent them. Phishing kits look for exactly this.
 *
 * The rule is therefore a whitelist, not a blacklist: a single leading slash
 * and nothing that can be read as another host.
 */

export const DEFAULT_AFTER_AUTH = "/extractor";

/**
 * A same-origin path from a query string, or the default.
 *
 * @param {string} search - `window.location.search`, including the "?".
 * @returns {string} A path beginning with exactly one "/".
 */
export function afterAuthPath(search) {
  let asked;
  try {
    asked = new URLSearchParams(search || "").get("next");
  } catch {
    return DEFAULT_AFTER_AUTH;
  }
  return isSameOriginPath(asked) ? asked : DEFAULT_AFTER_AUTH;
}

/**
 * Whether a value is a path on this site and nothing else.
 *
 * Exported so it can be tested, and so the reasoning sits next to the rule
 * rather than three files away.
 */
export function isSameOriginPath(value) {
  if (typeof value !== "string" || !value) return false;

  /* "/" alone is the home page and fine; "//evil.example" is protocol-relative
     and is a different host wearing a path's clothes. */
  if (!value.startsWith("/") || value.startsWith("//")) return false;

  /* Browsers normalise backslashes to forward slashes in URLs, so "/\evil.example"
     and "/\\evil.example" are read as "//evil.example" — the check above would
     pass and the navigation would leave the site. */
  if (value.includes("\\")) return false;

  /* A scheme cannot appear after a leading "/", but a control character can be
     stripped by the parser and reveal one, and a newline can split a header if
     this value is ever used server-side. Neither belongs in a path. */
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;

  return true;
}
