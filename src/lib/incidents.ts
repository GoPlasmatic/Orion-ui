import type {
  BackgroundTaskReport,
  ChannelLoadIssue,
  ConnectorLoadIssue,
  CronOccurrenceSummary,
  ModelLoadIssue,
  PluginLoadIssue,
  Trace,
} from "@/api/types"
import { entityRoute } from "@/lib/audit-routes"
import type { BreakerRow } from "@/lib/breakers"
import { cronBacklog, isFailedOrSkipped } from "@/lib/cron"
import { componentRoute } from "@/lib/health"
import { parseEngineError } from "@/lib/trace-error"
import { errorLevel, formatPct } from "@/lib/traffic-encoding"
import { plural, serverTime } from "@/lib/utils"

/**
 * Incidents: what the dashboard lists and the sidebar counts, as data.
 *
 * - Failures group by an *error signature* (code, wrapper phrases, and the
 *   cause with its numbers, quotes, ids, keys and command words normalised).
 * - A failure incident resolves once every channel in it has succeeded since
 *   its own last failure, shows "Recovered" for an hour, then drops off.
 * - Live signals (quarantines, failed loads, failing channels, breakers, DLQ,
 *   cron backlog, degraded components) are open while present.
 * - Acknowledgement is per browser and holds until the incident fails again.
 *
 * Pure; `hooks/use-attention.ts` feeds it.
 */

/** Failures older than this are history, not an incident. */
export const FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000
/** A resolved incident stays visible this long after its last failure. */
export const RESOLVED_TTL_MS = 60 * 60 * 1000
/** A failed cron trace and its occurrence are one failure if this close. */
const OCCURRENCE_MATCH_MS = 2 * 60 * 1000
/** Acks older than this are forgotten. */
const ACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** A channel failing in the window, by the same bands the map paints. */
const isFailing = (errorPct: number | null) => {
  const level = errorLevel(errorPct)
  return level === "warning" || level === "critical"
}

// ---------------------------------------------------------------------------
// Error signatures
// ---------------------------------------------------------------------------

