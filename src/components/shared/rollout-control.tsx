import { useState } from "react"
import { useSetWorkflowRollout } from "@/hooks/use-workflows"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RotateCcw } from "lucide-react"

interface RolloutControlProps {
  workflowId: string
  current: number | null | undefined
}

/**
 * Canary rollout control: a 0–100% slider + numeric input mapped onto the existing
 * `useSetWorkflowRollout()` mutation (toast feedback is handled by the hook), with a
 * one-click rollback to 0%.
 */
export function RolloutControl({ workflowId, current }: RolloutControlProps) {
  const setRollout = useSetWorkflowRollout()
  const initial = current ?? 0
  const [value, setValue] = useState(initial)

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  const dirty = value !== initial

  const apply = (next: number) =>
    setRollout.mutate({ id: workflowId, req: { rollout_percentage: clamp(next) } })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Canary rollout</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Slider value={value} onValueChange={setValue} min={0} max={100} step={1} className="flex-1" />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setValue(clamp(Number(e.target.value)))}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {value}% of matching traffic runs this workflow version.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => apply(value)} disabled={!dirty || setRollout.isPending}>
            {setRollout.isPending ? "Applying..." : "Apply"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setValue(0)
              apply(0)
            }}
            disabled={setRollout.isPending || (value === 0 && initial === 0)}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Rollback to 0%
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
