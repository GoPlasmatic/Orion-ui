import { useState } from "react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"

/** What an export says when it lands: a line, optionally with a second. */
export type ExportOutcome = string | { message: string; description?: string }

/**
 * An export button: run the fetch-and-download, hold a pending flag, and
 * report the outcome the one way every failed request is reported. The
 * callback fetches, downloads and returns the success line.
 */
export function useExport(run: () => Promise<ExportOutcome>) {
  const [pending, setPending] = useState(false)
  const start = async () => {
    setPending(true)
    try {
      const outcome = await run()
      if (typeof outcome === "string") toast.success(outcome)
      else toast.success(outcome.message, { description: outcome.description })
    } catch (e) {
      toastError("Export failed", e)
    } finally {
      setPending(false)
    }
  }
  return { run: () => void start(), pending }
}
