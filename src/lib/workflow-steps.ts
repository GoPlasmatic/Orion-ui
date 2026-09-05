import type { Step, Task, TaskGroup } from "@/api/types"

/**
 * Reading a workflow's `tasks` tree.
 *
 * Since Orion 1.2 (dataflow-rs 3.6) a `tasks` element is either a plain task or
 * a **task group** — one condition guarding a contiguous run of tasks, the
 * guard clause. The engine flattens the tree at parse, so anything that asks
 * "what does this workflow do / reference / cost" must descend rather than
 * iterate the top level.
 *
 * These mirror `engine/steps.rs` on the server and the identically-named
 * helpers `@goplasmatic/dataflow-ui` exports. They are re-implemented here
 * rather than imported so the API layer does not depend on the visualizer
 * package, which is a rendering concern.
 */

/** The nesting cap the engine enforces; a deeper workflow is refused at create. */
export const MAX_GROUP_DEPTH = 8

/**
 * Whether a step is a group rather than a plain task.
 *
 * The test is **presence of a `tasks` key, nothing else** — the same test the
 * engine's parser makes (`is_group`). A `tasks` key holding a non-array is
 * still a group, and a malformed one; reading it as a task instead would
 * classify it differently from the engine that has to run it.
 */
export function isTaskGroup(step: Step): step is TaskGroup {
  return step != null && typeof step === "object" && "tasks" in step
}

/**
 * The members of a group, or none when `tasks` is malformed.
 *
 * `isTaskGroup` tests only for the key, so a group whose `tasks` is not an
 * array is still a group — with no members. A renderer must not iterate the raw
 * value: a string would iterate character by character.
 */
export function groupMembers(group: TaskGroup): Step[] {
  return Array.isArray(group.tasks) ? group.tasks : []
}

/**
 * The leaf tasks of a step tree, in document order — what the engine actually
 * runs, and what task counting, task lookup and reference walks want.
 */
export function flattenSteps(steps: Step[] | null | undefined): Task[] {
  const out: Task[] = []
  const walk = (list: Step[]) => {
    for (const step of list) {
      if (!step) continue
      if (isTaskGroup(step)) walk(groupMembers(step))
      else out.push(step)
    }
  }
  walk(Array.isArray(steps) ? steps : [])
  return out
}

/** How many leaf tasks a step tree holds, without building the list. */
export function countLeafSteps(steps: Step[] | null | undefined): number {
  let n = 0
  const walk = (list: Step[]) => {
    for (const step of list) {
      if (!step) continue
      if (isTaskGroup(step)) walk(groupMembers(step))
      else n++
    }
  }
  walk(Array.isArray(steps) ? steps : [])
  return n
}

/** Groups anywhere in the tree, nested ones included. */
export function countGroups(steps: Step[] | null | undefined): number {
  let n = 0
  for (const step of Array.isArray(steps) ? steps : []) {
    if (step && isTaskGroup(step)) n += 1 + countGroups(groupMembers(step))
  }
  return n
}

/** Steps — task or group — that halt the workflow once they have run. */
export function countTerminal(steps: Step[] | null | undefined): number {
  let n = 0
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step) continue
    if (step.terminal) n++
    if (isTaskGroup(step)) n += countTerminal(groupMembers(step))
  }
  return n
}

/**
 * Tasks that end the workflow when they fail (`halt_on: "failure"`, Orion
 * 1.6 / dataflow-rs 3.10) — the outcome axis to `terminal`'s position axis.
 */
export function countHaltOnFailure(steps: Step[] | null | undefined): number {
  let n = 0
  for (const task of flattenSteps(steps)) if (task.halt_on === "failure") n++
  return n
}

/** How deeply groups nest, counting enclosing groups the way the engine does. */
export function groupDepth(steps: Step[] | null | undefined): number {
  let deepest = 0
  const walk = (list: Step[], depth: number) => {
    for (const step of list) {
      if (step && isTaskGroup(step)) {
        deepest = Math.max(deepest, depth + 1)
        walk(groupMembers(step), depth + 1)
      }
    }
  }
  walk(Array.isArray(steps) ? steps : [], 0)
  return deepest
}

