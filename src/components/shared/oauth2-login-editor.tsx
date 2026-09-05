import type { OAuth2LoginConfig } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  ConfigSection,
  NumberField,
  SelectField,
  StringListField,
  TextField,
  ToggleField,
} from "@/components/shared/config-field"
import { Plus, Trash2 } from "lucide-react"

const CLIENT_AUTH = [
  { value: "basic", label: "HTTP Basic (RFC 6749 §2.3.1)" },
  { value: "body", label: "Form body" },
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

/**
 * Inbound OAuth2 / OIDC sign-in (Orion 1.6). Orion owns the redirect, the
 * state cookie, the CSRF binding, PKCE and the code exchange; the workflow
 * receives the grant at `metadata.oauth`. This is *establishment*, which is
 * why it sits beside `auth` rather than being a fourth mode of it — the two
 * compose: `oauth2_login` mints a session, `auth.mode = "jwt"` guards it.
 */
export function OAuth2LoginEditor({
  value,
  onChange,
}: {
  value: OAuth2LoginConfig | undefined
  onChange: (next: OAuth2LoginConfig | undefined) => void
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

  const set = (field: keyof OAuth2LoginConfig, v: unknown) => {
    const next = { ...value } as Record<string, unknown>
    if (v === undefined || v === "") delete next[field]
    else next[field] = v
    onChange(next as unknown as OAuth2LoginConfig)
  }

  const setSub = (
    key: "state_cookie" | "return_to" | "id_token",
    field: string,
    v: unknown
  ) => {
    const sub: Record<string, unknown> = { ...((value[key] as Record<string, unknown>) ?? {}) }
    if (v === undefined || v === "") delete sub[field]
    else sub[field] = v
    set(key, Object.keys(sub).length ? sub : undefined)
  }

  const cookie = value.state_cookie ?? {}
  const idToken = value.id_token
  const returnTo = value.return_to

  return (
    <ConfigSection
      title="OAuth2 sign-in"
      description="The route pattern is the authorize leg; the callback path is where the provider sends the browser back. Both are gated for route collisions at activation."
    >
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Authorize URL"
          value={value.authorize_url}
          onChange={(v) => set("authorize_url", v)}
          placeholder="https://github.com/login/oauth/authorize"
        />
        <TextField
          label="Token URL"
          value={value.token_url}
          onChange={(v) => set("token_url", v)}
          placeholder="https://github.com/login/oauth/access_token"
        />
      </div>
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
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Redirect URI"
          value={value.redirect_uri}
          onChange={(v) => set("redirect_uri", v)}
          placeholder="https://app.example.com/api/v1/data/v1/auth/github/callback"
        />
        <TextField
          label="Callback path"
          value={value.callback_path}
          onChange={(v) => set("callback_path", v)}
          placeholder="/v1/auth/github/callback"
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        The callback path is a second, static route on this channel — no{" "}
        <code className="font-mono">{"{param}"}</code> segments — and must differ from the route
        pattern. The redirect URI is sent on both legs; RFC 6749 requires them to match.
      </p>
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
                placeholder="https://www.googleapis.com/oauth2/v3/certs"
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
            Absent is plain OAuth2: the grant is an access token and nothing about the user is
            verified here.
          </p>
        )}
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
