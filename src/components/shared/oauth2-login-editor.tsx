import { useState } from "react"
import type {
  OAuth2IdentityMap,
  OAuth2LoginConfig,
  OAuth2ProviderConfig,
} from "@/api/types"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ConfigSection,
  NumberField,
  SelectField,
  StringListField,
  TextField,
  ToggleField,
} from "@/components/shared/config-field"
import {
  PROVIDER_SEGMENT,
  isMultiProvider,
  lintOAuth2Login,
  lintProviderSlug,
  splitFlatProvider,
  suggestSlug,
} from "@/lib/oauth2-login"
import { Plus, Trash2 } from "lucide-react"

const CLIENT_AUTH = [
  { value: "basic", label: "HTTP Basic (RFC 6749 §2.3.1)" },
  { value: "body", label: "Form body" },
]

const KINDS = [
  { value: "oidc", label: "OIDC — verify an id_token" },
  { value: "oauth2", label: "OAuth2 — access token only" },
]

// `strict` is refused: the callback is a top-level cross-site GET from the
// provider, so a Strict cookie is withheld on exactly that request.
const SAME_SITE = [
  { value: "lax", label: "Lax" },
  { value: "none", label: "None" },
]

const STARTER: OAuth2LoginConfig = {
  authorize_url: "",
  token_url: "",
  client_id: "",
  client_secret: "env://",
  redirect_uri: "",
  callback_path: "",
  state_secret: "env://ORION_SECRET_OAUTH_STATE",
}

const NEW_PROVIDER: OAuth2ProviderConfig = {
  client_id: "",
  client_secret: "env://",
}

// The identity fields and the OIDC claim each defaults to.
const IDENTITY_FIELDS: { key: keyof OAuth2IdentityMap; label: string; claim: string }[] = [
  { key: "subject", label: "Subject", claim: "sub" },
  { key: "login", label: "Login", claim: "preferred_username" },
  { key: "name", label: "Name", claim: "name" },
  { key: "email", label: "Email", claim: "email" },
  { key: "picture", label: "Picture", claim: "picture" },
]

// GitHub is not OIDC: its identity is the `/user` document, keyed differently.
const GITHUB_IDENTITY: OAuth2IdentityMap = { subject: "id", login: "login", picture: "avatar_url" }

