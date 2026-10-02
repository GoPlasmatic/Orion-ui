import { describe, expect, it } from "vitest"
import type { OAuth2LoginConfig } from "@/api/types"
import {
  isMultiProvider,
  lintOAuth2Login,
  lintProviderSlug,
  providerSegments,
  splitFlatProvider,
  suggestSlug,
} from "@/lib/oauth2-login"

const shared = {
  state_secret: "env://ORION_SECRET_OAUTH_STATE",
}

const flat: OAuth2LoginConfig = {
  ...shared,
  authorize_url: "https://github.com/login/oauth/authorize",
  token_url: "https://github.com/login/oauth/access_token",
  client_id: "abc",
  client_secret: "env://GH",
  redirect_uri: "https://app.example.com/api/v1/data/v1/auth/github/callback",
  callback_path: "/v1/auth/github/callback",
}

const multi: OAuth2LoginConfig = {
  ...shared,
  redirect_uri: "https://app.example.com/api/v1/data/v1/auth/{provider}/callback",
  callback_path: "/v1/auth/{provider}/callback",
  providers: {
    github: {
      authorize_url: "https://github.com/login/oauth/authorize",
      token_url: "https://github.com/login/oauth/access_token",
      client_id: "abc",
      identity: { subject: "id", login: "login", picture: "avatar_url" },
    },
    google: { issuer: "https://accounts.google.com", client_id: "xyz" },
  },
}

const paths = (cfg: OAuth2LoginConfig, route: string | null) =>
  lintOAuth2Login(cfg, route).map((f) => f.path)

describe("oauth2 provider lint", () => {
  it("passes a well-formed flat block and a well-formed providers map", () => {
    expect(lintOAuth2Login(flat, "/v1/auth/github/login")).toEqual([])
    expect(lintOAuth2Login(multi, "/v1/auth/{provider}/login")).toEqual([])
  })

  it("requires one {provider} segment on the route pattern and the callback path", () => {
    expect(paths(multi, "/v1/auth/login")).toEqual(["route_pattern"])
    expect(paths(multi, "/v1/{provider}/{provider}")).toEqual(["route_pattern"])
    expect(paths({ ...multi, callback_path: "/v1/auth/callback" }, "/v1/auth/{provider}/login")).toEqual([
      "callback_path",
    ])
    // A segment, not a substring.
    expect(providerSegments("/v1/auth/x{provider}/cb")).toBe(0)
  })

  it("requires {provider} in the redirect URI template", () => {
    expect(
      paths({ ...multi, redirect_uri: "https://app.example.com/cb" }, "/v1/auth/{provider}/login")
    ).toEqual(["redirect_uri"])
  })

  it("applies the route rules under providers_from_instance with no providers of its own", () => {
    const cfg: OAuth2LoginConfig = { ...multi, providers: undefined, providers_from_instance: true }
    expect(isMultiProvider(cfg)).toBe(true)
    expect(paths(cfg, "/v1/auth/login")).toEqual(["route_pattern"])
  })

  it("refuses the flat provider fields beside a providers map", () => {
    expect(paths({ ...multi, client_id: "stray" }, "/v1/auth/{provider}/login")).toEqual(["client_id"])
  })

  it("makes endpoints optional once an issuer discovers them", () => {
    const noEndpoints = { ...flat, authorize_url: undefined, token_url: undefined }
    expect(paths(noEndpoints, "/v1/auth/login")).toEqual(["authorize_url", "token_url"])
    expect(paths({ ...noEndpoints, issuer: "https://accounts.google.com" }, "/v1/auth/login")).toEqual([])
  })

  it("lints each provider at its own path, slug included", () => {
    const cfg: OAuth2LoginConfig = {
      ...multi,
      providers: { "Bad Slug": { client_id: "x" } },
    }
    expect(paths(cfg, "/v1/auth/{provider}/login")).toEqual([
      "providers.Bad Slug",
      "providers.Bad Slug.authorize_url",
      "providers.Bad Slug.token_url",
    ])
    expect(lintProviderSlug("github")).toBeNull()
    expect(lintProviderSlug("")).not.toBeNull()
    expect(lintProviderSlug("a/b")).not.toBeNull()
  })

  it("keeps the flat callback path static and the route free of {provider}", () => {
    expect(paths({ ...flat, callback_path: "/v1/auth/{id}/cb" }, "/v1/auth/login")).toEqual(["callback_path"])
    expect(paths(flat, "/v1/auth/{provider}/login")).toEqual(["route_pattern"])
  })

  it("refuses plain http endpoints and a callback equal to the route", () => {
    expect(paths({ ...flat, token_url: "http://idp.local/token" }, "/x")).toEqual(["token_url"])
    expect(paths(flat, flat.callback_path)).toEqual(["callback_path"])
  })
})

describe("flat ⇄ providers", () => {
  it("splits the provider fields from the shared settings", () => {
    const { provider, rest } = splitFlatProvider(flat)
    expect(provider.client_id).toBe("abc")
    expect(rest).not.toHaveProperty("client_id")
    expect(rest.callback_path).toBe(flat.callback_path)
    expect(rest.state_secret).toBe(shared.state_secret)
  })

  it("suggests a slug from the endpoint host, avoiding taken ones", () => {
    expect(suggestSlug({ authorize_url: "https://github.com/login/oauth/authorize" })).toBe("github")
    expect(suggestSlug({ issuer: "https://accounts.google.com" })).toBe("google")
    expect(suggestSlug({}, ["provider"])).toBe("provider2")
  })
})
