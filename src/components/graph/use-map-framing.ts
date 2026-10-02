import { useEffect, useRef } from "react"
import { useReactFlow } from "@xyflow/react"
import { useReducedMotion } from "@/lib/motion"
import { fitOptions, revealOptions } from "@/lib/map-fit"

/**
 * The framing both node-link canvases share. `fitKey` names what the canvas
 * draws — the set of nodes and which crowds are folded — and a change re-fits
 * the whole canvas. `revealToken` is bumped when a selection arrives from
 * outside the canvas (a list, the failing strip, a `?select=` link); the
 * canvas travels to `revealId` once it has a position for it.
 *
 * Both are scheduled a frame later, the fit first, so when the two fire
 * together — the page opened on `?select=` — the reveal runs second and wins.
 */
export function useMapFraming(fitKey: string, revealToken: number, revealId: string | null, canReveal: boolean) {
  const { fitView } = useReactFlow()
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const frame = requestAnimationFrame(() => void fitView(fitOptions(reducedMotion)))
    return () => cancelAnimationFrame(frame)
  }, [fitKey, fitView, reducedMotion])

  // A token is honoured once: a later click on the canvas changes the
  // selection without asking it to travel.
  const handled = useRef(0)
  useEffect(() => {
    if (!revealToken || revealToken === handled.current || !revealId || !canReveal) return
    const frame = requestAnimationFrame(() => {
      handled.current = revealToken
      void fitView(revealOptions(reducedMotion, revealId))
    })
    return () => cancelAnimationFrame(frame)
  }, [revealToken, revealId, canReveal, fitView, reducedMotion])
}
