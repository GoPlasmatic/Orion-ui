import type {
  BackgroundTaskReport,
  ChannelLoadIssue,
  ConnectorLoadIssue,
  CronOccurrenceSummary,
  ModelLoadIssue,
  PluginLoadIssue,
  Trace,
} from "@/api/types"
import type { BreakerRow } from "@/lib/breakers"
import { componentRoute } from "@/lib/health"
import { serverTime } from "@/lib/utils"

/**
 * Incidents: what the dashboard and the sidebar count, as data.
 *
 * "Needs attention" used to list the five newest failed traces, whatever their
 * age and whatever happened next. On QA four failures from one Redis outage at
 * boot (`soma-clock-count`, `-pair`, `-reap` ×2) were still flagged 39 minutes
 * and hundreds of clean runs later. An incident is the fix for both halves of
 * that:
 *
 * - **Grouping.** Failures group by an *error signature* — the error with its
 *   numbers, quoted values, ids, keys and command words normalised, plus the
 *   wrapper phrases naming the failing function — so one outage across three
 *   channels reads as one line, "Redis MGET/SETEX/INCRBY failed".
 * - **Resolution.** An incident is resolved once every channel in it has
 *   succeeded since its own last failure: windowed traffic with ok > 0 over a
 *   window that began after the failure, a newer completed trace, or (for a
 *   cron channel) a newer completed occurrence. A resolved incident reads
 *   "Recovered · N min clean" for an hour and then drops off.
 *
 * Live signals (quarantines, failed loads, failing channels, open breakers,
 * DLQ exhaustion, cron backlog, degraded components) are incidents too: open
 * while the signal is present, gone when it is not.
 *
 * Acknowledgement is per browser (`orion-incidents-ack`: key → ack time) until
 * the server has a place to keep it. An ack holds until the incident fails
 * again after it.
 *
 * Pure and synchronous; `hooks/use-attention.ts` feeds it.
 */

/** Failures older than this are history, not an incident. */
export const FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000
/** A resolved incident stays visible this long after its last failure. */
export const RESOLVED_TTL_MS = 60 * 60 * 1000
/** A failed cron trace and its occurrence are one failure if this close. */
const OCCURRENCE_MATCH_MS = 2 * 60 * 1000
/** Acks older than this are forgotten. */
const ACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Failure share at which a channel in the window is worth naming. */
export const FAILING_PCT = 1
/** Pending occurrences waiting this long are a backlog, not scheduling jitter. */
const BACKLOG_AGE_SEC = 120
/** Without an age, this many pending occurrences is a backlog. */
const BACKLOG_COUNT = 10

// ---------------------------------------------------------------------------
// Error signatures
// ---------------------------------------------------------------------------

export interface ErrorSignature {
  /** The grouping key. Equal signatures are one incident. */
  signature: string
  /** The leading code (`FUNCTION_ERROR`, `circuit_open`), when there is one. */
  code: string | null
  /** The wrapper phrases naming where it failed ("Function execution error"). */
  phrase: string | null
  /** The cause up to its failure word, normalised, with `{A}` for each command word. */
  head: string
  /** The command words `{A}` stands for in `head`, in order. */
  tokens: string[]
}

