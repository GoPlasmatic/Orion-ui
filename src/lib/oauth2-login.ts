import type { OAuth2LoginConfig, OAuth2ProviderConfig } from "@/api/types"

/**
 * Reading and shape-checking a channel's `oauth2_login` block (1.6, providers
 * since 1.11). The fast half only — the server's Validate is the authority —
 * but the `{provider}` route rules are easy to get wrong and expensive to find
 * by saving: a multi-provider channel whose callback path lacks the segment
 * cannot tell which provider is calling back.
 */

export const PROVIDER_SEGMENT = "{provider}"

/**
 * The fields that describe one identity provider. In the flat form they sit on
 * the block itself; with `providers` they sit under each slug, and the flat
 * spelling alongside a providers map is refused.
 */
export const PROVIDER_FIELDS = [
  "kind",
  "issuer",
  "authorize_url",
  "token_url",
  "client_id",
  "client_secret",
  "client_auth",
  "scopes",
  "extra_authorize_params",
  "id_token",
  "userinfo_url",
  "identity",
] as const satisfies readonly (keyof OAuth2ProviderConfig)[]

export interface OAuth2Finding {
  /** Where, as the author reads it: `callback_path`, `providers.github.token_url`. */
  path: string
  message: string
}

/** Whether the block uses the multi-provider shape: a providers map, or the instance's. */
export function isMultiProvider(cfg: Pick<OAuth2LoginConfig, "providers" | "providers_from_instance">): boolean {
  return Object.keys(cfg.providers ?? {}).length > 0 || cfg.providers_from_instance === true
}

/** How many path segments are exactly `{provider}`. */
export function providerSegments(path: string | null | undefined): number {
  if (!path) return 0
  return path.split("/").filter((s) => s === PROVIDER_SEGMENT).length
}

/** Why a slug is refused, or null. It becomes a path segment, so it must be one. */
export function lintProviderSlug(slug: string): string | null {
  if (slug.length === 0) return "A provider needs a slug."
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    return `"${slug}" must start with a lower-case letter or digit and use only a-z 0-9 _ -, since it fills the {provider} path segment.`
  }
  return null
}

const isPlainHttp = (url: string | undefined) => !!url && /^http:\/\//i.test(url.trim())

function lintProvider(p: OAuth2ProviderConfig, at: string, out: OAuth2Finding[]) {
  const discovered = !!p.issuer
  if (!discovered && !p.authorize_url) {
    out.push({ path: `${at}authorize_url`, message: "Authorize URL is required unless an issuer discovers it." })
  }
  if (!discovered && !p.token_url) {
    out.push({ path: `${at}token_url`, message: "Token URL is required unless an issuer discovers it." })
  }
  if (!p.client_id) out.push({ path: `${at}client_id`, message: "Client ID is required." })
  for (const field of ["authorize_url", "token_url", "userinfo_url", "issuer"] as const) {
    if (isPlainHttp(p[field])) {
      out.push({ path: `${at}${field}`, message: `${field} must be https.` })
    }
  }
  if (p.kind && p.kind !== "oidc" && p.kind !== "oauth2") {
    out.push({ path: `${at}kind`, message: `kind is "oidc" or "oauth2", not "${p.kind}".` })
  }
}

/**
 * Every finding for an `oauth2_login` block on a channel whose route pattern
 * is `routePattern`. Empty means nothing the client can see is wrong.
 */
export function lintOAuth2Login(
  cfg: OAuth2LoginConfig,
  routePattern: string | null | undefined
): OAuth2Finding[] {
  const out: OAuth2Finding[] = []
  const multi = isMultiProvider(cfg)

  if (multi) {
    if (routePattern != null && providerSegments(routePattern) !== 1) {
      out.push({
        path: "route_pattern",
        message: `With several providers the channel's route pattern must carry exactly one ${PROVIDER_SEGMENT} segment (e.g. /v1/auth/${PROVIDER_SEGMENT}/login).`,
      })
    }
    if (providerSegments(cfg.callback_path) !== 1) {
      out.push({
        path: "callback_path",
        message: `With several providers the callback path must carry exactly one ${PROVIDER_SEGMENT} segment (e.g. /v1/auth/${PROVIDER_SEGMENT}/callback).`,
      })
    }
    if (!cfg.redirect_uri?.includes(PROVIDER_SEGMENT)) {
      out.push({
        path: "redirect_uri",
        message: `With several providers the redirect URI must contain ${PROVIDER_SEGMENT}, so each provider is sent back to its own callback.`,
      })
    }
    const flat = PROVIDER_FIELDS.filter((f) => cfg[f] !== undefined)
    if (flat.length > 0 && Object.keys(cfg.providers ?? {}).length > 0) {
      out.push({
        path: flat[0],
        message: `${flat.join(", ")} belong under a provider: the flat form and a providers map are mutually exclusive.`,
      })
    }
    for (const [slug, p] of Object.entries(cfg.providers ?? {})) {
      const slugFinding = lintProviderSlug(slug)
      if (slugFinding) out.push({ path: `providers.${slug}`, message: slugFinding })
      lintProvider(p, `providers.${slug}.`, out)
    }
  } else {
    if (cfg.callback_path?.includes("{")) {
      out.push({
        path: "callback_path",
        message: "With one provider the callback path is a static route: no {param} segments.",
      })
    }
    if (routePattern != null && providerSegments(routePattern) > 0) {
      out.push({
        path: "route_pattern",
        message: `The route pattern carries ${PROVIDER_SEGMENT}, which only a multi-provider block fills. Add providers, or drop the segment.`,
      })
    }
    lintProvider(cfg, "", out)
  }

  if (cfg.callback_path && routePattern && cfg.callback_path === routePattern) {
    out.push({ path: "callback_path", message: "The callback path must differ from the route pattern." })
  }
  return out
}

/** Lift the flat provider fields of `cfg` into one provider, leaving the shared settings. */
export function splitFlatProvider(cfg: OAuth2LoginConfig): {
  provider: OAuth2ProviderConfig
  rest: OAuth2LoginConfig
} {
  const provider: Record<string, unknown> = {}
  const rest: Record<string, unknown> = { ...cfg }
  for (const f of PROVIDER_FIELDS) {
    if (cfg[f] !== undefined) provider[f] = cfg[f]
    delete rest[f]
  }
  return { provider: provider as OAuth2ProviderConfig, rest: rest as unknown as OAuth2LoginConfig }
}

/** A slug to suggest for a provider, from its endpoints — `github`, `google` — or `provider`. */
export function suggestSlug(p: OAuth2ProviderConfig, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const url = p.issuer ?? p.authorize_url ?? ""
  const host = /^https?:\/\/([^/:]+)/i.exec(url)?.[1] ?? ""
  const parts = host.split(".").filter((s) => !["www", "accounts", "login", "auth", "oauth", "com", "org", "net", "io"].includes(s))
  let base = (parts[0] ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "provider"
  if (!/^[a-z0-9]/.test(base)) base = "provider"
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`
}
