import { useCallback, useEffect, useRef } from "react"
import { useBlocker } from "react-router"

/**
 * Stops an in-app navigation, and a tab close, while a form holds changes
 * that were not saved.
 *
 * The blocker reads refs at navigation time rather than the render-time
 * `dirty` flag: a successful save navigates away inside the mutation callback,
 * before React has re-rendered with a clean form, and a boolean captured at
 * render would have blocked that navigation with a dialog about changes that
 * were just saved. `markSaved` is what the save handler calls first.
 */
export function useUnsavedChanges(dirty: boolean) {
  const dirtyRef = useRef(dirty)
  const savedRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const blocker = useBlocker(() => dirtyRef.current && !savedRef.current)

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  const markSaved = useCallback(() => {
    savedRef.current = true
  }, [])

  return { blocker, markSaved }
}