const CODE = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z]+(?:_[a-z]+)+)\s*:\s*/
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const QUOTED_RE = /'[^']*'|"[^"]*"|`[^`]*`/g
// `soma:clock:pair`, `host:6379` — a key or an address, never a phrase.
const KEY_RE = /\b[\w.-]+(?::[\w.-]+)+\b/g
// A long hex run, or a token mixing letters and digits: an id, not a word.
const ID_RE = /\b(?:[0-9a-f]{12,}|(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{10,})\b/gi
const SUBJECT_RE = /\b(task|workflow|step)\s+(?!\{)[^\s:]+(?=\s+(?:error|failed))/gi
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:ms|s|m|h|kb|mb|gb|b)?\b/gi
// An upper-case word: a command or verb (`MGET`, `SETEX`, `POST`). Underscored
// codes (`IO_ERROR`) do not match — `_` is a word character, so no boundary.
const CAPS_RE = /\b[A-Z][A-Z0-9]+\b/g
const FAILURE_WORD =
  /\b(?:failed|failure|errored|error|timed out|timeout|refused|unavailable|unreachable|not found|denied|exceeded|rejected|reset|closed)\b/i
const WRAPPER =
  /^(?:(?:task|workflow|step) \{\} (?:error|failed)|(?:function|task|workflow) (?:execution )?error|execution error|error)$/i

function normalise(segment: string, tokens: string[]): string {
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
 * The signature of one error message. `FUNCTION_ERROR: Task probe error:
 * Function execution error: Redis MGET failed for 2 keys` becomes code
 * `FUNCTION_ERROR`, phrase `Task {} error · Function execution error`, head
 * `Redis {A} failed` with tokens `["MGET"]` — and so does the same failure on
 * `SETEX` from another task, which is the point.
 */
export function errorSignature(message: string | null | undefined): ErrorSignature {
  const raw = (message ?? "").trim()
  if (!raw) return { signature: "∅", code: null, phrase: null, head: "", tokens: [] }
  let rest = raw
  let code: string | null = null
  const m = CODE.exec(rest)
  if (m) {
    code = m[1]
    rest = rest.slice(m[0].length)
  }
  const segments = rest.split(/:\s+/).filter(Boolean)
  const wrappers: string[] = []
  let i = 0
  for (; i < segments.length - 1; i++) {
    const norm = normalise(segments[i], [])
    if (!WRAPPER.test(norm)) break
    wrappers.push(norm)
  }
  const tokens: string[] = []
  const cause = normalise(segments.slice(i).join(": "), tokens)
  const fw = FAILURE_WORD.exec(cause)
  let head = (fw ? cause.slice(0, fw.index + fw[0].length) : cause).slice(0, 120)
  // A head that is nothing but the failure word says nothing; keep the clause.
  if (head.split(" ").length < 2) head = cause.slice(0, 120)
  const used = (head.match(/\{A\}/g) ?? []).length
  const phrase = wrappers.length ? wrappers.join(" · ") : null
  return {
    signature: [code ?? "", phrase ?? "", head].join(" | "),
    code,
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
  /** Scheduled runs among the failures (matched occurrences, or occurrences alone). */
  scheduled: number
  first: number
  last: number
  latestTraceId: string | null
  /** Occurrence-only groups name a status (`failed`, `skipped_misfire`…). */
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

/**
 * Failed traces and failed or skipped occurrences inside the lookback, grouped
 * by signature. A failed occurrence that has a failed cron trace on the same
 * channel within two minutes is the same failure, counted once, under the
 * trace's signature (the occurrence summary carries no error text). One with
 * no trace — sampled out, or a skip — groups by its status.
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
  const members: Member[] = []
  const cronTraces: Member[] = []
  for (const t of traces) {
    if (t.status !== "failed") continue
    const at = serverTime(t.created_at)
    if (at == null || at < floor) continue
    const m: Member = {
      at,
      channel: t.channel,
      channelId: t.channel_id ?? null,
      cron: t.mode === "cron",
      traceId: t.id,
      occurrenceId: null,
      message: t.error_message,
      sig: errorSignature(t.error_message),
    }
    members.push(m)
    if (m.cron) cronTraces.push(m)
  }
  const matchedOccurrences = new Map<Member, string>()
  for (const o of occurrences) {
    if (o.status !== "failed" && !o.status.startsWith("skipped")) continue
    const at = occurrenceAt(o)
    if (at == null || at < floor) continue
    if (o.status === "failed") {
      const start = serverTime(o.started_at) ?? serverTime(o.scheduled_for) ?? at
      const twin = cronTraces.find(
        (m) =>
          m.channel === o.channel_name &&
          !matchedOccurrences.has(m) &&
          (Math.abs(m.at - start) <= OCCURRENCE_MATCH_MS || Math.abs(m.at - at) <= OCCURRENCE_MATCH_MS),
      )
      if (twin) {
        matchedOccurrences.set(twin, o.id)
        twin.occurrenceId = o.id
        continue
      }
    }
    members.push({
      at,
      channel: o.channel_name,
      channelId: o.channel_id,
      cron: true,
      traceId: null,
      occurrenceId: o.id,
      message: null,
      sig: {
        signature: `occurrence | ${o.status}`,
        code: null,
        phrase: null,
        head: "",
        tokens: [],
      },
    })
  }

  // Oldest first, so first-seen order is the order things went wrong.
  members.sort((a, b) => a.at - b.at)
  const groups = new Map<
    string,
    { g: FailureGroup; variants: Map<string, number>[]; head: string; status: string | null }
  >()
  for (const m of members) {
    const status = m.sig.signature.startsWith("occurrence | ") ? m.sig.signature.slice(13) : null
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
          occurrenceStatus: status,
          latestOccurrenceId: null,
        },
        variants: [],
        head: m.sig.head,
        status,
      }
      groups.set(m.sig.signature, entry)
    }
    const g = entry.g
    g.failures++
    if (m.cron) g.scheduled++
    g.last = Math.max(g.last, m.at)
    g.first = Math.min(g.first, m.at)
    if (m.message) g.sample = m.message
    if (m.traceId) g.latestTraceId = m.traceId
    if (m.occurrenceId) g.latestOccurrenceId = m.occurrenceId
    m.sig.tokens.forEach((tok, i) => {
      const v = entry.variants[i] ?? new Map<string, number>()
      v.set(tok, (v.get(tok) ?? 0) + 1)
      entry.variants[i] = v
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

  return [...groups.values()].map(({ g, variants, head, status }) => {
    // Most frequent first; ties keep first-seen order (Map insertion order).
    const ordered = variants.map((v) =>
      [...v.entries()]
        .map(([tok, n], i) => ({ tok, n, i }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => x.tok),
    )
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
  /**
   * The live traffic window, when two samples exist: when it began, and each
   * channel's outcomes inside it. Before a second sample there is no ordering
   * to read, so this is null.
   */
  window: { start: number; label: string; byChannel: Map<string, WindowedOutcome> } | null
  /** channel name → newest completed trace (ms). */
  lastCompletedTrace: Map<string, number>
  /** channel name → newest completed scheduled run (ms). */
  lastCompletedRun: Map<string, number>
}

export type RecoveryProof = "traffic" | "trace" | "schedule"

export interface ChannelRecovery {
  recovered: boolean
  /** Failing again inside a window that began after the last recorded failure. */
  failingNow: boolean
  proof: RecoveryProof | null
  /** Clean requests in the window, when traffic is the proof. */
  cleanRuns: number | null
}

export function channelRecovery(
  channel: string,
  lastFailure: number,
  evidence: RecoveryEvidence,
): ChannelRecovery {
  const w = evidence.window
  const outcome = w?.byChannel.get(channel)
  // A window that began after the failure and still saw failures: there are
  // newer failures the trace page did not keep. Not recovered, whatever else says.
  if (w && outcome && w.start > lastFailure && outcome.failed > 0) {
    return { recovered: false, failingNow: true, proof: null, cleanRuns: null }
  }
  const trace = evidence.lastCompletedTrace.get(channel)
  if (trace != null && trace > lastFailure) {
    return {
      recovered: true,
      failingNow: false,
      proof: "trace",
      cleanRuns: w && outcome && w.start > lastFailure ? outcome.ok : null,
    }
  }
  const run = evidence.lastCompletedRun.get(channel)
  if (run != null && run > lastFailure) {
    return { recovered: true, failingNow: false, proof: "schedule", cleanRuns: null }
  }
  if (w && outcome && w.start > lastFailure && outcome.ok > 0) {
    return { recovered: true, failingNow: false, proof: "traffic", cleanRuns: outcome.ok }
  }
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
  /** The channels it is about, failure groups and channel signals. */
  channels: IncidentChannel[]
  /** Failure groups only. */
  group: FailureGroup | null
  /** Ms; null for a live signal with no history. */
  firstSeen: number | null
  lastSeen: number | null
  /** Resolved only: why, in words. */
  recoveredBecause: string | null
  /** Resolved only: when it drops off. */
  closesAt: number | null
}

export interface LiveSignals {
  quarantined?: ChannelLoadIssue[]
  connectors?: ConnectorLoadIssue[]
  plugins?: PluginLoadIssue[]
  models?: ModelLoadIssue[]
  /** Per-channel outcomes over the live window; null before a second sample. */
  traffic?: { label: string; channels: { channel: string; ok: number; failed: number; errorPct: number | null }[] } | null
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
  channelIdByName?: Map<string, string>
  connectorIdByName?: Map<string, string>
}

const COMPONENT_DETAIL: Record<string, string> = {
  cron: "Declared schedules are not running — every liveness signal is green",
  packages: "A package this node applies at startup is still applying, or did not apply",
  engine_reload: "The last reload failed; this node serves the previous generation",
  config_propagation: "A change committed here has not reached the peers",
}

const pct = (v: number | null) => (v == null ? "—" : v >= 10 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`)
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const enc = encodeURIComponent

const PROOF_WORDS: Record<RecoveryProof, string> = {
  traffic: "clean traffic",
  trace: "a newer completed trace",
  schedule: "a newer completed run",
}

export function buildIncidents({
  now,
  groups,
  evidence,
  live,
  channelIdByName = new Map(),
  connectorIdByName = new Map(),
}: IncidentInput): Incident[] {
  const out: Incident[] = []
  const channelPath = (name: string, id?: string | null) => {
    const resolved = id || channelIdByName.get(name)
    return resolved ? `/channels/${resolved}` : `/system-map?select=${enc(name)}`
  }
  const failingNow = new Map(
    (live.traffic?.channels ?? [])
      .filter((c) => c.failed > 0 && c.errorPct != null && c.errorPct >= FAILING_PCT)
      .map((c) => [c.channel, c]),
  )
  const coveredByGroup = new Set<string>()

  for (const g of groups) {
    const channels: IncidentChannel[] = g.channels.map((c) => ({
      ...c,
      recovery: channelRecovery(c.name, c.last, evidence),
    }))
    const stillFailing = channels.some((c) => c.recovery?.failingNow || failingNow.has(c.name))
    const resolved = !stillFailing && channels.every((c) => c.recovery?.recovered)
    if (resolved && now - g.last > RESOLVED_TTL_MS) continue
    for (const c of channels) coveredByGroup.add(c.name)
    const occurrenceOnly = g.occurrenceStatus != null
    const skip = occurrenceOnly && g.occurrenceStatus !== "failed"
    const single = channels.length === 1 ? channels[0] : null
    const cronChannel = channels.find((c) => c.cron)
    const links: IncidentLink[] = []
    if (!occurrenceOnly) {
      links.push({
        label: "Traces",
        to: single ? `/traces?channel=${enc(single.name)}&status=failed` : "/traces?status=failed",
      })
    }
    if (cronChannel) {
      const id = single?.channelId
      links.push({
        label: "Schedules",
        to: id ? `/schedules?channel_id=${enc(id)}` : "/schedules",
      })
    }
    links.push({ label: "Map", to: `/system-map?select=${enc(channels[0]?.name ?? "")}` })

    const proofs = new Set(channels.map((c) => c.recovery?.proof).filter(Boolean) as RecoveryProof[])
    const clean = channels.reduce<number | null>(
      (n, c) => (c.recovery?.cleanRuns == null ? n : (n ?? 0) + c.recovery.cleanRuns),
      null,
    )
    out.push({
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
      recoveredBecause: resolved
        ? `${channels.length === 1 ? "The channel has" : `All ${channels.length} channels have`} succeeded since — ${[...proofs]
            .map((p) => PROOF_WORDS[p])
            .join(", ")}${clean != null && clean > 0 ? ` (${plural(clean, "clean request")} in the last ${evidence.window?.label ?? "window"})` : ""}`
        : null,
      closesAt: resolved ? g.last + RESOLVED_TTL_MS : null,
    })
  }

  const signal = (i: Omit<Incident, "state" | "group" | "firstSeen" | "lastSeen" | "recoveredBecause" | "closesAt" | "channels"> & { channels?: IncidentChannel[] }) =>
    out.push({
      state: "open",
      group: null,
      firstSeen: null,
      lastSeen: null,
      recoveredBecause: null,
      closesAt: null,
      channels: [],
      ...i,
    })
  const channelRef = (name: string, channelId?: string | null): IncidentChannel => ({
    name,
    failures: 0,
    first: now,
    last: now,
    cron: false,
    channelId: channelId ?? channelIdByName.get(name) ?? null,
    recovery: null,
  })

  for (const q of live.quarantined ?? []) {
    signal({
      key: `quarantine:${q.channel}`,
      kind: "quarantine",
      severity: 0,
      tone: "destructive",
      title: `Quarantined: ${q.channel}`,
      detail: q.reason || "Refused at load — the route is not being served",
      to: channelPath(q.channel, q.channel_id),
      links: [{ label: "Map", to: `/system-map?select=${enc(q.channel)}` }],
      channels: [channelRef(q.channel, q.channel_id)],
    })
  }
  for (const c of live.connectors ?? []) {
    const id = c.connector_id || connectorIdByName.get(c.connector)
    signal({
      key: `connector:${c.connector}`,
      kind: "connector",
      severity: 1,
      tone: "destructive",
      title: `Connector failed to load: ${c.connector}`,
      detail: c.reason ? `${c.stage}: ${c.reason}` : "Every task using it is failing",
      to: id ? `/connectors/${id}?test=1` : "/connectors",
      links: [],
    })
  }
  for (const p of live.plugins ?? []) {
    signal({
      key: `plugin:${p.plugin}@${p.version}`,
      kind: "plugin",
      severity: 1,
      tone: "destructive",
      title: `Plugin not loaded: ${p.plugin} v${p.version}`,
      detail: `${p.stage}: ${p.reason}`,
      to: `/plugins/${enc(p.plugin)}`,
      links: [],
    })
  }
  for (const m of live.models ?? []) {
    signal({
      key: `model:${m.model}@${m.version}`,
      kind: "model",
      severity: 1,
      tone: "destructive",
      title: `Model not serving: ${m.model} v${m.version}`,
      detail: `${m.stage}: ${m.reason}`,
      to: `/models/${enc(m.model)}`,
      links: [],
    })
  }
  // A failing channel already inside a failure group is that group's news
  // (it was raised to severity 2 above); only the rest stand alone. The
  // counters are the witness here, not the trace table: a channel can answer
  // 500 on every request and keep no trace.
  for (const c of failingNow.values()) {
    if (coveredByGroup.has(c.channel)) continue
    signal({
      key: `failing:${c.channel}`,
      kind: "failing",
      severity: 2,
      tone: "destructive",
      title: `Failing: ${c.channel}`,
      detail: `${pct(c.errorPct)} of ${plural(c.ok + c.failed, "request")} failed in the last ${live.traffic?.label ?? "window"}`,
      to: `/traces?channel=${enc(c.channel)}&status=failed`,
      links: [{ label: "Map", to: `/system-map?select=${enc(c.channel)}` }],
      channels: [channelRef(c.channel)],
    })
  }
  for (const [component, state] of live.components ?? []) {
    signal({
      key: `component:${component}`,
      kind: "component",
      severity: 4,
      tone: "warning",
      title: `${component} is ${state}`,
      detail: COMPONENT_DETAIL[component] ?? "Reported by /health",
      to: componentRoute(component) ?? `/engine#component-${component}`,
      links: [],
    })
  }
  for (const t of live.tasks ?? []) {
    if (t.restarts === 0 && t.state === "running") continue
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
      links: [],
    })
  }
  // One incident per connector: three channels tripping on one backend are
  // one outage, not three.
  const byConnector = new Map<string, BreakerRow[]>()
  for (const b of live.breakers ?? []) {
    const list = byConnector.get(b.connector) ?? []
    list.push(b)
    byConnector.set(b.connector, list)
  }
  for (const [connector, rows] of byConnector) {
    const named = rows.filter((r) => r.channel)
    signal({
      key: `breaker:${connector}`,
      kind: "breaker",
      severity: 6,
      tone: "warning",
      title: `Circuit breaker ${rows.every((r) => r.state === rows[0].state) ? rows[0].state.replace("_", "-") : "open"}: ${connector}`,
      detail: `${named.length ? `${plural(named.length, "channel")} · ` : ""}this replica only`,
      to: rows.length === 1 ? `/circuit-breakers?key=${enc(rows[0].key)}` : "/circuit-breakers",
      links: [],
      channels: named.map((r) => channelRef(r.channel)),
    })
  }
  if ((live.dlqExhausted ?? 0) > 0) {
    signal({
      key: "dlq:exhausted",
      kind: "dlq",
      severity: 6,
      tone: "destructive",
      title: `${plural(live.dlqExhausted ?? 0, "DLQ entry", "DLQ entries")} exhausted`,
      detail: "Async failures that ran out of retries — requeue or purge them",
      to: "/trace-dlq?exhausted=true",
      links: [],
    })
  }
  const backlog = live.cronBacklog
  if (
    backlog &&
    backlog.pending > 0 &&
    (backlog.oldestSec != null ? backlog.oldestSec >= BACKLOG_AGE_SEC : backlog.pending >= BACKLOG_COUNT)
  ) {
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
      links: [],
    })
  }

  return sortIncidents(out)
}

/**
 * Open before resolved; then severity; then destructive before warning; then
 * the most recent — a live signal, which has no failure time, is happening
 * now and counts as newest; then by title.
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

export function parseAcks(raw: string | null): AckMap {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    const out: Record<string, number> = {}
    for (const [k, t] of Object.entries(v)) if (typeof t === "number" && Number.isFinite(t)) out[k] = t
    return out
  } catch {
    return {}
  }
}

/** Drop acks older than a week, so the key does not grow without bound. */
export function pruneAcks(acks: AckMap, now: number, maxAgeMs = ACK_MAX_AGE_MS): AckMap {
  const out: Record<string, number> = {}
  for (const [k, t] of Object.entries(acks)) if (now - t <= maxAgeMs) out[k] = t
  return out
}

/**
 * Acknowledged, and nothing has failed since. A live signal has no failure
 * time, so its ack holds for as long as the signal does; a failure group
 * re-opens when it fails again after the ack.
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
