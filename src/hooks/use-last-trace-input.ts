import { useCallback, useState } from "react"
import { toast } from "sonner"
import { tracesApi } from "@/api/traces"
import { useTraces } from "@/hooks/use-traces"
import { firstTaskPayload } from "@/lib/trace-payload"
import { toastError } from "@/lib/toast-error"

/**
 * The newest trace through a channel, and its input on demand: what the
 * console's "Last trace's input" and the dry run's "Use last trace's input"
 * both fill an editor with. The list row is payload-free, so `load` fetches
 * the trace itself when asked and answers the request as its first task saw
 * it — or null, after saying why.
 */
export function useLastTraceInput(channel: string | undefined) {
  const { data } = useTraces(
    { channel: channel || undefined, limit: 1, sort_by: "created_at", sort_order: "desc" },
    { enabled: !!channel },
  )
  const lastTraceId = data?.data[0]?.id
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<Record<string, unknown> | null> => {
    if (!lastTraceId) return null
    setLoading(true)
    try {
      const payload = firstTaskPayload(await tracesApi.get(lastTraceId))
      if (!payload) {
        toast.error("That trace kept no request payload", {
          description: "The run recorded no task step with a message, so there is nothing to reuse.",
        })
      }
      return payload
    } catch (e) {
      toastError("Could not read the trace", e)
      return null
    } finally {
      setLoading(false)
    }
  }, [lastTraceId])

  return { lastTraceId, loading, load }
}
