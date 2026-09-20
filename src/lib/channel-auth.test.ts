/**
 * `auth.scheme` is a scheme *name*, not a byte prefix (Orion 1.8.2).
 *
 * The change matters because a value the server cannot read as a scheme is a
 * 400 at save and quarantines a channel already stored with one — its route
 * stops existing on a node that still reports healthy. This mirrors
 * `scheme_name` in the server's `channel/auth.rs`, which checks the value
 * against RFC 9110's `tchar` set after trimming.
 */
import { describe, it, expect } from "vitest"
import { isLegacySchemePrefix, lintAuthScheme } from "@/lib/channel-auth"

describe("channel auth scheme", () => {
  it("accepts a scheme name, with or without the old trailing space", () => {
    expect(lintAuthScheme("Bearer")).toBeNull()
    // The prefix spelling trims to the same scheme — it is no longer the
    // separator, so it neither helps nor breaks anything.
    expect(lintAuthScheme("Bearer ")).toBeNull()
    expect(lintAuthScheme("token")).toBeNull()
    expect(lintAuthScheme("Signature-V2")).toBeNull()
  })

  it("treats an absent or empty value as no scheme", () => {
    expect(lintAuthScheme(undefined)).toBeNull()
    expect(lintAuthScheme(null)).toBeNull()
    // An empty string is the bare credential, which is a real choice.
    expect(lintAuthScheme("")).toBeNull()
    expect(lintAuthScheme("   ")).toBeNull()
  })

  it("refuses a value that can never be a scheme name", () => {
    // The separators from RFC 9110's token grammar: a value carrying one can
    // never match, and would otherwise refuse every request without saying so.
    expect(lintAuthScheme("Key=")).toMatch(/not a scheme name/)
    expect(lintAuthScheme("Bearer:")).toMatch(/not a scheme name/)
    expect(lintAuthScheme("Bearer token")).toMatch(/not a scheme name/)
    expect(lintAuthScheme('"Bearer"')).toMatch(/not a scheme name/)
  })

  it("recognises the pre-1.8.2 prefix spelling", () => {
    expect(isLegacySchemePrefix("Bearer ")).toBe(true)
    expect(isLegacySchemePrefix("Bearer")).toBe(false)
    expect(isLegacySchemePrefix("")).toBe(false)
    expect(isLegacySchemePrefix("   ")).toBe(false)
    expect(isLegacySchemePrefix(undefined)).toBe(false)
  })
})
