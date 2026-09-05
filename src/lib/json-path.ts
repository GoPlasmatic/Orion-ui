import type { SyntaxNode, Tree } from "@lezer/common"

/**
 * From a lint path to a place in the document.
 *
 * `lintSteps` reports the coordinate the author typed —
 * `tasks[1].tasks[0].function.name` — and a coordinate is only useful in an
 * editor if it becomes a range. The JSON language's Lezer tree knows where
 * every value sits, so the path is walked down the tree: an index selects the
 * nth value child of an Array, a key the Property of that name in an Object.
 * When the path runs out early (a missing `id` is a missing Property) the
 * closest ancestor's first line is the range, marked inexact.
 */

const VALUE_NODES = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"])

export type PathSegment = string | number

/** `tasks[1].tasks[0].function.name` → `["tasks", 1, "tasks", 0, "function", "name"]`. */
export function parsePath(path: string): PathSegment[] {
  const out: PathSegment[] = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
    else out.push(Number(m[2]))
  }
  return out
}

function valueChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (VALUE_NODES.has(c.name)) out.push(c)
  return out
}

/** The value node of a Property. */
export function propertyValue(prop: SyntaxNode): SyntaxNode | null {
  for (let c = prop.firstChild; c; c = c.nextSibling) if (VALUE_NODES.has(c.name)) return c
  return null
}

/** The key of a Property, unquoted. */
export function propertyName(prop: SyntaxNode, doc: string): string | null {
  const n = prop.getChild("PropertyName")
  if (!n) return null
  const raw = doc.slice(n.from, n.to)
  try {
    return JSON.parse(raw) as string
  } catch {
    return raw.replace(/^"|"$/g, "")
  }
}

/** The document's root value, past the `JsonText` wrapper. */
export function rootValue(tree: Tree): SyntaxNode | null {
  let node: SyntaxNode | null = tree.topNode.firstChild
  while (node && !VALUE_NODES.has(node.name)) node = node.nextSibling
  return node
}

export interface PathRange {
  from: number
  to: number
  /** False when the path ran out early and the range is an ancestor's. */
  exact: boolean
}

export function rangeAtPath(tree: Tree, doc: string, path: string): PathRange | null {
  const segments = parsePath(path)
  // The lint paths start at `tasks`, which is the document's root array.
  if (segments[0] === "tasks") segments.shift()
  let node = rootValue(tree)
  if (!node) return null
  let exact = true
  for (const seg of segments) {
    let next: SyntaxNode | null = null
    if (typeof seg === "number" && node.name === "Array") {
      next = valueChildren(node)[seg] ?? null
    } else if (typeof seg === "string" && node.name === "Object") {
      for (let c: SyntaxNode | null = node.firstChild; c; c = c.nextSibling) {
        if (c.name === "Property" && propertyName(c, doc) === seg) {
          next = propertyValue(c) ?? c
          break
        }
      }
    }
    if (!next) {
      exact = false
      break
    }
    node = next
  }
  if (exact) return { from: node.from, to: node.to, exact }
  // An ancestor: its first line is enough to say "this task".
  const eol = doc.indexOf("\n", node.from)
  return { from: node.from, to: eol === -1 ? node.to : Math.min(node.to, eol), exact }
}
