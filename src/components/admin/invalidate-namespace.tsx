import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useInvalidateCacheNamespace } from "@/hooks/use-cache"
import { Eraser } from "lucide-react"

/**
 * Invalidate one response-cache namespace (1.10), behind a confirmation that
 * names who shares it. The server bumps the namespace's version counter in
 * every store a declaring channel uses — one INCR each, no scan — so every
 * entry stored under the old version stops matching at once. The toast
 * reports how many stores the bump reached (the 200's `stores`).
 */
export function InvalidateNamespaceButton({
  namespace,
  channels,
  size = "xs",
}: {
  namespace: string
  /** Names of the channels declaring it, for the confirmation. */
  channels: string[]
  size?: "xs" | "sm"
}) {
  const [confirming, setConfirming] = useState(false)
  const invalidate = useInvalidateCacheNamespace()

  return (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={invalidate.isPending}
        onClick={() => setConfirming(true)}
        title={`Drop every cached response stored under "${namespace}"`}
      >
        <Eraser className={size === "sm" ? "h-3.5 w-3.5" : undefined} />
        {invalidate.isPending ? "Invalidating..." : "Invalidate"}
      </Button>
      {confirming && (
        <ConfirmDialog
          title={`Invalidate "${namespace}"?`}
          confirmLabel="Invalidate"
          pending={invalidate.isPending}
          description={
            <>
              <p>
                {channels.length === 0 ? (
                  "No channel in the registry declares it now, so there may be nothing stored under it."
                ) : (
                  <>
                    Every response cached under it stops matching, for{" "}
                    {channels.length === 1 ? "the one channel" : `all ${channels.length} channels`}{" "}
                    that declare it:{" "}
                    <span className="font-mono text-foreground">
                      {channels.slice(0, 6).join(", ")}
                      {channels.length > 6 ? `, +${channels.length - 6} more` : ""}
                    </span>
                    .
                  </>
                )}
              </p>
              <p>
                Their next requests miss and run the workflow, so expect a burst of load on what
                those workflows call. Nothing is deleted and there is nothing to undo: the
                namespace's version moves on and the old entries expire on their own TTL.
              </p>
            </>
          }
          onConfirm={() =>
            invalidate.mutate(namespace, { onSettled: () => setConfirming(false) })
          }
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
