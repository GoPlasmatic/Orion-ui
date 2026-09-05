import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react"
import { Compartment, EditorState, Prec } from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import {
  HighlightStyle,
  bracketMatching,
  ensureSyntaxTree,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language"
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { linter, lintGutter, lintKeymap } from "@codemirror/lint"
import { json } from "@codemirror/lang-json"
import type { Tree } from "@lezer/common"
import { tags } from "@lezer/highlight"
import { useTheme } from "@/lib/use-theme"
import { cn } from "@/lib/utils"
import type { Diagnostic, JsonEditorHandle, JsonEditorProps } from "@/lib/editor-types"

/** The parser's own error nodes, as diagnostics; capped so a broken document does not flood the gutter. */
function syntaxErrors(tree: Tree, doc: string): Diagnostic[] {
  const out: Diagnostic[] = []
  tree.iterate({
    enter: (n) => {
      if (!n.type.isError || out.length >= 5) return
      out.push({
        from: n.from,
        to: Math.max(n.to, Math.min(n.from + 1, doc.length)),
        severity: "error",
        message: "Syntax error",
      })
    },
  })
  return out
}

/**
 * Syntax colours on the semantic tokens, so the editor follows the theme
 * without a palette of its own. Keys in the brand ink, strings in the success
 * ink, numbers in the info ink, booleans and null in the warning ink.
 */
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--primary)" },
  { tag: tags.string, color: "var(--success)" },
  { tag: tags.number, color: "var(--info)" },
  { tag: [tags.bool, tags.null], color: "var(--warning)" },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: "var(--muted-foreground)" },
])

function editorTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": { height: "100%", backgroundColor: "var(--card)", color: "var(--foreground)", fontSize: "13px" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.55" },
      ".cm-content": { caretColor: "var(--foreground)", padding: "8px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
      ".cm-gutters": {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        borderRight: "1px solid var(--border)",
      },
      ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--accent) 70%, transparent)" },
      ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--accent) 45%, transparent)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)",
      },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "color-mix(in oklab, var(--primary) 20%, transparent)",
        outline: "1px solid color-mix(in oklab, var(--primary) 50%, transparent)",
      },
      ".cm-foldPlaceholder": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", border: "none" },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        boxShadow: "var(--elev-3)",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12px" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      ".cm-completionDetail": { color: "var(--muted-foreground)", fontStyle: "normal", marginLeft: "0.75em" },
      ".cm-completionInfo": { fontFamily: "var(--font-sans)" },
      ".cm-tooltip-lint": { fontFamily: "var(--font-sans)", fontSize: "12px" },
      ".cm-diagnostic-error": { borderLeftColor: "var(--destructive)" },
      ".cm-diagnostic-warning": { borderLeftColor: "var(--warning)" },
      ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--destructive)" },
      ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warning)" },
      ".cm-lint-marker-error": { content: "none" },
      ".cm-gutter-lint .cm-lint-marker": { width: "0.8em", height: "0.8em" },
    },
    { dark },
  )
}

/**
 * The JSON editor on CodeMirror 6: line numbers, folding, bracket matching,
 * history, a lint gutter, and completion from whatever source the caller
 * passes. Replaces the bare `<textarea>` the workflow's steps, the condition's
 * JSON mode and the config editors' Advanced view were authored in. Reached
 * through `json-editor.tsx`, which loads this module on first use.
 *
 * Created once; later prop changes flow through refs and compartments rather
 * than re-creating the view (which would lose cursor, history and folds).
 */
export const JsonEditorView = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditorView(
  {
    value,
    onChange,
    lint,
    completions,
    height = "20rem",
    readOnly = false,
    className,
    "aria-label": ariaLabel = "JSON",
    onRun,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const lintRef = useRef(lint)
  const completionsRef = useRef(completions)
  const onRunRef = useRef(onRun)
  const { resolvedTheme } = useTheme()
  const themeCompartment = useMemo(() => new Compartment(), [])
  const readOnlyCompartment = useMemo(() => new Compartment(), [])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    lintRef.current = lint
  }, [lint])
  useEffect(() => {
    completionsRef.current = completions
  }, [completions])
  useEffect(() => {
    onRunRef.current = onRun
  }, [onRun])

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        highlightActiveLine(),
        json(),
        syntaxHighlighting(highlight),
        autocompletion({
          override: [
            (ctx) => {
              const sources = completionsRef.current
              if (!sources?.length) return null
              const req = {
                doc: ctx.state.doc.toString(),
                tree: syntaxTree(ctx.state),
                pos: ctx.pos,
                explicit: ctx.explicit,
              }
              for (const source of sources) {
                const result = source(req)
                if (result) return result
              }
              return null
            },
          ],
        }),
        lintGutter(),
        linter(
          (view) => {
            const doc = view.state.doc.toString()
            const tree = ensureSyntaxTree(view.state, doc.length, 250) ?? syntaxTree(view.state)
            const errors = syntaxErrors(tree, doc)
            const lint = lintRef.current
            return lint ? lint({ doc, tree, syntaxErrors: errors }) : errors
          },
          { delay: 300 },
        ),
        // Above the default keymap, whose Mod-Enter inserts a blank line. A
        // caller with nothing to run leaves the key to the default.
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                const run = onRunRef.current
                if (!run) return false
                run()
                return true
              },
            },
          ]),
        ),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        themeCompartment.of(editorTheme(resolvedTheme === "dark")),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true" }),
      ],
    })
    const view = new EditorView({ state, parent })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Created once: `value` is the initial document, everything else is a ref
    // or a compartment reconfigured below.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(editorTheme(resolvedTheme === "dark")),
    })
  }, [resolvedTheme, themeCompartment])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly, readOnlyCompartment])

  // An external change to `value` (a snippet appended, a form reset) replaces
  // the document; the editor's own edits already match and are skipped.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useImperativeHandle(
    ref,
    () => ({
      goTo: (from, to) => {
        const view = viewRef.current
        if (!view) return
        const max = view.state.doc.length
        const anchor = Math.min(from, max)
        const head = Math.min(to ?? from, max)
        view.dispatch({ selection: { anchor, head }, scrollIntoView: true })
        view.focus()
      },
    }),
    [],
  )

  return (
    <div
      ref={host}
      className={cn(
        "overflow-hidden rounded-md border border-input bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35",
        className,
      )}
      style={{ height }}
    />
  )
})
