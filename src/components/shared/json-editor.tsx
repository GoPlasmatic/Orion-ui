import { Suspense, forwardRef, lazy } from "react"
import type { JsonEditorHandle, JsonEditorProps } from "@/lib/editor-types"
import { Skeleton } from "@/components/ui/skeleton"

const JsonEditorView = lazy(() =>
  import("@/components/shared/json-editor-view").then((m) => ({ default: m.JsonEditorView })),
)

/**
 * A JSON editor — line numbers, folding, bracket matching, a lint gutter,
 * completion from whatever source the caller passes. The CodeMirror
 * implementation loads on first use, so a page without an editor never
 * downloads it; the props and handle are typed in `lib/editor-types.ts`.
 */
export const JsonEditor = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditor(props, ref) {
  return (
    <Suspense
      fallback={
        <Skeleton className="w-full rounded-md" style={{ height: props.height ?? "20rem" }} />
      }
    >
      <JsonEditorView ref={ref} {...props} />
    </Suspense>
  )
})
