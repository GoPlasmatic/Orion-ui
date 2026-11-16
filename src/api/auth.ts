import { readSessionStorage, readStorage, writeSessionStorage, writeStorage } from "@/lib/storage"

/**
 * The admin credential this tab presents, and what the server has said about
 * it.
 *
 * Orion 2.0 guards `/api/v2/admin/*` and `/metrics` with `admin_auth`, which a
 * production server must enable. The key goes in `Authorization: Bearer <key>`
 * by default, or raw in whatever header `admin_auth.header` names. A key is
 * **full** or **read-only**: read-only keys may `GET`, plan a deployment and
 * use the authoring dry-runs, and are refused everything else with a 403
 * `FORBIDDEN` (never a 401 — the credential is valid, its authority is not).
 *
 * The one behavior this module exists for: **a request with no key is a
 * failed attempt.** After five failures the server locks the caller's address
 * out with exponential backoff (up to 30 s), during which even a correct key
 * is answered 401 `Invalid API key`. The console polls a dozen endpoints at
 * once, so a tab without a key would lock itself out before the first
 * response arrived. Two rules prevent that:
 *
 *  - **One probe first.** No guarded request leaves the browser until a single
 *    probe (`GET admin/runtime-capabilities`) has answered; the rest wait on
 *    it (`whenProbed`).
 *  - **Hold back after a 401.** Once the server has asked for a credential,
 *    guarded requests fail locally (`isHeldBack`) until a key is entered — the
 *    key dialog's own probe is the next request the server sees.
 *
 * When the server answers without a credential, admin auth is off (or a proxy
 * injects one — the image's nginx can, from `ORION_ADMIN_AUTHORIZATION`), and
 * the console never asks.
 */

export type AdminAuthStatus =
  /** Nothing asked yet. */
  | "unprobed"
  /** The server answered with no credential from this tab: admin auth is off, or a proxy supplies the key. */
  | "open"
  /** The key this tab holds was accepted. */
  | "accepted"
  /** A credential is required and none that works is held; guarded requests are held back. */
  | "needed"

export interface AdminAuthState {
  status: AdminAuthStatus
  /** Why a credential is `needed`: none was sent, or the one sent was refused (or the address is in backoff — the server does not say which). */
  reason: "missing" | "refused" | null
  /** The key this tab sends. Kept in `sessionStorage`, so it does not outlive the tab. */
  key: string | null
  /** The header the key travels in. `Authorization` sends `Bearer <key>`; any other name sends the key raw. */
  header: string
  /**
   * What the held key may do. `read-only` is learned from the first mutating
   * request a read-only key is refused (nothing announces it in advance);
   * `full` from the first mutating request that succeeds.
   */
  access: "unknown" | "full" | "read-only"
}

const KEY_STORAGE = "orion-admin-key"
const HEADER_STORAGE = "orion-admin-header"
export const DEFAULT_AUTH_HEADER = "Authorization"

function initialState(): AdminAuthState {
  return {
    status: "unprobed",
    reason: null,
    key: readSessionStorage(KEY_STORAGE),
    header: readStorage(HEADER_STORAGE) || DEFAULT_AUTH_HEADER,
    access: "unknown",
  }
}

let state: AdminAuthState = initialState()
const listeners = new Set<() => void>()

