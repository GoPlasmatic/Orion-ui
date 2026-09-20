import { useEffect, useRef, useState, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * The filter row above a list table. Exists so every list page lays its filters
 * out identically and so the controls stay at a sane width — a bare
 * `<Select>` is `w-full`, which stretched two dropdowns across the whole page.
 * Give each control an explicit width (`FILTER_W` unless it needs more).
 */
export function FilterBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
  )
}

/** Default width for a filter control, so rows line up across pages. */
export const FILTER_W = "w-full sm:w-44"

/** How long typing pauses before the filter reaches the URL and the server. */
const DEBOUNCE_MS = 300

/**
 * A free-text list filter — a tag, a channel name, a principal.
 *
 * The typed value is local and the committed one lands after a pause, because
 * every commit is a URL navigation *and* a list request: typing `alpha` into
 * an uncontrolled version cost five requests, four of them for prefixes the
 * server can only answer with nothing. These filters are exact matches
 * server-side (case-insensitive, untrimmed), so the four were not near misses
 * — they were empty lists flashing under the pointer.
 *
 * `value` stays authoritative: a cleared filter, a deep link or the Back
 * button replaces what is typed, while a commit already in flight does not
 * bounce back.
 */
export function FilterTextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = FILTER_W,
  title,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
  className?: string
  title?: string
}) {
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    // Adjusting state while rendering: the committed value moved (this input's
    // own commit landed, or a clear, a deep link or the Back button replaced
    // it), so the typed text follows it. Anything still waiting to be
    // committed is dropped by the effect below rather than landing on top.
    setLastValue(value)
    setText(value)
  }

  // The commit callback is read through a ref so that a parent re-render —
  // a polling list, a metrics tick — does not reschedule a pending commit.
  const commit = useRef(onChange)
  useEffect(() => {
    commit.current = onChange
  })
  useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => commit.current(text), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, value])

  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      // Enter and leaving the field are both "I meant that": commit now.
      onKeyDown={(e) => e.key === "Enter" && text !== value && onChange(text)}
      onBlur={() => text !== value && onChange(text)}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      title={title}
    />
  )
}

/**
 * Keeps a value the dropdown does not know about visible in it.
 *
 * Several of these vocabularies are open strings on the wire — a trace mode,
 * an admission verdict, an audit action — so a URL may legitimately name one
 * this build never listed. Dropping it would leave the control reading "All
 * modes" over a list filtered to nothing; this shows what was actually asked
 * for, the way the Schedules page has always shown an unlisted channel.
 */
export function UnknownOption({ value, options }: { value: string; options: readonly string[] }) {
  if (!value || options.includes(value)) return null
  return <option value={value}>{value}</option>
}
