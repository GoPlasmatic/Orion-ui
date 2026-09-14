import type { FunctionFieldSchema, FunctionSchema } from "@/api/types"
import { groupMembers, isObject, isTaskGroup, type StepIssue } from "@/lib/workflow-steps"
import type { Step, TaskGroup } from "@/api/types"

/**
 * The 1.8 upgrade hazard, caught where the author is typing.
 *
 * dataflow-rs 3.13 turned on the `tensor` feature, so twenty more names are
 * live operators. In a **template position** — a `map` mapping's `logic`, or a
 * catalogue field whose `template_at` says the value is an expression — a
 * single-key object whose key is a live operator is **a call, not data**. A
 * stored mapping that emitted `{"shape": [6, 7]}` therefore changed meaning
 * between 1.7 and 1.8: it now calls `shape([6, 7])`, which is not a valid
 * call, so the task fails at evaluation.
 *
 * The remedy is the `$` key escape every engine already carries — one `$` is
 * stripped from every template key — so the literal is spelled
 * `{"$shape": [6, 7]}`.
 *
 * `orion-server preflight` reports this over a stored estate and
 * `orion-server lint` over a definition set, both as `logic.tensor_operator_key`.
 * Neither is in front of someone writing the workflow, which is what this is
 * for. Conditions are unaffected: they compile strictly and always did, so a
 * tensor-named key there raised `Invalid operator` before 1.8 and could not
 * have been serving.
 */

/**
 * Every operator the `tensor` feature adds. The walk reports only
 * [`COLLIDING_OPERATORS`]; the rest are here because a key that names one is
 * still a call, and the walk must stop at it rather than descend into what is
 * really an argument list.
 */
export const TENSOR_OPERATORS = [
  "tensor",
  "zeros",
  "full",
  "scatter",
  "rle_expand",
  "one_hot",
  "stack",
  "concat",
  "unstack",
  "reshape",
  "transpose",
  "pad",
  "crop",
  "cast",
  "normalize",
  "argmax",
  "gather",
  "to_list",
  "shape",
  "dtype",
] as const

/**
 * The seven that are also ordinary JSON keys — the only ones a document
 * plausibly meant as data, and so the only ones reported here. Nobody emits a
 * literal keyed `rle_expand`; plenty of documents carry a `shape`, a `full` or
 * a `stack`.
 */
export const COLLIDING_OPERATORS = [
  "shape",
  "full",
  "cast",
  "pad",
  "crop",
  "concat",
  "stack",
] as const

const TENSOR_SET: ReadonlySet<string> = new Set(TENSOR_OPERATORS)
const COLLIDING_SET: ReadonlySet<string> = new Set(COLLIDING_OPERATORS)

/**
 * Whether anything inside `value` is a node the engine evaluates rather than
 * data. Approximated by the tensor family plus the handful of operators that
 * actually turn up inside one — the server asks its own registry, which a
 * browser has no copy of.
 *
 * Its only job is to tell an intended call from a literal: on a set being
 * written *today*, `{"shape": {"var": "data.dims"}}` is a call the author
 * meant, and nagging about it would make the lint noise.
 */
function readsTheContext(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(readsTheContext)
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 1 && (TENSOR_SET.has(keys[0]) || EVALUATING_KEYS.has(keys[0]))) return true
  return Object.values(value).some(readsTheContext)
}

/**
 * Operators common enough to appear inside a tensor call's arguments. Not the
 * whole vocabulary — this only has to recognise *an* evaluated node, and the
 * tensor family above catches the rest.
 */
const EVALUATING_KEYS: ReadonlySet<string> = new Set([
  "var",
  "val",
  "param",
  "if",
  "cat",
  "map",
  "filter",
  "reduce",
  "merge",
  "missing",
  "+",
  "-",
  "*",
  "/",
  "%",
])

/** Walk one template-position value, reporting the keys that changed meaning. */
function collect(value: unknown, path: string, out: StepIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collect(item, `${path}[${i}]`, out))
    return
  }
  if (!isObject(value)) return

  const keys = Object.keys(value)
  if (keys.length === 1) {
    const key = keys[0]
    if (TENSOR_SET.has(key)) {
      const inner = value[key]
      if (COLLIDING_SET.has(key) && !readsTheContext(inner)) {
        out.push({
          path: `${path}.${key}`,
          severity: "info",
          message: `\`${key}\` names a tensor operator since 1.8, so this object is evaluated as a call to it rather than emitted as data — spell the key \`$${key}\` to keep the literal`,
        })
      }
      // Whichever it is, what sits inside is the call's own argument list — or
      // a literal the author will escape as a whole — so stop here rather than
      // reporting the arguments of a genuine call.
      return
    }
    collect(value[key], `${path}.${key}`, out)
    return
  }
  // A multi-key object is an output template, never a call, so its members are
  // each template positions in their own right.
  for (const key of keys) collect(value[key], `${path}.${key}`, out)
}

