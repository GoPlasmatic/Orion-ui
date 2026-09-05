import type { Completion, CompletionResult } from "@codemirror/autocomplete"
import type { SyntaxNode } from "@lezer/common"
import type { FunctionSchema } from "@/api/types"
import type { CompletionRequest } from "@/lib/editor-types"
import { propertyName, propertyValue } from "@/lib/json-path"

/**
 * Completion for the steps editor, from the function catalogue.
 *
 * The catalogue (`GET admin/functions`) is the live registry of what this
 * node can run: Orion handlers with their input schema, engine built-ins,
 * every active plugin's functions. It used to be a page nobody visited; here
 * it answers at the moment the question is asked — inside
 * `"function": { "name": "…" }` it offers the names, inside that function's
 * `"input": { … }` it offers the fields the schema declares, with kind,
 * required and description.
 */

interface KeyOption {
  label: string
  detail?: string
  info?: string
  /** Inserted after the key when the whole `"key": value` is completed. */
  value?: string
}

const TASK_KEYS: KeyOption[] = [
  { label: "id", detail: "string · required", info: "Unique across tasks and groups.", value: '""' },
  { label: "name", detail: "string · required", info: "Human title, shown on the diagram and in traces.", value: '""' },
  { label: "description", detail: "string", value: '""' },
  { label: "function", detail: "object · task", info: "`{ name, input }` — makes this step a task.", value: '{ "name": "", "input": {} }' },
  { label: "condition", detail: "JSONLogic", info: "Runs the step only when truthy; a group evaluates it once on entry.", value: "{}" },
  { label: "terminal", detail: "boolean", info: "End the workflow after this step.", value: "true" },
  { label: "halt_on", detail: '"failure" | "never"', info: "End the workflow when this task fails (status ≥ 400).", value: '"failure"' },
  { label: "continue_on_error", detail: "boolean", value: "true" },
  { label: "tasks", detail: "array · group", info: "Makes this step a task group: one condition gating a contiguous run.", value: "[]" },
]

const FUNCTION_KEYS: KeyOption[] = [
  { label: "name", detail: "string · required", info: "A catalogue function name; completion lists them.", value: '""' },
  { label: "input", detail: "object", info: "The function's input, checked against its schema at create time.", value: "{}" },
]

/** Nearest ancestor (or self) with the given node name. */
function enclosing(node: SyntaxNode | null, name: string): SyntaxNode | null {
  let n = node
  while (n && n.name !== name) n = n.parent
  return n
}

/** The Property whose value is this node, if it is a property value. */
function ownerProperty(node: SyntaxNode): SyntaxNode | null {
  return node.parent?.name === "Property" ? node.parent : null
}

function ownerKey(node: SyntaxNode, doc: string): string | null {
  const prop = ownerProperty(node)
  return prop ? propertyName(prop, doc) : null
}

/** The string value of a sibling key inside an Object, if it is a string literal. */
function siblingString(obj: SyntaxNode, key: string, doc: string): string | null {
  for (let c = obj.firstChild; c; c = c.nextSibling) {
    if (c.name !== "Property" || propertyName(c, doc) !== key) continue
    const v = propertyValue(c)
    if (!v || v.name !== "String") return null
    try {
      return JSON.parse(doc.slice(v.from, v.to)) as string
    } catch {
      return null
    }
  }
  return null
}

function existingKeys(obj: SyntaxNode, doc: string): Set<string> {
  const out = new Set<string>()
  for (let c = obj.firstChild; c; c = c.nextSibling) {
    if (c.name === "Property") {
      const k = propertyName(c, doc)
      if (k) out.add(k)
    }
  }
  return out
}

/** Whether an Object is a step: an element of a `tasks` array, or of the root array. */
function isStepObject(obj: SyntaxNode, doc: string): boolean {
  const arr = obj.parent
  if (!arr || arr.name !== "Array") return false
  const owner = ownerKey(arr, doc)
  return owner === "tasks" || arr.parent?.name === "JsonText"
}

/** The keys an object at this position accepts, given where it sits. */
function keysFor(obj: SyntaxNode, doc: string, functions: FunctionSchema[]): KeyOption[] {
  const owner = ownerKey(obj, doc)
  if (owner === "function") return FUNCTION_KEYS
  if (owner === "input") {
    const functionObject = ownerProperty(obj)?.parent
    const fnName = functionObject ? siblingString(functionObject, "name", doc) : null
    const fn = fnName ? functions.find((f) => f.name === fnName) : undefined
    if (!fn?.input_fields) return []
    return fn.input_fields.map((field) => ({
      label: field.name,
      detail: `${field.kind}${field.required ? " · required" : ""}${field.secret_at?.length ? " · secret" : ""}`,
      info: field.description,
      value: field.kind === "string" ? '""' : field.kind === "number" ? "0" : field.kind === "bool" ? "false" : field.kind === "array" ? "[]" : "{}",
    }))
  }
  if (isStepObject(obj, doc)) return TASK_KEYS
  return []
}

