import { useSyncExternalStore } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {}
  const mq = window.matchMedia(QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

function read(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches
}

/**
 * Whether the person has asked the OS for less motion. The stylesheet already
 * stops CSS animation under that setting; this is for motion started from
 * script — the map's animated edges and its viewport travel.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
