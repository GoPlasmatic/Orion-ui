import { describe, it, expect } from "vitest"
import type { Step, Workflow } from "@/api/types"
import {
  isTaskGroup,
  groupMembers,
  flattenSteps,
  countLeafSteps,
  countGroups,
  countTerminal,
  groupDepth,
  lintSteps,
} from "@/lib/workflow-steps"
import { workflowConnectorRefs } from "@/lib/topology"

const task = (id: string, fn = "map", input: Record<string, unknown> = {}): Step => ({
  id,
  name: id,
  function: { name: fn, input },
})

/**
 * A workflow using the guard clause Orion 1.2 introduced: a group gating a
 * contiguous run, with a nested group inside it.
 */
const GROUPED: Step[] = [
  task("first"),
  {
    id: "verify",
    name: "Verify the caller",
    condition: { "!": [{ var: "data.verified" }] },
    terminal: true,
    tasks: [
      task("lookup", "db_read", { connector: "users-db" }),
      {
        id: "escalate",
        tasks: [task("notify", "send_email", { connector: "mailer" })],
      },
    ],
  },
  task("last"),
]

describe("isTaskGroup", () => {
  it("keys on the presence of a `tasks` key, like the engine's parser", () => {
    expect(isTaskGroup(GROUPED[1])).toBe(true)
    expect(isTaskGroup(GROUPED[0])).toBe(false)
  })

  it("treats a malformed `tasks` as a group with no members, not as a task", () => {
    // A string `tasks` would iterate character by character if read naively.
    const malformed = { id: "bad", tasks: "oops" } as unknown as Step
    expect(isTaskGroup(malformed)).toBe(true)
    expect(groupMembers(malformed as never)).toEqual([])
  })
})

describe("tree walks", () => {
  it("flattens to the leaf tasks in document order", () => {
    expect(flattenSteps(GROUPED).map((t) => t.id)).toEqual([
      "first",
      "lookup",
      "notify",
      "last",
    ])
  })

  it("counts leaves, not top-level elements", () => {
    // The array has 3 elements but the engine runs 4 tasks.
    expect(GROUPED.length).toBe(3)
    expect(countLeafSteps(GROUPED)).toBe(4)
  })

  it("counts nested groups", () => {
    expect(countGroups(GROUPED)).toBe(2)
    expect(groupDepth(GROUPED)).toBe(2)
    expect(groupDepth([task("a")])).toBe(0)
  })

  it("counts terminal steps anywhere in the tree", () => {
    expect(countTerminal(GROUPED)).toBe(1)
  })

  it("tolerates null and non-array input", () => {
    expect(flattenSteps(null)).toEqual([])
    expect(countLeafSteps(undefined)).toBe(0)
    expect(countGroups(undefined)).toBe(0)
  })
})

describe("topology walks descend into groups", () => {
  it("finds a connector referenced only from inside a guard clause", () => {
    // The regression this guards: iterating `tasks` at the top level only, a
    // connector used exclusively inside a group renders as unreferenced on the
    // system map and survives the connector-deletion reverse sweep.
    const wf = { workflow_id: "w", tasks: GROUPED } as Workflow
    expect(workflowConnectorRefs(wf).sort()).toEqual(["mailer", "users-db"])
  })
})

describe("lintSteps", () => {
  it("accepts a well-formed grouped workflow", () => {
    expect(lintSteps(GROUPED)).toEqual([])
  })

  it("refuses an empty task list", () => {
    // 1.2 made this a 400 at create; before, it broke the engine build on activation.
    expect(lintSteps([])).toEqual([{ path: "tasks", message: "must not be empty" }])
  })

  it("refuses an empty group", () => {
    const issues = lintSteps([{ id: "g", tasks: [] }])
    expect(issues).toContainEqual({
      path: "tasks[0].tasks",
      message: "a group must not be empty",
    })
  })

  it("reports duplicate ids across the shared task/group namespace", () => {
    const issues = lintSteps([task("dup"), { id: "dup", tasks: [task("x")] }])
    expect(issues.some((i) => i.path === "tasks[1].id" && /duplicates the id/.test(i.message))).toBe(
      true,
    )
  })

  it("reports at the coordinate the author typed", () => {
    const issues = lintSteps([
      task("a"),
      { id: "g", tasks: [{ id: "inner", name: "inner" }] },
    ])
    expect(issues).toContainEqual({
      path: "tasks[1].tasks[0].function",
      message: "is required — a step is a task (with `function`) or a group (with `tasks`)",
    })
  })

  it("refuses a step that is both a task and a group", () => {
    const issues = lintSteps([{ id: "g", tasks: [task("x")], function: { name: "map" } }])
    expect(issues.some((i) => /carries both/.test(i.message))).toBe(true)
  })

  it("reports every problem rather than stopping at the first", () => {
    const issues = lintSteps([{}, {}])
    expect(issues.length).toBeGreaterThanOrEqual(4)
  })

  it("caps nesting at the depth the engine enforces", () => {
    // Nine enclosing groups — one past MAX_GROUP_DEPTH.
    let inner: Step = task("leaf")
    for (let i = 0; i < 9; i++) inner = { id: `g${i}`, tasks: [inner] }
    expect(lintSteps([inner]).some((i) => /nest at most 8 deep/.test(i.message))).toBe(true)
  })

  it("accepts nesting exactly at the cap", () => {
    // Orion 1.2 fixed an off-by-one that refused a workflow nested exactly 8
    // deep, claiming the engine would reject it. The engine would not.
    let inner: Step = task("leaf")
    for (let i = 0; i < 8; i++) inner = { id: `g${i}`, tasks: [inner] }
    expect(lintSteps([inner])).toEqual([])
  })
})
