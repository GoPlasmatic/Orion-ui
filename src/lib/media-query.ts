import { useCallback, useSyncExternalStore } from "react"

/** One `MediaQueryList` per query for the life of the page; `matchMedia` is not free to call per render. */
const lists = new Map<string, MediaQueryList>()

function listFor(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null
  let list = lists.get(query)
  if (!list) {
    list = window.matchMedia(query)
    lists.set(query, list)
  }
  return list
}

/**
 * Whether a media query matches, as state: `useMediaQuery("(min-width: 1024px)")`
 * is how a component picks one container over another instead of rendering
 * both and hiding one with a breakpoint class.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = listFor(query)
      if (!list) return () => {}
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query],
  )
  const read = useCallback(() => listFor(query)?.matches ?? false, [query])
  return useSyncExternalStore(subscribe, read, () => false)
}