export interface ErrorSignature {
  /** The grouping key. Equal signatures are one incident. */
  signature: string
  /** The leading code (`FUNCTION_ERROR`, `circuit_open`), when there is one. */
  code: string | null
  /** The wrapper phrases naming where it failed, normalised ("Task {} error · Function execution error"). */
  phrase: string | null
  /** The cause up to its failure word, normalised, with `{A}` for each command word. */
  head: string
  /** The command words `{A}` stands for in `head`, in order. */
  tokens: string[]
}

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const QUOTED_RE = /'[^']*'|"[^"]*"|`[^`]*`/g
// `soma:clock:pair`, `host:6379` — a key or an address, never a phrase.
const KEY_RE = /\b[\w.-]+(?::[\w.-]+)+\b/g
// A long hex run, or a token mixing letters and digits: an id, not a word.
const ID_RE = /\b(?:[0-9a-f]{12,}|(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{10,})\b/gi
const SUBJECT_RE = /\b(task|workflow|step)\s+(?!\{)[^\s:]+(?=\s+(?:error|failed))/gi
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:ms|s|m|h|kb|mb|gb|b)?\b/gi
// An upper-case word is a command or verb (`MGET`, `POST`); `IO_ERROR` has no boundary at `_`.
const CAPS_RE = /\b[A-Z][A-Z0-9]+\b/g
const FAILURE_WORD =
  /\b(?:failed|failure|errored|error|timed out|timeout|refused|unavailable|unreachable|not found|denied|exceeded|rejected|reset|closed)\b/i

function normalise(segment: string, tokens: string[] = []): string {
  return segment
    .replace(URL_RE, "{url}")
    .replace(UUID_RE, "{id}")
    .replace(QUOTED_RE, "'…'")
    .replace(KEY_RE, "{key}")
    .replace(ID_RE, "{id}")
    .replace(SUBJECT_RE, "$1 {}")
    .replace(NUMBER_RE, "#")
    .replace(CAPS_RE, (word) => {
      tokens.push(word)
      return "{A}"
    })
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The signature of one error message. The code and wrappers come from
 * `parseEngineError`; the cause is normalised and cut after its failure word,
 * so `Redis MGET failed for 2 keys` and `Redis SETEX failed for key '…'` from
 * another task share the head `Redis {A} failed`.
 */
export function errorSignature(message: string | null | undefined): ErrorSignature {
  if (!(message ?? "").trim()) return { signature: "∅", code: null, phrase: null, head: "", tokens: [] }
  const parsed = parseEngineError(message)
  const tokens: string[] = []
  const cause = normalise(parsed.cause, tokens)
  const fw = FAILURE_WORD.exec(cause)
  let head = (fw ? cause.slice(0, fw.index + fw[0].length) : cause).slice(0, 120)
  // A head that is only the failure word says nothing; keep the clause.
  if (head.split(" ").length < 2) head = cause.slice(0, 120)
  const used = (head.match(/\{A\}/g) ?? []).length
  const phrase = parsed.wrappers.length ? parsed.wrappers.map((w) => normalise(w)).join(" · ") : null
  return {
    signature: [parsed.code ?? "", phrase ?? "", head].join(" | "),
    code: parsed.code,
    phrase,
    head,
    tokens: tokens.slice(0, used),
  }
}

/** A head with its command words filled in from every variant seen. */
function titleFrom(head: string, variants: string[][]): string {
  if (!head) return "Failed with no error recorded"
  let k = 0
  const text = head
    .replace(/\{A\}/g, () => {
      const v = variants[k++] ?? []
      return v.length > 3 ? `${v.slice(0, 3).join("/")}/…` : v.join("/") || "…"
    })
    .replace(/#/g, "N")
    .replace(/\{(id|url)\}/g, "…")
    .replace(/\{key\}/g, "key")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ---------------------------------------------------------------------------
// Grouping failures
// ---------------------------------------------------------------------------

export interface GroupChannel {
  name: string
  failures: number
  first: number
  last: number
  /** A failure on this channel came from a schedule. */
  cron: boolean
  channelId: string | null
}

export interface FailureGroup {
  signature: string
  code: string | null
  phrase: string | null
  title: string
  /** The newest raw message, for a title attribute. */
  sample: string | null
  channels: GroupChannel[]
  failures: number
  /** Scheduled runs among the failures. */
  scheduled: number
  first: number
  last: number
  latestTraceId: string | null
  /** Occurrence-only groups name their status (`failed`, `skipped_misfire`…); null for trace groups. */
  occurrenceStatus: string | null
  latestOccurrenceId: string | null
}

interface Member {
  at: number
  channel: string
  channelId: string | null
  cron: boolean
  traceId: string | null
  occurrenceId: string | null
  /** An occurrence with no trace: its status is the signature. Null for a trace. */
  status: string | null
  message: string | null
  sig: ErrorSignature
}

const OCCURRENCE_TITLE: Record<string, string> = {
  failed: "Scheduled runs failed",
  skipped_misfire: "Scheduled runs skipped — misfire",
  skipped_singleton: "Scheduled runs skipped — key still held",
}

const occurrenceAt = (o: CronOccurrenceSummary) =>
  serverTime(o.completed_at) ?? serverTime(o.started_at) ?? serverTime(o.scheduled_for)

function traceMember(t: Trace, floor: number): Member | null {
  if (t.status !== "failed") return null
  const at = serverTime(t.created_at)
  if (at == null || at < floor) return null
  return {
    at,
    channel: t.channel,
    channelId: t.channel_id ?? null,
    cron: t.mode === "cron",
    traceId: t.id,
    occurrenceId: null,
    status: null,
    message: t.error_message,
    sig: errorSignature(t.error_message),
  }
}

function occurrenceMember(o: CronOccurrenceSummary, at: number): Member {
  return {
    at,
    channel: o.channel_name,
    channelId: o.channel_id,
    cron: true,
    traceId: null,
    occurrenceId: o.id,
    status: o.status,
    message: null,
    sig: { signature: `occurrence | ${o.status}`, code: null, phrase: null, head: "", tokens: [] },
  }
}

/**
 * Failed traces and failed or skipped occurrences inside the lookback, grouped
 * by signature. A failed occurrence with a failed cron trace on the same
 * channel within two minutes is that trace's failure, counted once (the
 * occurrence summary carries no error text). Any other occurrence groups by
 * its status.
 */
export function groupFailures({
  traces,
  occurrences = [],
  now,
  lookbackMs = FAILURE_LOOKBACK_MS,
}: {
  traces: Trace[]
  occurrences?: CronOccurrenceSummary[]
  now: number
  lookbackMs?: number
}): FailureGroup[] {
  const floor = now - lookbackMs
  const members = traces.map((t) => traceMember(t, floor)).filter((m): m is Member => m !== null)
  const cronTraces = members.filter((m) => m.cron)
  for (const o of occurrences) {
    if (!isFailedOrSkipped(o.status)) continue
    const at = occurrenceAt(o)
    if (at == null || at < floor) continue
    if (o.status === "failed") {
      const start = serverTime(o.started_at) ?? serverTime(o.scheduled_for) ?? at
      const twin = cronTraces.find(
        (m) =>
          m.channel === o.channel_name &&
          m.occurrenceId == null &&
          (Math.abs(m.at - start) <= OCCURRENCE_MATCH_MS || Math.abs(m.at - at) <= OCCURRENCE_MATCH_MS),
      )
      if (twin) {
        twin.occurrenceId = o.id
        continue
      }
    }
    members.push(occurrenceMember(o, at))
  }

  // Oldest first, so first-seen order is the order things went wrong.
  members.sort((a, b) => a.at - b.at)
  const groups = new Map<string, { g: FailureGroup; variants: Map<string, number>[]; head: string }>()
  for (const m of members) {
    let entry = groups.get(m.sig.signature)
    if (!entry) {
      entry = {
        g: {
          signature: m.sig.signature,
          code: m.sig.code,
          phrase: m.sig.phrase,
          title: "",
          sample: null,
          channels: [],
          failures: 0,
          scheduled: 0,
          first: m.at,
          last: m.at,
          latestTraceId: null,
          occurrenceStatus: m.status,
          latestOccurrenceId: null,
        },
        variants: [],
        head: m.sig.head,
      }
      groups.set(m.sig.signature, entry)
    }
    const { g, variants } = entry
    g.failures++
    if (m.cron) g.scheduled++
    g.last = Math.max(g.last, m.at)
    if (m.message) g.sample = m.message
    if (m.traceId) g.latestTraceId = m.traceId
    if (m.occurrenceId) g.latestOccurrenceId = m.occurrenceId
    m.sig.tokens.forEach((tok, i) => {
      const v = variants[i] ?? new Map<string, number>()
      v.set(tok, (v.get(tok) ?? 0) + 1)
      variants[i] = v
    })
    let ch = g.channels.find((c) => c.name === m.channel)
    if (!ch) {
      ch = { name: m.channel, failures: 0, first: m.at, last: m.at, cron: false, channelId: null }
      g.channels.push(ch)
    }
    ch.failures++
    ch.last = Math.max(ch.last, m.at)
    ch.cron ||= m.cron
    ch.channelId ??= m.channelId
  }

  return [...groups.values()].map(({ g, variants, head }) => {
    // Most frequent first; ties keep first-seen order (Map insertion order).
    const ordered = variants.map((v) =>
      [...v.entries()]
        .map(([tok, n], i) => ({ tok, n, i }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => x.tok),
    )
    const status = g.occurrenceStatus
    g.title = status ? (OCCURRENCE_TITLE[status] ?? `Scheduled runs ${status}`) : titleFrom(head, ordered)
    g.channels.sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name))
    return g
  })
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface WindowedOutcome {
  ok: number
  failed: number
}

/** What says a channel has run cleanly since it failed. */
export interface RecoveryEvidence {
  /** The live traffic window; null before a second sample (no ordering to read). */
  window: { start: number; label: string; byChannel: ReadonlyMap<string, WindowedOutcome> } | null
  /** channel name → newest completed trace (ms). */
  lastCompletedTrace: ReadonlyMap<string, number>
  /** channel name → newest completed scheduled run (ms). */
  lastCompletedRun: ReadonlyMap<string, number>
}

export type RecoveryProof = "traffic" | "trace" | "schedule"

export interface ChannelRecovery {
  recovered: boolean
  /** Failing again inside a window that began after the last recorded failure. */
  failingNow: boolean
  proof: RecoveryProof | null
  /** Clean requests in the window, when the window began after the failure. */
  cleanRuns: number | null
}

export function channelRecovery(
  channel: string,
  lastFailure: number,
  evidence: RecoveryEvidence,
): ChannelRecovery {
  const w = evidence.window
  const outcome = w?.byChannel.get(channel)
  const after = !!w && !!outcome && w.start > lastFailure
  // Failures in a window that began after the last one we hold: newer ones the
  // trace list did not keep. Not recovered, whatever else says.
  if (after && outcome!.failed > 0) return { recovered: false, failingNow: true, proof: null, cleanRuns: null }
  const cleanRuns = after ? outcome!.ok : null
  const trace = evidence.lastCompletedTrace.get(channel)
  if (trace != null && trace > lastFailure) return { recovered: true, failingNow: false, proof: "trace", cleanRuns }
  const run = evidence.lastCompletedRun.get(channel)
  if (run != null && run > lastFailure) return { recovered: true, failingNow: false, proof: "schedule", cleanRuns }
  if (after && outcome!.ok > 0) return { recovered: true, failingNow: false, proof: "traffic", cleanRuns }
  return { recovered: false, failingNow: false, proof: null, cleanRuns: null }
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export type IncidentKind =
  | "quarantine"
  | "connector"
  | "plugin"
  | "model"
  | "failing"
  | "failures"
  | "occurrences"
  | "component"
  | "task"
  | "breaker"
  | "dlq"
  | "backlog"

export interface IncidentLink {
  label: string
  to: string
}

export interface IncidentChannel extends GroupChannel {
  recovery: ChannelRecovery | null
}

export interface Incident {
  /** Stable across polls; the acknowledgement key. */
  key: string
  kind: IncidentKind
  /** 0 is worst. */
  severity: number
  tone: "destructive" | "warning"
  state: "open" | "resolved"
  title: string
  /** One line of what it is. A failure group's line is composed by the view. */
  detail: string
  /** Where to act. */
  to: string
  links: IncidentLink[]
  channels: IncidentChannel[]
  /** Failure groups only. */
  group: FailureGroup | null
  /** Ms; null for a live signal, which is happening now. */
  firstSeen: number | null
  lastSeen: number | null
  /** Resolved only: why, in words. */
  recoveredBecause: string | null
  /** Resolved only: when it drops off. */
  closesAt: number | null
}

export interface TrafficSignal {
  label: string
  channels: { channel: string; ok: number; failed: number; errorPct: number | null }[]
}

export interface LiveSignals {
  quarantined?: ChannelLoadIssue[]
  connectors?: ConnectorLoadIssue[]
  plugins?: PluginLoadIssue[]
  models?: ModelLoadIssue[]
  /** Per-channel outcomes over the live window; null before a second sample. */
  traffic?: TrafficSignal | null
  components?: [string, string][]
  tasks?: BackgroundTaskReport[]
  breakers?: BreakerRow[]
  dlqExhausted?: number
  cronBacklog?: { pending: number; oldestSec: number | null } | null
}

export interface IncidentInput {
  now: number
  groups: FailureGroup[]
  evidence: RecoveryEvidence
  live: LiveSignals
  /** channel name → id, for links when the signal did not carry one. */
  channelIdByName?: ReadonlyMap<string, string>
  connectorIdByName?: ReadonlyMap<string, string>
}

const COMPONENT_DETAIL: Record<string, string> = {
  cron: "Declared schedules are not running — every liveness signal is green",
  packages: "A package this node applies at startup is still applying, or did not apply",
  engine_reload: "The last reload failed; this node serves the previous generation",
  config_propagation: "A change committed here has not reached the peers",
}

const PROOF_WORDS: Record<RecoveryProof, string> = {
  traffic: "clean traffic",
  trace: "a newer completed trace",
  schedule: "a newer completed run",
}

const enc = encodeURIComponent
const mapPath = (name: string) => `/system-map?select=${enc(name)}`
const failedTracesPath = (name?: string) =>
  name ? `/traces?channel=${enc(name)}&status=failed` : "/traces?status=failed"

type SignalSpec = Pick<Incident, "key" | "kind" | "severity" | "tone" | "title" | "detail" | "to"> &
  Partial<Pick<Incident, "links" | "channels">>

/** A live signal: open, no history, no links unless given. */
function signal(spec: SignalSpec): Incident {
  return {
    state: "open",
    group: null,
    firstSeen: null,
    lastSeen: null,
    recoveredBecause: null,
    closesAt: null,
    links: [],
    channels: [],
    ...spec,
  }
}

interface Lookups {
  now: number
  channelIdByName: ReadonlyMap<string, string>
  connectorIdByName: ReadonlyMap<string, string>
}

function channelRef(name: string, l: Lookups, channelId?: string | null): IncidentChannel {
  return {
    name,
    failures: 0,
    first: l.now,
    last: l.now,
    cron: false,
    channelId: channelId || l.channelIdByName.get(name) || null,
    recovery: null,
  }
}

/** The failure groups as incidents, open or recovered, plus the channels they cover. */
export function failureIncidents(
  groups: FailureGroup[],
  evidence: RecoveryEvidence,
  failingNow: ReadonlySet<string>,
  now: number,
): { incidents: Incident[]; covered: Set<string> } {
  const incidents: Incident[] = []
  const covered = new Set<string>()
  for (const g of groups) {
    const channels: IncidentChannel[] = g.channels.map((c) => ({
      ...c,
      recovery: channelRecovery(c.name, c.last, evidence),
    }))
    const stillFailing = channels.some((c) => c.recovery?.failingNow || failingNow.has(c.name))
    const resolved = !stillFailing && channels.every((c) => c.recovery?.recovered)
    if (resolved && now - g.last > RESOLVED_TTL_MS) continue
    for (const c of channels) covered.add(c.name)

    const occurrenceOnly = g.occurrenceStatus != null
    const skip = occurrenceOnly && g.occurrenceStatus !== "failed"
    const single = channels.length === 1 ? channels[0] : null
    const links: IncidentLink[] = []
    if (!occurrenceOnly) links.push({ label: "Traces", to: failedTracesPath(single?.name) })
    if (channels.some((c) => c.cron)) {
      links.push({
        label: "Schedules",
        to: single?.channelId ? `/schedules?channel_id=${enc(single.channelId)}` : "/schedules",
      })
    }
    links.push({ label: "Map", to: mapPath(channels[0]?.name ?? "") })

    incidents.push({
      key: `fail:${g.signature}`,
      kind: occurrenceOnly ? "occurrences" : "failures",
      severity: stillFailing ? 2 : skip ? 7 : 3,
      tone: skip ? "warning" : "destructive",
      state: resolved ? "resolved" : "open",
      title: g.title,
      detail: [g.code, g.phrase].filter(Boolean).join(" · "),
      to: links[0].to,
      links,
      channels,
      group: g,
      firstSeen: g.first,
      lastSeen: g.last,
      recoveredBecause: resolved ? recoveryText(channels, evidence) : null,
      closesAt: resolved ? g.last + RESOLVED_TTL_MS : null,
    })
  }
  return { incidents, covered }
}

function recoveryText(channels: IncidentChannel[], evidence: RecoveryEvidence): string {
  const proofs = [...new Set(channels.map((c) => c.recovery?.proof).filter((p): p is RecoveryProof => !!p))]
  const clean = channels.reduce((n, c) => n + (c.recovery?.cleanRuns ?? 0), 0)
  const who = channels.length === 1 ? "The channel has" : `All ${channels.length} channels have`
  const runs = clean > 0 ? ` (${plural(clean, "clean request")} in the last ${evidence.window?.label ?? "window"})` : ""
  return `${who} succeeded since — ${proofs.map((p) => PROOF_WORDS[p]).join(", ")}${runs}`
}

function quarantineIncidents(list: ChannelLoadIssue[], l: Lookups): Incident[] {
  return list.map((q) =>
    signal({
      key: `quarantine:${q.channel}`,
      kind: "quarantine",
      severity: 0,
      tone: "destructive",
      title: `Quarantined: ${q.channel}`,
      detail: q.reason || "Refused at load — the route is not being served",
      to: entityRoute("channel", q.channel_id || l.channelIdByName.get(q.channel)) ?? mapPath(q.channel),
      links: [{ label: "Map", to: mapPath(q.channel) }],
      channels: [channelRef(q.channel, l, q.channel_id)],
    }),
  )
}

function loadIncidents(live: LiveSignals, l: Lookups): Incident[] {
  return [
    ...(live.connectors ?? []).map((c) => {
      const page = entityRoute("connector", c.connector_id || l.connectorIdByName.get(c.connector))
      return signal({
        key: `connector:${c.connector}`,
        kind: "connector",
        severity: 1,
        tone: "destructive",
        title: `Connector failed to load: ${c.connector}`,
        detail: c.reason ? `${c.stage}: ${c.reason}` : "Every task using it is failing",
        to: page ? `${page}?test=1` : "/connectors",
      })
    }),
    ...(live.plugins ?? []).map((p) =>
      signal({
        key: `plugin:${p.plugin}@${p.version}`,
        kind: "plugin",
        severity: 1,
        tone: "destructive",
        title: `Plugin not loaded: ${p.plugin} v${p.version}`,
        detail: `${p.stage}: ${p.reason}`,
        to: entityRoute("plugin", p.plugin) ?? "/plugins",
      }),
    ),
    ...(live.models ?? []).map((m) =>
      signal({
        key: `model:${m.model}@${m.version}`,
        kind: "model",
        severity: 1,
        tone: "destructive",
        title: `Model not serving: ${m.model} v${m.version}`,
        detail: `${m.stage}: ${m.reason}`,
        to: entityRoute("model", m.model) ?? "/models",
      }),
    ),
  ]
}

/** Failing channels no failure group already covers. The counters are the witness: a 500 may keep no trace. */
function failingIncidents(traffic: TrafficSignal | null | undefined, covered: Set<string>, l: Lookups): Incident[] {
  if (!traffic) return []
  return traffic.channels
    .filter((c) => c.failed > 0 && isFailing(c.errorPct) && !covered.has(c.channel))
    .map((c) =>
      signal({
        key: `failing:${c.channel}`,
        kind: "failing",
        severity: 2,
        tone: "destructive",
        title: `Failing: ${c.channel}`,
        detail: `${formatPct(c.errorPct)} of ${plural(c.ok + c.failed, "request")} failed in the last ${traffic.label}`,
        to: failedTracesPath(c.channel),
        links: [{ label: "Map", to: mapPath(c.channel) }],
        channels: [channelRef(c.channel, l)],
      }),
    )
}

function componentIncidents(components: [string, string][]): Incident[] {
  return components.map(([component, state]) =>
    signal({
      key: `component:${component}`,
      kind: "component",
      severity: 4,
      tone: "warning",
      title: `${component} is ${state}`,
      detail: COMPONENT_DETAIL[component] ?? "Reported by /health",
      to: componentRoute(component) ?? `/engine#component-${component}`,
    }),
  )
}

function taskIncidents(tasks: BackgroundTaskReport[]): Incident[] {
  return tasks
    .filter((t) => t.restarts > 0 || t.state !== "running")
    .map((t) =>
      signal({
        key: `task:${t.name}`,
        kind: "task",
        severity: 5,
        tone: t.state !== "running" && t.required ? "destructive" : "warning",
        title:
          t.state === "running"
            ? `Background task restarted ${t.restarts}×: ${t.name}`
            : `Background task ${t.state}: ${t.name}`,
        detail:
          t.state === "running"
            ? "Up now, and has been failing"
            : t.required
              ? "A required task stopped for good — /readyz fails"
              : "Not required; the rest of the node keeps serving",
        to: "/engine#component-background_tasks",
      }),
    )
}

/** One incident per connector: three channels tripping on one backend are one outage. */
function breakerIncidents(rows: BreakerRow[], l: Lookups): Incident[] {
  const byConnector = new Map<string, BreakerRow[]>()
  for (const b of rows) byConnector.set(b.connector, [...(byConnector.get(b.connector) ?? []), b])
  return [...byConnector].map(([connector, list]) => {
    const named = list.filter((r) => r.channel)
    const state = list.every((r) => r.state === list[0].state) ? list[0].state.replace("_", "-") : "open"
    return signal({
      key: `breaker:${connector}`,
      kind: "breaker",
      severity: 6,
      tone: "warning",
      title: `Circuit breaker ${state}: ${connector}`,
      detail: `${named.length ? `${plural(named.length, "channel")} · ` : ""}this replica only`,
      to: list.length === 1 ? `/circuit-breakers?key=${enc(list[0].key)}` : "/circuit-breakers",
      channels: named.map((r) => channelRef(r.channel, l)),
    })
  })
}

function dlqIncidents(exhausted: number): Incident[] {
  if (exhausted <= 0) return []
  return [
    signal({
      key: "dlq:exhausted",
      kind: "dlq",
      severity: 6,
      tone: "destructive",
      title: `${plural(exhausted, "DLQ entry", "DLQ entries")} exhausted`,
      detail: "Async failures that ran out of retries — requeue or purge them",
      to: "/trace-dlq?exhausted=true",
    }),
  ]
}

function backlogIncidents(backlog: LiveSignals["cronBacklog"]): Incident[] {
  if (!backlog || cronBacklog(backlog.pending, backlog.oldestSec) !== "backlog") return []
  return [
    signal({
      key: "backlog:cron",
      kind: "backlog",
      severity: 7,
      tone: "warning",
      title: `Cron backlog: ${plural(backlog.pending, "occurrence")} waiting`,
      detail:
        backlog.oldestSec != null
          ? `The oldest has waited ${Math.round(backlog.oldestSec / 60)} min for a worker`
          : "Occurrences are produced faster than they run",
      to: "/schedules?status=pending",
    }),
  ]
}

export function buildIncidents({
  now,
  groups,
  evidence,
  live,
  channelIdByName = new Map(),
  connectorIdByName = new Map(),
}: IncidentInput): Incident[] {
  const l: Lookups = { now, channelIdByName, connectorIdByName }
  const failingNow = new Set(
    (live.traffic?.channels ?? []).filter((c) => c.failed > 0 && isFailing(c.errorPct)).map((c) => c.channel),
  )
  const failures = failureIncidents(groups, evidence, failingNow, now)
  return sortIncidents([
    ...failures.incidents,
    ...quarantineIncidents(live.quarantined ?? [], l),
    ...loadIncidents(live, l),
    ...failingIncidents(live.traffic, failures.covered, l),
    ...componentIncidents(live.components ?? []),
    ...taskIncidents(live.tasks ?? []),
    ...breakerIncidents(live.breakers ?? [], l),
    ...dlqIncidents(live.dlqExhausted ?? 0),
    ...backlogIncidents(live.cronBacklog),
  ])
}

/**
 * Open before resolved; then severity; then destructive before warning; then
 * most recent, a live signal counting as now; then by title.
 */
export function sortIncidents(list: Incident[]): Incident[] {
  const recency = (i: Incident) => i.lastSeen ?? Number.MAX_SAFE_INTEGER
  return [...list].sort(
    (a, b) =>
      Number(a.state === "resolved") - Number(b.state === "resolved") ||
      a.severity - b.severity ||
      Number(a.tone === "warning") - Number(b.tone === "warning") ||
      recency(b) - recency(a) ||
      a.title.localeCompare(b.title),
  )
}

// ---------------------------------------------------------------------------
// Acknowledgement
// ---------------------------------------------------------------------------

export const ACK_STORAGE_KEY = "orion-incidents-ack"

/** incident key → when it was acknowledged (ms). */
export type AckMap = Readonly<Record<string, number>>

/** Keep only `key → finite number` from whatever storage held. */
export function sanitizeAcks(value: unknown): AckMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [k, t] of Object.entries(value)) if (typeof t === "number" && Number.isFinite(t)) out[k] = t
  return out
}

/** Drop acks older than a week, so the key does not grow without bound. */
export function pruneAcks(acks: AckMap, now: number, maxAgeMs = ACK_MAX_AGE_MS): AckMap {
  const out: Record<string, number> = {}
  for (const [k, t] of Object.entries(acks)) if (now - t <= maxAgeMs) out[k] = t
  return out
}

/**
 * Acknowledged, and nothing has failed since. A live signal has no failure
 * time, so its ack holds for as long as the signal does.
 */
export function isAcked(incident: Pick<Incident, "key" | "lastSeen">, acks: AckMap): boolean {
  const at = acks[incident.key]
  if (at == null) return false
  return incident.lastSeen == null || incident.lastSeen <= at
}

/** What the sidebar counts: open and not acknowledged. Resolved incidents never count. */
export function needsAttention(incidents: Incident[], acks: AckMap): Incident[] {
  return incidents.filter((i) => i.state === "open" && !isAcked(i, acks))
}
