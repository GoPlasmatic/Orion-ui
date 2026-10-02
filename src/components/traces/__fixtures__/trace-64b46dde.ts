import type { FunctionSchema, TraceDetail, Workflow } from "@/api/types"
import type { TaskCost } from "@/hooks/use-ops-metrics"
import { parseInstantUs } from "@/lib/trace-timeline"

// Trace 64b46dde on QA (soma-clock-pair, 2 Oct 2026): a Redis outage at boot.
// Copied from lib/trace-timeline.test.ts — offsets and durations are the real
// ones, snapshots are elided — with the authored tasks' connectors and the
// per-task baselines from the 235 runs since boot added.
const T0 = "2026-10-02T05:41:15.836289"
const at = (offsetUs: number) => {
  const base = parseInstantUs(T0)! + offsetUs
  const sec = Math.floor(base / 1e6)
  const frac = String(base % 1e6).padStart(6, "0")
  return `${new Date(sec * 1000).toISOString().slice(0, 19)}.${frac}000Z`
}
const step = (task_id: string, start: number, dur: number, extra: Record<string, unknown> = {}) => ({
  workflow_id: "soma-clock-pair-run",
  task_id,
  result: "executed",
  started_at: at(start),
  duration_us: dur,
  message: {},
  ...extra,
})

export const TRACE: Pick<
  TraceDetail,
  "id" | "mode" | "channel" | "status" | "error" | "started_at" | "completed_at" | "task_trace_json"
> = {
  id: "64b46dde-86c7-4e97-b74d-87b9fba65d03",
  mode: "cron",
  channel: "soma-clock-pair",
  status: "failed",
  error: "FUNCTION_ERROR: Task bump_work.bump error: Function execution error: Redis INCRBY failed for key 'gen:work'",
  started_at: T0,
  completed_at: "2026-10-02T05:41:24.198158",
  task_trace_json: {
    truncated: true,
    steps: [
      step("pick", 1596, 1502, { changes: [{ path: "temp_data.pick" }] }),
      step("picked", 3146, 9),
      step("demand", 3197, 74350),
      step("boards", 78425, 10),
      step("trials", 78759, 5716),
      step("pair", 85063, 4969),
      step("plan", 90513, 414),
      step("pairing", 91426, 396, { loop_counter: 0 }),
      step("insert", 92171, 5485, { loop_counter: 0, changes: [{ path: "temp_data.s.inserted", new_value: 1 }] }),
      step("held", 98116, 8, { loop_counter: 0 }),
      step("bump_work.bump", 98449, 8115055, { loop_counter: 0, message: undefined }),
    ],
  },
}

const task = (id: string, fn: string, input: Record<string, unknown> = {}, name = id) => ({
  id,
  name,
  function: { name: fn, input },
})

export const WORKFLOW: Pick<Workflow, "tasks" | "loop"> = {
  loop: {
    over: { var: "temp_data.plan" },
    as: "it",
    setup: [
      task("pick", "db_read", { connector: "soma-db" }, "Pick the live season to pair this tick"),
      task("picked", "filter", {}, "Halt while no live season can pair"),
      task("demand", "db_read", { connector: "soma-db" }, "Read demand, the pool and the room"),
      task("boards", "filter"),
      task("trials", "db_read", { connector: "soma-db" }),
      task("pair", "tb.pairing.pair"),
      task("plan", "map"),
    ],
  },
  tasks: [
    task("pairing", "map"),
    task("insert", "db_write", { connector: "soma-db", sql: "INSERT INTO matches (id) VALUES ($1)" }, "Insert the match and its seats"),
    task("held", "filter"),
    task("bump_work.bump", "cache_incr", { connector: "soma-cache", key: "gen:work" }, "Move a generation"),
    task("after", "log"),
  ],
}

const fn = (
  name: string,
  category: string,
  retry_safety: FunctionSchema["retry_safety"],
  extra: Partial<FunctionSchema> = {},
): FunctionSchema => ({ name, description: "", category, source: "orion", retry_safety, ...extra })

export const CATALOGUE: FunctionSchema[] = [
  // As 1.12 serves them: `db_write` and `http_call` depend on their input.
  fn("db_read", "connector", { kind: "read" }),
  fn("db_write", "connector", { kind: "depends_on", input: "sql" }),
  fn("http_call", "connector", { kind: "depends_on", input: "method" }),
  fn("cache_incr", "connector", { kind: "unsafe_write" }),
  fn("filter", "control", { kind: "pure" }, { source: "engine" }),
  fn("map", "data", { kind: "pure" }, { source: "engine" }),
  fn("log", "utility", { kind: "pure" }, { source: "engine" }),
  fn("tb.pairing.pair", "plugin", { kind: "pure" }, {
    source: "plugin",
    plugin: { id: "tb.pairing", version: 2, digest: "sha256:ab", abi: "1.0" },
  }),
]

const cost = (task: string, fnName: string, meanMs: number, p95Ms: number, runs = 235): [string, TaskCost] => [
  task,
  { task, function: fnName, runs, meanMs, p95Ms },
]

export const COSTS = new Map<string, TaskCost>([
  cost("pick", "db_read", 5.49, 20.1),
  cost("picked", "filter", 0, 0.5),
  cost("demand", "db_read", 88.41, 229.6),
  cost("boards", "filter", 0, 0.5),
  cost("trials", "db_read", 9.44, 33.2),
  cost("pair", "tb.pairing.pair", 5.59, 9.8),
  cost("plan", "map", 0.49, 0.9),
  cost("pairing", "map", 0.57, 1.2, 185),
  cost("insert", "db_write", 18.69, 47.6, 185),
  cost("held", "filter", 0, 0.5, 185),
  cost("bump_work.bump", "cache_incr", 0.41, 0.7, 185),
])