/**
 * The catalogue keyed by every name a task may spell a function with —
 * `validation` carries `validate` in `aliases`, and both resolve to one entry.
 * Built once per run rather than rescanned per field of per task.
 */
function indexByName(catalogue: FunctionSchema[] | undefined): Map<string, FunctionSchema> {
  const index = new Map<string, FunctionSchema>()
  for (const entry of catalogue ?? []) {
    index.set(entry.name, entry)
    for (const alias of entry.aliases ?? []) index.set(alias, entry)
  }
  return index
}

/** `template_at` entries that make the field's own value an expression. */
function templatePaths(entry: FunctionSchema | undefined, field: string): string[] {
  // An engine built-in omits `input_fields` entirely — never index it without
  // the guard.
  const decl = entry?.input_fields?.find(
    (f: FunctionFieldSchema) => f.name === field || f.alias === field,
  )
  return decl?.template_at ?? []
}

/**
 * Every tensor-operator key sitting in a template position, as a lint issue
 * at the coordinate the author typed.
 *
 * **Deliberately narrower than the server**, on two axes, because the
 * authoritative answer is already one click away: `POST /workflows/validate`
 * returns the full rule as warnings, which the form renders through
 * `ValidationResults`. This is the live half — a squiggle while typing.
 *
 * 1. *Only the colliding seven.* The server reports all twenty. On a document
 *    being written **on 1.8**, `{"one_hot": …}` is a call the author meant, so
 *    flagging it is noise; `{"shape": [6, 7]}` is the case that silently
 *    changed meaning.
 * 2. *No "does it evaluate?" check.* The server decides by **running** the
 *    expression on a bare engine — measured against a live 1.8.0 node,
 *    `{"zeros": [[2], "i64"]}` and `{"tensor": [[1, 2], "i64"]}` are working
 *    calls it stays quiet on, while `{"full": [[2, 3], 7, "i64"]}` is *not*
 *    and is flagged. There is no structural rule behind that, so a browser
 *    cannot reproduce it. The proxy here is whether the argument reads the
 *    context at all: a dynamic spelling is an intended call, a constant one is
 *    reported. `zeros` and `tensor` fall outside the seven, so the one shape
 *    this over-reports relative to the server is a constant `full` that does
 *    happen to evaluate — and on this build none does.
 */
export function tensorKeyAdvisories(
  steps: unknown,
  catalogue: FunctionSchema[] | undefined,
): StepIssue[] {
  if (!Array.isArray(steps)) return []
  const out: StepIssue[] = []
  const byName = indexByName(catalogue)

  // A task group carries its own `tasks`, and the coordinate has to survive the
  // descent — `rangeAtPath` maps `tasks[1].tasks[0].function.input.…` back to a
  // range in the document, so the walk keeps the path rather than flattening.
  const walk = (list: unknown[], base: string) => {
    list.forEach((raw, i) => {
      if (!isObject(raw)) return
      const path = `${base}[${i}]`
      // `isTaskGroup` is the engine's own test — the presence of the key,
      // nothing else — so a group whose `tasks` is malformed is a group with
      // no members here too, rather than being read as a task.
      if (isTaskGroup(raw as unknown as Step)) {
        walk(groupMembers(raw as unknown as TaskGroup), `${path}.tasks`)
        return
      }
      const fn = raw.function
      if (!isObject(fn) || typeof fn.name !== "string") return
      const input = fn.input
      if (!isObject(input)) return
      // Depends on the function, not the field, so it is resolved once per task.
      const entry = byName.get(fn.name)

      for (const [field, value] of Object.entries(input)) {
        const fieldPath = `${path}.function.input.${field}`

        // `map` is an engine built-in with no catalogue entry, and its template
        // position is one level in: each mapping's `logic`.
        if (fn.name === "map") {
          if (field !== "mappings" || !Array.isArray(value)) continue
          value.forEach((mapping, m) => {
            if (isObject(mapping) && mapping.logic !== undefined) {
              collect(mapping.logic, `${fieldPath}[${m}].logic`, out)
            }
          })
          continue
        }

        const paths = templatePaths(entry, field)
        if (paths.includes("")) {
          collect(value, fieldPath, out)
        } else if (paths.includes("*") && isObject(value)) {
          for (const [member, v] of Object.entries(value)) {
            collect(v, `${fieldPath}.${member}`, out)
          }
        }
      }
    })
  }

  walk(steps, "tasks")
  return out
}
