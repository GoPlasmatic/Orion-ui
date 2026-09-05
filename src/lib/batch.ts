import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"

/** What a batch of independent requests came to. */
export interface BatchResult {
  done: number
  failed: number
  /** The first refusal's reason, for the toast. */
  first?: unknown
}

/**
 * Run one request per item, all at once, and count what came back. The API
 * has no bulk routes for requeue or breaker reset, and one refusal must not
 * stop the rest.
 */
export async function settleAll<T>(items: readonly T[], run: (item: T) => Promise<unknown>): Promise<BatchResult> {
  const results = await Promise.allSettled(items.map((item) => run(item)))
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
  return { done: results.length - rejected.length, failed: rejected.length, first: rejected[0]?.reason }
}

/**
 * The toast for a batch: "Requeued 3 entries for immediate retry", or
 * "Requeued 2, 1 refused" with the first refusal's details.
 */
export function reportBatch(
  result: BatchResult,
  verb: string,
  noun: [singular: string, plural: string],
  detail = "",
): void {
  const { done, failed, first } = result
  if (failed === 0) {
    toast.success(`${verb} ${done} ${done === 1 ? noun[0] : noun[1]}${detail}`)
  } else {
    toastError(`${verb} ${done}, ${failed} refused`, first)
  }
}