/** `key=value, key2=value2` ⇄ a string map, for the extra authorize params. */
function parsePairs(items: string[] | undefined): Record<string, string> | undefined {
  if (!items || items.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const item of items) {
    const eq = item.indexOf("=")
    if (eq <= 0) continue
    out[item.slice(0, eq).trim()] = item.slice(eq + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

function formatPairs(map: Record<string, string> | undefined): string[] | undefined {
  if (!map) return undefined
  const items = Object.entries(map).map(([k, v]) => `${k}=${v}`)
  return items.length ? items : undefined
}

/** Drop `undefined` and `""`, so an unset field stays unset rather than stored empty. */
function assign<T extends object>(obj: T, field: string, v: unknown): T {
  const next = { ...obj } as Record<string, unknown>
  if (v === undefined || v === "") delete next[field]
  else next[field] = v
  return next as T
}

function subAssign<T extends object>(obj: T, key: string, field: string, v: unknown): T {
  const current = (obj as Record<string, unknown>)[key] as Record<string, unknown> | undefined
  const sub = assign({ ...(current ?? {}) }, field, v)
  return assign(obj, key, Object.keys(sub).length ? sub : undefined)
}

/**
 * The fields of one identity provider: the flat block's own, or one entry of
 * `providers`. With an `issuer` the endpoints are discovered from
 * `<issuer>/.well-known/openid-configuration` at load, so they turn optional.
 */
function ProviderFields({
  value,
  onChange,
  inProviders,
}: {
  value: OAuth2ProviderConfig
  onChange: (next: OAuth2ProviderConfig) => void
  /** Under `providers`: offers a per-provider redirect URI override. */
  inProviders?: boolean
}) {
  const set = (field: keyof OAuth2ProviderConfig, v: unknown) => onChange(assign(value, field, v))
  const setSub = (key: "id_token" | "identity", field: string, v: unknown) =>
    onChange(subAssign(value, key, field, v))
  const discovered = !!value.issuer
  const idToken = value.id_token
  const identity = value.identity

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="Kind"
          value={value.kind}
          onChange={(v) => set("kind", v)}
          options={KINDS}
          includeEmpty="Derived (OIDC when an issuer or id_token is set)"
        />
        <TextField
          label="Issuer (OIDC discovery)"
          value={value.issuer}
          onChange={(v) => set("issuer", v)}
          placeholder="https://accounts.google.com"
        />
      </div>
      {discovered && (
        <p className="-mt-1 text-xs text-muted-foreground">
          Endpoints and the id_token key set are discovered from{" "}
          <code className="font-mono">{`${value.issuer?.replace(/\/$/, "")}/.well-known/openid-configuration`}</code>{" "}
          at load. Fill an endpoint below only to override what discovery finds.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={discovered ? "Authorize URL (optional)" : "Authorize URL"}
          value={value.authorize_url}
          onChange={(v) => set("authorize_url", v)}
          placeholder={discovered ? "discovered from the issuer" : "https://github.com/login/oauth/authorize"}
        />
        <TextField
          label={discovered ? "Token URL (optional)" : "Token URL"}
          value={value.token_url}
          onChange={(v) => set("token_url", v)}
          placeholder={discovered ? "discovered from the issuer" : "https://github.com/login/oauth/access_token"}
        />
      </div>
      <TextField
        label="Userinfo URL"
        value={value.userinfo_url}
        onChange={(v) => set("userinfo_url", v)}
        placeholder={discovered ? "discovered from the issuer" : "https://api.github.com/user"}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Client ID"
          value={value.client_id}
          onChange={(v) => set("client_id", v)}
          placeholder="var://github_client_id"
        />
        <TextField
          label="Client secret"
          value={value.client_secret}
          onChange={(v) => set("client_secret", v)}
          placeholder="env://GITHUB_CLIENT_SECRET"
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Reference the secret (<code className="font-mono">env://</code>,{" "}
        <code className="font-mono">vault://</code>) rather than pasting it: a literal is stored in
        the definition and travels with every export.
      </p>
      {inProviders && (
        <TextField
          label="Redirect URI override"
          value={value.redirect_uri}
          onChange={(v) => set("redirect_uri", v)}
          placeholder="defaults to the block's redirect URI with {provider} filled in"
        />
      )}
      <div className="grid grid-cols-2 gap-4">
        <StringListField
          label="Scopes"
          value={value.scopes}
          onChange={(v) => set("scopes", v)}
          placeholder="read:user, user:email"
        />
        <SelectField
          label="Client authentication"
          value={value.client_auth}
          onChange={(v) => set("client_auth", v)}
          options={CLIENT_AUTH}
          includeEmpty="Basic (default)"
        />
      </div>
      <StringListField
        label="Extra authorize parameters"
        value={formatPairs(value.extra_authorize_params)}
        onChange={(v) => set("extra_authorize_params", parsePairs(v))}
        placeholder="prompt=consent, allow_signup=false"
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        <code className="font-mono">key=value</code> pairs. The reserved ones —{" "}
        <code className="font-mono">client_id</code>, <code className="font-mono">redirect_uri</code>,{" "}
        <code className="font-mono">response_type</code>, <code className="font-mono">scope</code>,{" "}
        <code className="font-mono">state</code>, <code className="font-mono">nonce</code>,{" "}
        <code className="font-mono">code_challenge</code>,{" "}
        <code className="font-mono">code_challenge_method</code> — are a create-time 400.
      </p>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Identity</p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => set("identity", { ...GITHUB_IDENTITY })}
            title="subject ← id, login ← login, picture ← avatar_url"
          >
            Use GitHub's keys
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Where the normalised identity at <code className="font-mono">metadata.identity</code> is
          read from — a claim, or a key of the userinfo document. Blank keeps the OIDC claim.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {IDENTITY_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              value={identity?.[f.key]}
              onChange={(v) => setSub("identity", f.key, v)}
              placeholder={f.claim}
            />
          ))}
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">OIDC id_token verification</p>
          {idToken ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => set("id_token", undefined)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set("id_token", { issuer: "", jwks_url: "" })}
            >
              <Plus className="h-3.5 w-3.5" /> Verify id_token
            </Button>
          )}
        </div>
        {idToken ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Issuer"
                value={Array.isArray(idToken.issuer) ? idToken.issuer.join(", ") : idToken.issuer}
                onChange={(v) => setSub("id_token", "issuer", v)}
                placeholder="https://accounts.google.com"
              />
              <TextField
                label="JWKS URL"
                value={idToken.jwks_url}
                onChange={(v) => setSub("id_token", "jwks_url", v)}
                placeholder={discovered ? "discovered from the issuer" : "https://www.googleapis.com/oauth2/v3/certs"}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <StringListField
                label="Audience"
                value={
                  Array.isArray(idToken.audience)
                    ? idToken.audience
                    : idToken.audience
                      ? [idToken.audience]
                      : undefined
                }
                onChange={(v) => setSub("id_token", "audience", v)}
                placeholder="defaults to the client id"
              />
              <StringListField
                label="Algorithms"
                value={idToken.algorithms}
                onChange={(v) => setSub("id_token", "algorithms", v)}
                placeholder="RS256"
              />
            </div>
            <ToggleField
              label="Required"
              description="Refuse a callback whose token response carries no id_token."
              checked={idToken.required ?? true}
              onCheckedChange={(c) => setSub("id_token", "required", c ? undefined : false)}
            />
            <ToggleField
              label="Nonce"
              description="Bind the id_token to this sign-in's nonce."
              checked={idToken.nonce ?? true}
              onCheckedChange={(c) => setSub("id_token", "nonce", c ? undefined : false)}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {discovered
              ? "With an issuer the id_token is verified against the discovered key set; add this block only to pin audience, algorithms or the nonce."
              : "Absent is plain OAuth2: the grant is an access token and nothing about the user is verified here."}
          </p>
        )}
      </div>
    </div>
  )
}

