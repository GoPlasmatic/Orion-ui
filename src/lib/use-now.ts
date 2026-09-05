import { useEffect, useState } from "react"

/**
 * The current time as React state, refreshed every `intervalMs`.
 *
 * For "12s ago" labels and age-based windows. Calling `Date.now()` during
 * render is refused by the purity lint, and would in any case leave every
 * relative label frozen between renders; ticking the state makes them move.
 */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
