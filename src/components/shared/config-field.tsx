import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

/** A titled group of related config fields. */
export function ConfigSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-3 rounded-lg border p-4", className)}>
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function FieldLabel({ label, htmlFor }: { label: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {label}
    </label>
  )
}

/** Numeric field; empty input maps to `undefined` so optional config keys stay unset. */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  placeholder,
  min,
  max,
  step,
}: {
  label: string
  value: number | undefined
  onChange: (value: number | undefined) => void
  unit?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value
            onChange(v === "" ? undefined : Number(v))
          }}
        />
        {unit && <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

/** Free-text field; empty input maps to `undefined`. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  placeholder?: string
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <Input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    </div>
  )
}

/** Select bound to a string option list; empty value maps to `undefined`. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  includeEmpty,
}: {
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: { value: string; label: string }[]
  includeEmpty?: string
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <Select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        {includeEmpty !== undefined && <option value="">{includeEmpty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** Inline label + Switch row with an optional helper description. */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}

/**
 * Edits a `string[]` as a comma-separated text field; empty maps to `undefined`.
 * Used for CORS lists, cache key fields, etc.
 */
export function StringListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string[] | undefined
  onChange: (value: string[] | undefined) => void
  placeholder?: string
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <Input
        value={(value ?? []).join(", ")}
        placeholder={placeholder}
        onChange={(e) => {
          const items = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          onChange(items.length > 0 ? items : undefined)
        }}
      />
      <p className="mt-1 text-xs text-muted-foreground">Comma-separated</p>
    </div>
  )
}
