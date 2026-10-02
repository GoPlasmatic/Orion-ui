import { Panel, useReactFlow } from "@xyflow/react"
import { Maximize } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useReducedMotion } from "@/lib/motion"
import { fitOptions } from "@/lib/map-fit"

/**
 * The Fit control, named and in the corner the eye lands on — React Flow's
 * own fit button is an unlabelled glyph in a stack of zoom buttons, and QA
 * never found it.
 */
export function FitControl() {
  const { fitView } = useReactFlow()
  const reducedMotion = useReducedMotion()
  return (
    <Panel position="top-right">
      <Button
        variant="outline"
        size="sm"
        className="bg-card/90 shadow-xs backdrop-blur"
        onClick={() => void fitView(fitOptions(reducedMotion))}
        title="Zoom to show everything on the canvas"
      >
        <Maximize className="h-3.5 w-3.5" />
        Fit
      </Button>
    </Panel>
  )
}
