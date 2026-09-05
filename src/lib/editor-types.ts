import type { Tree } from "@lezer/common"
import type { CompletionResult } from "@codemirror/autocomplete"
import type { Diagnostic } from "@codemirror/lint"

/**
 * The editor's contract with its callers, as types only.
 *
 * CodeMirror is a third of a megabyte nobody on the dashboard needs, so the
 * implementation (`json-editor-view.tsx`) is loaded on first use, and a
 * caller — the workflow form's lint, the catalogue completions — must not
 * import the runtime itself or the split is undone. They get the parse tree
 * handed to them instead.
 */

export type { Diagnostic }

/** What a lint sees: the document, its parse tree, and the parser's own findings. */
export interface LintContext {
  doc: string
  tree: Tree
  /** Error nodes from the parser, as diagnostics; at most five. */
  syntaxErrors: Diagnostic[]
}
export type JsonLint = (ctx: LintContext) => Diagnostic[]

/** What a completion source sees at the cursor. */
export interface CompletionRequest {
  doc: string
  tree: Tree
  pos: number
  /** True when the user asked (Ctrl-Space) rather than typed. */
  explicit: boolean
}
export type JsonCompletionSource = (req: CompletionRequest) => CompletionResult | null

export interface JsonEditorHandle {
  /** Move the cursor to a range and scroll it into view. */
  goTo: (from: number, to?: number) => void
}

export interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  /** Diagnostics for the current document; runs debounced after edits. Absent: syntax errors only. */
  lint?: JsonLint
  completions?: JsonCompletionSource[]
  height?: string
  readOnly?: boolean
  className?: string
  "aria-label"?: string
  /**
   * Mod-Enter: "run what is in the editor" — send the request, run the test.
   * Bound above the default keymap, which would otherwise insert a blank line.
   */
  onRun?: () => void
}