function functionOptions(functions: FunctionSchema[]): Completion[] {
  return functions.map((fn) => ({
    label: fn.name,
    type: fn.source === "plugin" ? "class" : "function",
    detail: `${fn.source} · ${fn.category}`,
    info: () => {
      const el = document.createElement("div")
      el.className = "max-w-xs space-y-1 p-1 text-xs"
      const desc = document.createElement("p")
      desc.textContent = fn.description
      el.appendChild(desc)
      const required = (fn.input_fields ?? []).filter((f) => f.required).map((f) => f.name)
      if (required.length > 0) {
        const req = document.createElement("p")
        req.className = "font-mono opacity-70"
        req.textContent = `required: ${required.join(", ")}`
        el.appendChild(req)
      } else if (fn.input_fields === undefined) {
        const note = document.createElement("p")
        note.className = "opacity-70"
        note.textContent = "Engine built-in — no input schema is checked at create time."
        el.appendChild(note)
      }
      return el
    },
  }))
}

const WORD = /^[\w.-]*$/

/** A completion source over the catalogue; `functions()` is read at each keystroke. */
export function stepCompletions(
  functions: () => FunctionSchema[],
): (req: CompletionRequest) => CompletionResult | null {
  return ({ doc, tree, pos, explicit }) => {
    const node = tree.resolveInner(pos, -1)
    // A string still being typed — `"ma` with no closing quote — is an error
    // node to the parser, not a String; closeBrackets normally supplies the
    // quote, but a paste or a deletion leaves the bare form.
    const openQuote = node.type.isError && doc[node.from] === '"'

    // Inside a string value: the function name, or the halt_on spelling.
    if (node.name === "String" || (openQuote && node.parent?.name === "Property")) {
      const prop = ownerProperty(node)
      if (!prop) return null
      // The value, not the key: the key's quotes are the PropertyName before it.
      const nameNode = prop.getChild("PropertyName")
      if (!nameNode || nameNode.to > node.from) return null
      const key = propertyName(prop, doc)
      const obj = prop.parent
      const from = node.from + 1
      const closed = node.name === "String" && node.to > from && doc[node.to - 1] === '"'
      if (closed && pos >= node.to) return null
      const to = Math.min(pos, closed ? node.to - 1 : node.to)
      if (key === "name" && obj && ownerKey(obj, doc) === "function") {
        return { from, to, options: functionOptions(functions()), validFor: WORD }
      }
      if (key === "halt_on") {
        return {
          from,
          to,
          options: [
            { label: "failure", detail: "end the workflow when this task fails" },
            { label: "never", detail: "the default" },
          ],
          validFor: WORD,
        }
      }
      return null
    }

    // Typing a key inside its quotes — closed (`"na"`) or not yet (`"na`).
    if (node.name === "PropertyName" || (openQuote && node.parent?.name === "Object")) {
      const obj = node.name === "PropertyName" ? enclosing(node.parent, "Object") : node.parent
      if (!obj) return null
      const from = node.from + 1
      const closed = node.name === "PropertyName" && node.to > from && doc[node.to - 1] === '"'
      if (closed && pos >= node.to) return null
      const taken = existingKeys(obj, doc)
      const options = keysFor(obj, doc, functions())
        .filter((k) => !taken.has(k.label))
        .map((k) => ({ label: k.label, detail: k.detail, info: k.info, type: "property" }))
      if (options.length === 0) return null
      return { from, to: Math.min(pos, closed ? node.to - 1 : node.to), options, validFor: WORD }
    }

    // In an object's whitespace, on request: the whole `"key": value`.
    if (node.name === "Object" && explicit) {
      const taken = existingKeys(node, doc)
      const options = keysFor(node, doc, functions())
        .filter((k) => !taken.has(k.label))
        .map((k) => ({
          label: k.label,
          detail: k.detail,
          info: k.info,
          type: "property",
          apply: `"${k.label}": ${k.value ?? '""'}`,
        }))
      if (options.length === 0) return null
      return { from: pos, options }
    }

    return null
  }
}
