import { useState } from "react"
import { Link } from "react-router"
import { BookOpen, CheckCircle2, Circle, Copy, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { firstRunSteps, type FirstRunState } from "@/lib/onboarding"
import { cn } from "@/lib/utils"
import { readStorage, writeStorage } from "@/lib/storage"
import { copyText } from "@/lib/clipboard"

const DISMISS_KEY = "orion-getting-started-dismissed"

/**
 * The first-run checklist on the dashboard. A fresh instance used to show five
 * empties at once — "—", "All clear", "No message activity", "No channel
 * metrics", "No recent traces" — and no way in. This is the way in, and it
 * ticks itself as the instance fills up. In 2.0 a service arrives as a
 * deployment, so the first steps are `orion-cli` commands, copyable here.
 */
export function GettingStarted({ state }: { state: FirstRunState }) {
  const [dismissed, setDismissed] = useState(() => readStorage(DISMISS_KEY) === "1")
  if (dismissed) return null

  const steps = firstRunSteps(state)
  const done = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle>Getting started</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is served on this node yet. {steps.length} steps take a service from a directory of
            definitions to a request with a trace; {done} of {steps.length} done.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide the getting-started checklist"
          title="Hide"
          className="text-muted-foreground"
          onClick={() => {
            setDismissed(true)
            writeStorage(DISMISS_KEY, "1")
          }}
        >
          <X />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="grid gap-2 md:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.key}>
              <Link
                to={step.to}
                className={cn(
                  "flex h-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60",
                  step === next && "border-primary/60 bg-primary/5",
                  step.done && "opacity-70",
                )}
                aria-current={step === next ? "step" : undefined}
              >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-success" aria-label="Done" />
                  ) : (
                    <Circle className="h-4 w-4" aria-hidden />
                  )}
                  Step {i + 1}
                </span>
                <span className="text-sm font-medium">{step.title}</span>
                <span className="text-xs text-muted-foreground">{step.detail}</span>
              </Link>
              {step.command && (
                <button
                  type="button"
                  onClick={() => void copyText(step.command!, "Command")}
                  className="mt-1 flex w-full items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1 text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  title="Copy the command"
                >
                  <span className="truncate">{step.command}</span>
                  <Copy className="h-3 w-3 shrink-0" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ol>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          The{" "}
          <a
            href="https://docs.goplasmatic.io/get-started/tutorials/examples.html"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Orion documentation
          </a>{" "}
          walks the same route with an example package.
        </p>
      </CardContent>
    </Card>
  )
}
