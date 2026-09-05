import { toast } from "sonner"
import { ApiError } from "@/api/client"

/** Field findings shown before the list is cut; the rest is a count. */
const DETAIL_LINES = 4

/**
 * What a failed request says, beyond its headline: the server's field-pathed
 * findings and the request id a support ticket needs. A toast that shows only
 * `e.message` turns a 400 naming the bad field into "validation error".
 */
export function describeError(e: unknown): React.ReactNode {
  if (!(e instanceof Error)) return undefined
  if (!(e instanceof ApiError)) return e.message
  const details = e.details ?? []
  if (details.length === 0 && !e.requestId) return e.message
  return (
    <span className="block space-y-0.5">
      <span className="block">{e.message}</span>
      {details.slice(0, DETAIL_LINES).map((d, i) => (
        <span key={i} className="block font-mono text-xs">
          {d.path ? `${d.path}: ` : ""}
          {d.message}
        </span>
      ))}
      {details.length > DETAIL_LINES && (
        <span className="block text-xs">+{details.length - DETAIL_LINES} more</span>
      )}
      {e.requestId && <span className="block font-mono text-xs opacity-70">request id {e.requestId}</span>}
    </span>
  )
}

/**
 * The one way a mutation reports failure. The request id is offered as a copy
 * action so it can go into a ticket without being retyped from a toast that is
 * about to disappear.
 */
export function toastError(title: string, e: unknown): void {
  const requestId = e instanceof ApiError ? e.requestId : undefined
  toast.error(title, {
    description: describeError(e),
    action: requestId
      ? {
          label: "Copy request id",
          onClick: () => {
            void navigator.clipboard?.writeText(requestId).catch(() => {})
          },
        }
      : undefined,
  })
}
