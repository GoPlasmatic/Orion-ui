import type { ExecutionStep, FunctionSchema, TraceDetail, Workflow, WorkflowDependencies } from "@/api/types"
import type { CostInput } from "@/lib/workflow-lens"

/**
 * QA's "Clock: pair" (`soma-clock-pair-run` v2 on Orion 1.12), run every 15 s
 * by the cron channel `soma-clock-pair`, and trace 64b46dde — the run that
 * failed at boot in `bump_work.bump` after 8.1 s. Step timings, per-task
 * baselines (235 runs, 185 body iterations) and the dependency answer are the
 * server's own. Shared by the lens unit tests and the lens render test.
 */

const soma = (fn: string, sql: string, output: string) => ({ name: fn, input: { connector: "soma-db", sql, output } })
const gate = { name: "filter", input: { condition: { "!!": [{ var: "temp_data.x" }] } } }

export const clockPair: Workflow = {
  workflow_id: "soma-clock-pair-run",
  name: "Clock: pair",
  description: null,
  priority: 0,
  tags: ["soma"],
  status: "active",
  version: 2,
  rollout_percentage: 100,
  content_hash: "sha256:00",
  created_at: "2026-10-01T00:00:00",
  updated_at: "2026-10-01T00:00:00",
  loop: {
    over: { var: "temp_data.plan" },
    as: "it",
    setup: [
      { id: "pick", name: "Pick the live season to pair this tick", function: soma("db_read", "SELECT season FROM …", "temp_data.pick") },
      { id: "picked", name: "Halt while no live season can pair", function: gate },
      { id: "demand", name: "Read demand, the pool and the room", function: soma("db_read", "SELECT demand, pool, room FROM …", "temp_data.demand") },
      { id: "boards", name: "Halt while no board is in play", function: gate },
      { id: "trials", name: "Find candidates waiting for a trial", function: soma("db_read", "SELECT candidate FROM trials …", "temp_data.trials") },
      {
        id: "pair",
        name: "Choose the room's pairings",
        function: { name: "tb.pairing.pair", input: { room: { var: "temp_data.demand" }, output: "temp_data.paired" } },
      },
      {
        id: "plan",
        name: "Trials first, then the room",
        function: { name: "map", input: { mappings: [{ path: "temp_data.plan", logic: { var: "temp_data.paired" } }] } },
      },
    ],
  },
  tasks: [
    {
      id: "pairing",
      name: "Name this pairing",
      function: { name: "map", input: { mappings: [{ path: "temp_data.s.pairing_id", logic: { var: "it.id" } }] } },
    },
    { id: "insert", name: "Insert the match and its seats", function: soma("db_write", "INSERT INTO matches …", "temp_data.s.inserted") },
    { id: "held", name: "Halt if the roster moved under the insert", function: gate },
    {
      id: "bump_work.bump",
      name: "Move a generation",
      condition: { "!!": [{ var: "temp_data.s.inserted" }] },
      function: { name: "cache_incr", input: { connector: "soma-cache", key: "gen:work" } },
    },
  ],
}

/** The catalogue rows these steps name, as `GET admin/functions` serves them on 1.12. */
const fn = (name: string, category: string, retry_safety: FunctionSchema["retry_safety"], extra: Partial<FunctionSchema> = {}): FunctionSchema => ({
  name,
  description: "",
  category,
  source: "orion",
  retry_safety,
  ...extra,
})
export const clockPairCatalogue: FunctionSchema[] = [
  fn("db_read", "connector", { kind: "read" }),
  fn("db_write", "connector", { kind: "depends_on", input: "sql" }),
  fn("cache_incr", "connector", { kind: "unsafe_write" }),
  fn("filter", "control", { kind: "pure" }, { source: "engine" }),
  fn("map", "data", { kind: "pure" }, { source: "engine" }),
  fn("tb.pairing.pair", "plugin", { kind: "pure" }, {
    source: "plugin",
    plugin: { id: "tb.pairing", version: 2, digest: "sha256:ab12", abi: "1.0.0" },
  }),
]

