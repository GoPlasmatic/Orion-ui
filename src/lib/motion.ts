import { useMediaQuery } from "@/lib/media-query"

/**
 * Whether the person has asked the OS for less motion. The stylesheet already
 * stops CSS animation under that setting; this is for motion started from
 * script — the map's viewport travel, which is a d3 transition no stylesheet
 * rule can reach.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)")
}
