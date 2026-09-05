import { ApiError } from "@/api/client"
import { Callout } from "@/components/ui/callout"

/**
 * A failed Save, with everything the server said about it.
 *
 * The forms used to keep `e.message` and drop `ApiError.details[]` — the
 * field-pathed entries that name the key the server refused, what it
 * expected and what it got. That is the part a person needs to fix the form,
 * so it is rendered the way `ValidationResults` renders a `/validate` answer.
 */
export function FormError({ error, fallback = "Request failed" }: { error: unknown; fallback?: string }) {
  if (!error) return null
  const api = error instanceof ApiError ? error : null
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback
  return (
    <Callout variant="destructive">
      <p className="text-sm font-medium">{message}</p>
      {api?.code && <p className="mt-0.5 font-mono text-xs">{api.code}</p>}
      {api?.details && api.details.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {api.details.map((d, i) => (
            <li key={i}>
              <span className="font-mono">{d.path || "(root)"}</span> — {d.message}
              {d.expected !== undefined && (
                <span className="text-muted-foreground">
                  {" "}
                  · expected <span className="font-mono">{JSON.stringify(d.expected)}</span>
                </span>
              )}
              {d.got !== undefined && (
                <span className="text-muted-foreground">
                  {" "}
                  · got <span className="font-mono">{JSON.stringify(d.got)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {api?.requestId && (
        <p className="mt-1 font-mono text-xs text-muted-foreground">request id {api.requestId}</p>
      )}
    </Callout>
  )
}
