/**
 * Reading a channel's `auth` block where the server's rule is not obvious.
 *
 * Today that is one field, `scheme`, whose meaning changed in Orion 1.8.2: it
 * is an HTTP authentication *scheme name*, not a byte prefix on the header.
 */

/**
 * RFC 9110's `tchar` set — `is_token_byte` in the server's
 * `channel/cookies.rs`, which `channel/auth.rs` checks a scheme name with.
 * Printable ASCII minus the separator characters.
 */
const SEPARATORS = `()<>@,;:\\"/[]?={}`

function isTokenChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code > 0x20 && code < 0x7f && !SEPARATORS.includes(ch)
}

/**
 * Client-side check for `auth.scheme` (`api_key`) and `auth.source.scheme`
 * (`jwt`), while typing. The server refuses a bad one with a 400 at create,
 * update, validate and import, and quarantines a channel already stored with
 * one — so catching it here is the difference between a squiggle and a
 * channel whose route stops existing.
 *
 * The value names a scheme, so the header is parsed as RFC 9110 §11.1 defines
 * it: the scheme, one or more spaces, then the credential. The scheme matches
 * case-insensitively and surrounding whitespace is not part of it, which is
 * why `"Bearer"` and the old prefix spelling `"Bearer "` are the same scheme.
 * An empty value means no scheme at all — the bare credential.
 *
 * Returns null when the value is acceptable.
 */
export function lintAuthScheme(raw: string | undefined | null): string | null {
  if (raw == null) return null
  const name = raw.trim()
  if (name === "") return null
  if (![...name].every(isTokenChar)) {
    return `"${raw}" is not a scheme name — a scheme is a token such as Bearer, and the space before the credential is not part of it`
  }
  return null
}

/**
 * Whether a scheme was written as the pre-1.8.2 byte prefix. Harmless now —
 * it trims to the same scheme — but worth saying, because the trailing space
 * is what the field used to mean and reads as though it still matters.
 */
export function isLegacySchemePrefix(raw: string | undefined | null): boolean {
  return typeof raw === "string" && raw !== raw.trim() && raw.trim() !== ""
}