// ---------------------------------------------------------------------------
// Client-side shape lint
// ---------------------------------------------------------------------------

export interface StepIssue {
  /** The coordinate the author typed, e.g. `tasks[1].tasks[0].function.name`. */
  path: string
  message: string
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Structural check over a parsed `tasks` array, reporting at the coordinate the
 * author typed.
 *
 * This is a **convenience, not a gate** — `POST /workflows/validate` is the
 * authority and checks far more (function names against the real registry,
 * connector closure, JSONLogic compilation). This exists so the obvious
 * mistakes that Orion 1.2 made into create-time 400s — a group with no `id`, an
 * id colliding across the task and group namespaces, an empty `tasks` — are
 * visible while typing rather than after a round trip.
 *
 * It deliberately reports every problem it finds rather than stopping at the
 * first, matching `validate_authored`'s behaviour on the server.
 */
export function lintSteps(steps: unknown): StepIssue[] {
  const issues: StepIssue[] = []
  if (!Array.isArray(steps)) {
    issues.push({ path: "tasks", message: "must be a JSON array" })
    return issues
  }
  if (steps.length === 0) {
    // 1.2 turned this into a 400 at create; before that it was accepted and
    // then failed the whole engine build on activation.
    issues.push({ path: "tasks", message: "must not be empty" })
    return issues
  }

  // Ids share one namespace across tasks *and* groups.
  const seen = new Map<string, string>()

  const walk = (list: unknown[], base: string, depth: number) => {
    if (depth > MAX_GROUP_DEPTH) {
      issues.push({
        path: base,
        message: `groups nest at most ${MAX_GROUP_DEPTH} deep`,
      })
      return
    }
    list.forEach((raw, i) => {
      const path = `${base}[${i}]`
      if (!isObject(raw)) {
        issues.push({ path, message: "must be an object" })
        return
      }

      const id = raw.id
      if (typeof id !== "string" || id.trim() === "") {
        issues.push({ path: `${path}.id`, message: "is required and must be a non-empty string" })
      } else if (seen.has(id)) {
        issues.push({
          path: `${path}.id`,
          message: `duplicates the id at ${seen.get(id)} — task and group ids share one namespace`,
        })
      } else {
        seen.set(id, path)
      }

      if (raw.terminal !== undefined && typeof raw.terminal !== "boolean") {
        issues.push({ path: `${path}.terminal`, message: "must be true or false" })
      }
      // 1.6: the outcome axis. Only these two spellings exist.
      if (raw.halt_on !== undefined && raw.halt_on !== "failure" && raw.halt_on !== "never") {
        issues.push({ path: `${path}.halt_on`, message: 'must be "failure" or "never"' })
      }

      // Presence of `tasks` is what makes it a group — the engine's own test.
      if ("tasks" in raw) {
        if (!Array.isArray(raw.tasks)) {
          issues.push({ path: `${path}.tasks`, message: "must be a JSON array" })
        } else if (raw.tasks.length === 0) {
          issues.push({ path: `${path}.tasks`, message: "a group must not be empty" })
        } else {
          walk(raw.tasks, `${path}.tasks`, depth + 1)
        }
        if ("function" in raw) {
          issues.push({
            path,
            message: "carries both `tasks` and `function` — a group holds steps, a task calls one function",
          })
        }
        return
      }

      if (typeof raw.name !== "string" || raw.name.trim() === "") {
        issues.push({ path: `${path}.name`, message: "is required and must be a non-empty string" })
      }
      const fn = raw.function
      if (!isObject(fn)) {
        issues.push({
          path: `${path}.function`,
          message: "is required — a step is a task (with `function`) or a group (with `tasks`)",
        })
        return
      }
      if (typeof fn.name !== "string" || fn.name.trim() === "") {
        issues.push({ path: `${path}.function.name`, message: "is required" })
      }
      if (fn.input !== undefined && !isObject(fn.input)) {
        issues.push({ path: `${path}.function.input`, message: "must be an object" })
      }
    })
  }

  walk(steps, "tasks", 0)
  return issues
}