function set(patch: Partial<AdminAuthState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export const getAdminAuth = (): AdminAuthState => state

export function subscribeAdminAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Paths the server's admin guard covers. `/health` is not one: it answers anyone, adding admin-only detail for a valid key. */
export function isGuardedPath(url: string): boolean {
  return url.startsWith("/api/v2/admin/") || url === "/metrics" || url.startsWith("/metrics?")
}

/**
 * Paths the admin key may travel to: the guarded ones, and `/health` for its
 * admin-only detail. **Never the data plane** — a channel is called the way a
 * real caller would call it, with only the headers the console was given; the
 * admin key would both leak to the channel and stand in for (or clash with)
 * a channel's own `Authorization` check.
 */
export function mayCarryAdminKey(url: string): boolean {
  return isGuardedPath(url) || url === "/health"
}

/** The header carrying the held key, or nothing when no key is held. */
export function credentialHeaders(): Record<string, string> {
  if (!state.key) return {}
  return state.header.toLowerCase() === "authorization"
    ? { Authorization: `Bearer ${state.key}` }
    : { [state.header]: state.key }
}

/** Whether a guarded request should fail locally rather than reach the server. */
export const isHeldBack = (): boolean => state.status === "needed"

/**
 * Hold a key (and optionally a header name) for this tab. `verified` when the
 * caller already probed it (`tryAdminKey`); otherwise the next guarded request
 * probes it.
 */
export function setAdminKey(key: string, header = state.header, verified = false): void {
  const trimmed = key.trim()
  writeSessionStorage(KEY_STORAGE, trimmed || null)
  writeStorage(HEADER_STORAGE, header === DEFAULT_AUTH_HEADER ? null : header)
  probe = null
  set({
    key: trimmed || null,
    header,
    status: verified && trimmed ? "accepted" : "unprobed",
    reason: null,
    access: "unknown",
  })
}

/** Forget the held key. Guarded requests are held back until another is entered. */
export function clearAdminKey(): void {
  writeSessionStorage(KEY_STORAGE, null)
  probe = null
  set({ key: null, status: "needed", reason: "missing", access: "unknown" })
}

/**
 * A 401 from a guarded route. The server names the header it wanted when none
 * was sent (`Missing X-API-Key header`), which is how a server configured
 * with a custom `admin_auth.header` is discovered without asking.
 */
export function noteUnauthorized(message: string): void {
  const wanted = /^Missing (\S+) header$/.exec(message)?.[1]
  set({
    status: "needed",
    reason: state.key ? "refused" : "missing",
    header: wanted && !state.key ? wanted : state.header,
  })
}

/** A 403 `FORBIDDEN` on a mutating request: the key is read-only. */
export function noteForbidden(): void {
  if (state.access !== "read-only") set({ access: "read-only" })
}

/** A mutating request succeeded, so whatever was sent (or injected) has full access. */
export function noteMutationAccepted(): void {
  if (state.access !== "full") set({ access: "full" })
}

/** The probe and every other answered request: what a 2xx says about the credential. */
export function noteAuthorized(): void {
  const status: AdminAuthStatus = state.key ? "accepted" : "open"
  if (state.status !== status) set({ status, reason: null })
}

// ── The probe ────────────────────────────────────────────────────────────────

const PROBE_PATH = "/api/v2/admin/runtime-capabilities"
let probe: Promise<void> | null = null

/**
 * Resolve once the server has answered one guarded request with the current
 * credential. Concurrent callers share the one probe. A network failure does
 * not settle anything — the next request probes again — so a server that is
 * down is reported as unreachable by the request that needed it, not as an
 * auth problem.
 */
export function whenProbed(): Promise<void> {
  if (state.status !== "unprobed") return Promise.resolve()
  if (!probe) {
    probe = fetch(PROBE_PATH, { headers: credentialHeaders() })
      .then(async (res) => {
        if (res.status === 401) {
          noteUnauthorized(await errorMessage(res))
        } else {
          noteAuthorized()
        }
      })
      .catch(() => {
        probe = null
      })
  }
  return probe
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    return typeof body?.error?.message === "string" ? body.error.message : ""
  } catch {
    return ""
  }
}

/**
 * Probe a key before holding it, for the key dialog. Answers what the server
 * said: `accepted`, `refused` (wrong key — or the address is in its failed
 * attempt backoff, which looks identical), or `unreachable`.
 */
export async function tryAdminKey(
  key: string,
  header: string
): Promise<"accepted" | "refused" | "unreachable"> {
  const headers: Record<string, string> =
    header.toLowerCase() === "authorization" ? { Authorization: `Bearer ${key.trim()}` } : { [header]: key.trim() }
  try {
    const res = await fetch(PROBE_PATH, { headers })
    if (res.status === 401) return "refused"
    if (!res.ok) return "unreachable"
    return "accepted"
  } catch {
    return "unreachable"
  }
}

/** Test seam: back to a fresh tab. */
export function resetAdminAuthForTests(): void {
  probe = null
  state = initialState()
  for (const l of listeners) l()
}