/** A provider's slug, committed on blur or Enter so a half-typed rename is not a key. */
function SlugInput({
  slug,
  taken,
  onRename,
}: {
  slug: string
  taken: string[]
  onRename: (next: string) => void
}) {
  const [draft, setDraft] = useState(slug)
  const finding =
    lintProviderSlug(draft) ?? (draft !== slug && taken.includes(draft) ? `"${draft}" is already a provider.` : null)
  const commit = () => {
    if (draft === slug) return
    if (finding) {
      setDraft(slug)
      return
    }
    onRename(draft)
  }
  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor={`oauth2-provider-${slug}`}>Slug</Label>
      <Input
        id={`oauth2-provider-${slug}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        className="font-mono"
        aria-invalid={!!finding || undefined}
      />
      {finding && draft !== slug && <p className="mt-1 text-xs text-destructive">{finding}</p>}
    </div>
  )
}

/**
 * Inbound OAuth2 / OIDC sign-in (Orion 1.6; several providers since 1.11).
 * Orion owns the redirect, the state cookie, the CSRF binding, PKCE and the
 * code exchange; the workflow receives the grant at `metadata.oauth` and the
 * normalised identity at `metadata.identity`. This is *establishment*, which
 * is why it sits beside `auth` rather than being a fourth mode of it — the two
 * compose: `oauth2_login` mints a session, `auth.mode = "jwt"` guards it.
 *
 * Two shapes: the flat form (one provider, its fields on the block) and a
 * `providers` map keyed by slug, where the route pattern, the callback path
 * and the redirect URI each carry `{provider}`.
 */
export function OAuth2LoginEditor({
  value,
  onChange,
  routePattern,
}: {
  value: OAuth2LoginConfig | undefined
  onChange: (next: OAuth2LoginConfig | undefined) => void
  /** The channel's route pattern — the authorize leg — for the `{provider}` lint. */
  routePattern?: string | null
}) {
  if (!value) {
    return (
      <ConfigSection
        title="OAuth2 sign-in"
        description="Make this channel the relying party in a browser authorization-code grant — “Sign in with GitHub”. Needs a REST channel with a route pattern."
      >
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...STARTER })}>
          <Plus className="h-3.5 w-3.5" /> Add OAuth2 sign-in
        </Button>
      </ConfigSection>
    )
  }

  const set = (field: keyof OAuth2LoginConfig, v: unknown) => onChange(assign(value, field, v))
  const setSub = (key: "state_cookie" | "return_to", field: string, v: unknown) =>
    onChange(subAssign(value, key, field, v))

  const multi = isMultiProvider(value)
  const providers = value.providers ?? {}
  const slugs = Object.keys(providers)
  const findings = lintOAuth2Login(value, routePattern)
  const cookie = value.state_cookie ?? {}
  const returnTo = value.return_to

  const setProviders = (next: Record<string, OAuth2ProviderConfig> | undefined) =>
    set("providers", next && Object.keys(next).length > 0 ? next : undefined)

  const toMulti = () => {
    const { provider, rest } = splitFlatProvider(value)
    const slug = suggestSlug(provider)
    onChange({ ...rest, providers: { [slug]: provider } })
  }
  const toFlat = () => {
    const only = slugs.length === 1 ? providers[slugs[0]] : {}
    const rest = assign(assign(value, "providers", undefined), "providers_from_instance", undefined)
    // A per-provider redirect override has no flat spelling; the block's own wins.
    const { redirect_uri: _drop, ...fields } = only as OAuth2ProviderConfig
    void _drop
    onChange({ ...rest, ...fields })
  }
  const renameProvider = (from: string, to: string) => {
    const next: Record<string, OAuth2ProviderConfig> = {}
    for (const [k, v] of Object.entries(providers)) next[k === from ? to : k] = v
    setProviders(next)
  }

  return (
    <ConfigSection
      title="OAuth2 sign-in"
      description="The route pattern is the authorize leg; the callback path is where the provider sends the browser back. Both are gated for route collisions at activation."
    >
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Providers">
        <Button
          type="button"
          size="sm"
          variant={multi ? "outline" : "secondary"}
          role="radio"
          aria-checked={!multi}
          onClick={() => multi && toFlat()}
          disabled={multi && slugs.length > 1}
          title={multi && slugs.length > 1 ? "Remove providers down to one first" : undefined}
        >
          One provider
        </Button>
        <Button
          type="button"
          size="sm"
          variant={multi ? "secondary" : "outline"}
          role="radio"
          aria-checked={multi}
          onClick={() => !multi && toMulti()}
        >
          Several providers
        </Button>
        <span className="text-xs text-muted-foreground">
          {multi
            ? `Keyed by slug; the route pattern, callback path and redirect URI each carry ${PROVIDER_SEGMENT}.`
            : "Its fields sit on the block itself."}
        </span>
      </div>

      {multi ? (
        <div className="space-y-3">
          {slugs.map((slug) => (
            <div key={slug} className="space-y-3 rounded-md border p-3">
              <div className="flex items-end gap-2">
                <SlugInput
                  key={slug}
                  slug={slug}
                  taken={slugs}
                  onRename={(to) => renameProvider(slug, to)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const next = { ...providers }
                    delete next[slug]
                    setProviders(next)
                  }}
                  aria-label={`Remove provider ${slug}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
              <ProviderFields
                value={providers[slug]}
                onChange={(p) => setProviders({ ...providers, [slug]: p })}
                inProviders
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setProviders({ ...providers, [suggestSlug({}, slugs)]: { ...NEW_PROVIDER } })}
          >
            <Plus className="h-3.5 w-3.5" /> Add provider
          </Button>
          <ToggleField
            label="Providers from the instance"
            description="Merge the deployment's [oauth2_login.providers] under these; a slug defined here wins a clash. Implies the {provider} route shape."
            checked={value.providers_from_instance ?? false}
            onCheckedChange={(c) => set("providers_from_instance", c || undefined)}
          />
        </div>
      ) : (
        // The flat form's provider fields are the block's own, so the edited
        // provider *is* the next block — spreading it over `value` would
        // resurrect a field the edit removed.
        <ProviderFields value={value} onChange={(p) => onChange(p as OAuth2LoginConfig)} />
      )}

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Redirect URI"
          value={value.redirect_uri}
          onChange={(v) => set("redirect_uri", v)}
          placeholder={
            multi
              ? "https://app.example.com/api/v1/data/v1/auth/{provider}/callback"
              : "https://app.example.com/api/v1/data/v1/auth/github/callback"
          }
        />
        <TextField
          label="Callback path"
          value={value.callback_path}
          onChange={(v) => set("callback_path", v)}
          placeholder={multi ? "/v1/auth/{provider}/callback" : "/v1/auth/github/callback"}
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {multi ? (
          <>
            The callback path is a second route on this channel with one{" "}
            <code className="font-mono">{PROVIDER_SEGMENT}</code> segment, like the route pattern;
            the redirect URI is a template the slug fills.
          </>
        ) : (
          <>
            The callback path is a second, static route on this channel — no{" "}
            <code className="font-mono">{"{param}"}</code> segments — and must differ from the
            route pattern.
          </>
        )}{" "}
        The redirect URI is sent on both legs; RFC 6749 requires them to match.
      </p>

      <TextField
        label="State secret"
        value={value.state_secret}
        onChange={(v) => set("state_secret", v)}
        placeholder="env://ORION_SECRET_OAUTH_STATE"
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        HS256 key for the state cookie, at least 32 bytes and identical on every node — a sign-in
        that begins on one node and returns to another needs no coordination.
      </p>
      <ToggleField
        label="PKCE"
        description="RFC 7636, S256 only. On by default."
        checked={value.pkce ?? true}
        onCheckedChange={(c) => set("pkce", c ? undefined : false)}
      />
      <ToggleField
        label="Run the workflow on the authorize leg"
        description="Off, the channel answers the redirect itself. On, the workflow runs first and may refuse the sign-in or contribute extra params and scopes; the state, nonce and PKCE challenge stay Orion's."
        checked={value.run_workflow_on_authorize ?? false}
        onCheckedChange={(c) => set("run_workflow_on_authorize", c || undefined)}
      />

      <div className="rounded-md border p-3">
        <p className="mb-2 text-sm font-medium">State cookie</p>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Name"
            value={cookie.name}
            onChange={(v) => setSub("state_cookie", "name", v)}
            placeholder="orion_oauth_state"
          />
          <SelectField
            label="SameSite"
            value={cookie.same_site}
            onChange={(v) => setSub("state_cookie", "same_site", v)}
            options={SAME_SITE}
            includeEmpty="Lax (default)"
          />
          <TextField
            label="Path"
            value={cookie.path}
            onChange={(v) => setSub("state_cookie", "path", v)}
            placeholder="/"
          />
          <NumberField
            label="Max age"
            unit="secs"
            value={cookie.max_age}
            onChange={(v) => setSub("state_cookie", "max_age", v)}
            min={1}
            max={86400}
            placeholder="600"
          />
        </div>
        <div className="mt-3">
          <ToggleField
            label="Secure"
            description="On by default. The max age sizes one consent screen, not a session: it is also how long a replayable state token stays valid."
            checked={cookie.secure ?? true}
            onCheckedChange={(c) => setSub("state_cookie", "secure", c ? undefined : false)}
          />
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Return-to destination</p>
          {returnTo ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => set("return_to", undefined)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set("return_to", { param: "next", allow_list: [] })}
            >
              <Plus className="h-3.5 w-3.5" /> Carry a destination
            </Button>
          )}
        </div>
        {returnTo ? (
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Query parameter"
              value={returnTo.param}
              onChange={(v) => setSub("return_to", "param", v)}
              placeholder="next"
            />
            <StringListField
              label="Allow list"
              value={returnTo.allow_list}
              onChange={(v) => setSub("return_to", "allow_list", v ?? [])}
              placeholder="https://app.example.com/"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            A pre-login destination read on the authorize leg, checked against an allow-list of
            absolute URLs there, sealed into the state and handed back at{" "}
            <code className="font-mono">metadata.oauth.return_to</code>.
          </p>
        )}
      </div>

      {findings.length > 0 && (
        <Callout variant="warning" className="text-xs">
          <p className="font-medium">Before saving — the server refuses a block shaped like this:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {findings.map((f) => (
              <li key={`${f.path}:${f.message}`}>
                <code className="font-mono">{f.path}</code> — {f.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Callout variant="muted" className="text-xs">
        Refused alongside <code className="font-mono">cache</code>: the response cache keys on the
        request and never on the caller, so a stored 302 would replay one browser's state cookie to
        the next visitor. Pair with <code className="font-mono">response.cookies</code> so the
        workflow can set the session it mints.
      </Callout>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => onChange(undefined)}
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove OAuth2 sign-in
      </Button>
    </ConfigSection>
  )
}