export const clockPairDeps: WorkflowDependencies = {
  workflow_id: "soma-clock-pair-run",
  version: 2,
  connectors: [
    { connector: "soma-db", function: "db_read" },
    { connector: "soma-db", function: "db_write" },
    { connector: "soma-cache", function: "cache_incr" },
  ],
  channels: [],
  has_dynamic_channel_calls: false,
  plugins: [{ id: "tb.pairing", version: 2, digest: "sha256:ab12", functions: ["tb.pairing.pair"] }],
  unresolved_functions: [],
}

const RUNS = 235
const ITER = 185
const task = (runs: number, meanMs: number, p95Ms: number) => ({ runs, meanMs, p95Ms })

export const clockPairCost: CostInput = {
  runs: RUNS,
  meanMs: 129.46,
  p95Ms: 306,
  overheadMs: 4.55,
  tasks: new Map([
    ["pick", task(RUNS, 5.49, 20.1)],
    ["picked", task(RUNS, 0, 0.5)],
    ["demand", task(RUNS, 88.41, 229.6)],
    ["boards", task(RUNS, 0, 0.5)],
    ["trials", task(RUNS, 9.44, 33.2)],
    ["pair", task(RUNS, 5.59, 9.8)],
    ["plan", task(RUNS, 0.49, 0.9)],
    ["pairing", task(ITER, 0.57, 1.2)],
    ["insert", task(ITER, 18.69, 47.6)],
    ["held", task(ITER, 0, 0.5)],
    ["bump_work.bump", task(ITER, 0.41, 0.7)],
  ]),
}

/** `2026-10-02T05:41:15.836289` plus `us`, as a step's nanosecond `Z` instant. */
function at(us: number): string {
  const total = 15_836_289 + us
  const sec = Math.floor(total / 1e6)
  const frac = String(total % 1e6).padStart(6, "0")
  return `2026-10-02T05:41:${String(sec).padStart(2, "0")}.${frac}000Z`
}

const step = (
  task_id: string,
  start: number,
  duration_us: number,
  changes: string[],
  loop_counter?: number,
): ExecutionStep => ({
  workflow_id: "soma-clock-pair-run",
  task_id,
  result: "executed",
  started_at: at(start),
  duration_us,
  changes: changes.map((path) => ({ path, old_value: null, new_value: 1 })),
  ...(loop_counter !== undefined ? { loop_counter } : {}),
  message: { id: "m" },
})

export const failedRun: TraceDetail = {
  id: "64b46dde-86c7-4e97-b74d-87b9fba65d03",
  status: "failed",
  mode: "cron",
  channel: "soma-clock-pair",
  channel_id: "c-1",
  duration_ms: 8362,
  error: "FUNCTION_ERROR: Task bump_work.bump error: Function execution error: Redis INCRBY failed for key 'gen:work'",
  created_at: "2026-10-02T05:41:15.836289",
  started_at: "2026-10-02T05:41:15.836289",
  completed_at: "2026-10-02T05:41:24.198158",
  task_trace_json: {
    steps: [
      step("pick", 1596, 1502, ["temp_data.pick"]),
      step("picked", 3146, 9, []),
      step("demand", 3197, 74350, ["temp_data.demand"]),
      step("boards", 78425, 10, []),
      step("trials", 78759, 5716, ["temp_data.trials"]),
      step("pair", 85063, 4969, ["temp_data.paired"]),
      step("plan", 90513, 414, ["temp_data.plan"]),
      step("pairing", 91426, 396, ["temp_data.s.pairing_id"], 0),
      step("insert", 92171, 5485, ["temp_data.s.inserted"], 0),
      step("held", 98116, 8, [], 0),
      { ...step("bump_work.bump", 98449, 8115055, [], 0), message: undefined },
    ],
  },
}
