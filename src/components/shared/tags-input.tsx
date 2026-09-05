import { useRef, useState } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { fieldBase } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * A list of tags as chips. Enter or a comma commits the draft, Backspace on an
 * empty draft removes the last chip, blur commits what was typed, and a pasted
 * "a, b, c" becomes three chips. Replaces the comma-separated text fields,
 * where a stray space or a duplicate was invisible until the server answered.
 */
export function TagsInput({
  value,
  onChange,
  placeholder,
  id,
  "aria-label": ariaLabel,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
  "aria-label"?: string
}) {
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const add = (raw: string) => {
    const incoming = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    if (incoming.length === 0) return
    const next = [...value]
    for (const t of incoming) if (!next.includes(t)) next.push(t)
    onChange(next)
  }
  const commit = () => {
    add(draft)
    setDraft("")
  }

  return (
    <div
      className={cn(
        fieldBase,
        "flex min-h-9 cursor-text flex-wrap items-center gap-1 px-2 py-1",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35"
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={(e) => {
              e.stopPropagation()
              onChange(value.filter((t) => t !== tag))
            }}
            className="rounded-full p-0.5 outline-none hover:bg-background/60 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => {
          const text = e.target.value
          if (text.includes(",")) {
            add(text)
            setDraft("")
          } else {
            setDraft(text)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/80"
      />
    </div>
  )
}
