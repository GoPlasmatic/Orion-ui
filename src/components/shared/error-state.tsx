import { Link } from "react-router"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { ApiError } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"

/**
 * The one way a page says it could not load something.
 *
 * Every detail page used to render the same "Failed to load X." for a 404, a
 * 403, a 500 and a dropped connection alike. The API layer already parses the
 * structured envelope onto `ApiError` — status, code, field details and the
 * request id — so this reads it back out, and a support ticket can carry the
 * request id instead of a screenshot.
 */
export function ErrorState({
  title,
  error,
  onRetry,
  backTo,
}: {
  title: string
  error?: unknown
  onRetry?: () => void
  backTo?: { to: string; label: string }
}) {
  const api = error instanceof ApiError ? error : null
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : null
  const kind = api
    ? api.status === 404
      ? "Not found"
      : api.status === 401 || api.status === 403
        ? "Not permitted"
        : api.status >= 500
          ? "Server error"
          : null
    : error instanceof Error
      ? "Could not reach the server"
      : null
  const facts = [kind, api?.status ? `HTTP ${api.status}` : null, api?.code ?? null].filter(Boolean)

  return (
    <div className="space-y-4">
      {backTo && (
        <Button variant="ghost" asChild>
          <Link to={backTo.to}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {backTo.label}
          </Link>
        </Button>
      )}
      <Callout variant="destructive">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{title}</p>
            {facts.length > 0 && <p className="text-xs">{facts.join(" · ")}</p>}
            {message && (
              <p className="break-words text-sm text-muted-foreground">{message}</p>
            )}
            {api?.details && api.details.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {api.details.map((d, i) => (
                  <li key={i}>
                    <span className="font-mono">{d.path}</span> — {d.message}
                  </li>
                ))}
              </ul>
            )}
            {api?.requestId && (
              <p className="font-mono text-xs text-muted-foreground">request id {api.requestId}</p>
            )}
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
        </div>
      </Callout>
    </div>
  )
}
