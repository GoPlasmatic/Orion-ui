import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Braces, SlidersHorizontal } from "lucide-react"

interface ConfigEditorShellProps<T> {
  value: T
  onChange: (next: T) => void
  /** Heading shown next to the Form / Advanced(JSON) toggle. */
  label: ReactNode
  /** Form-mode body, rendered when the JSON escape hatch is closed. */
  children: ReactNode
}

/**
 * Shared shell for the structured config editors (channels, connectors). Owns the
 * Form / Advanced (JSON) toggle and the JSON escape hatch, keeping the config object
 * as the single source of truth — the JSON view edits the same object and syncs back
 * on every valid parse. The structured form body is passed as children.
 */
export function ConfigEditorShell<T>({ value, onChange, label, children }: ConfigEditorShellProps<T>) {
  const [mode, setMode] = useState<"form" | "json">("form")
  const [jsonText, setJsonText] = useState("")
  const [jsonError, setJsonError] = useState<string | null>(null)

  const openJson = () => {
    setJsonText(JSON.stringify(value, null, 2))
    setJsonError(null)
    setMode("json")
  }

  const onJsonChange = (text: string) => {
    setJsonText(text)
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setJsonError("Config must be a JSON object")
        return
      }
      setJsonError(null)
      onChange(parsed as T)
    } catch {
      setJsonError("Invalid JSON")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="mb-0">{label}</Label>
        <div className="flex gap-1 rounded-md border p-0.5">
          <Button
            type="button"
            variant={mode === "form" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("form")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Form
          </Button>
          <Button
            type="button"
            variant={mode === "json" ? "secondary" : "ghost"}
            size="sm"
            onClick={openJson}
          >
            <Braces className="h-3.5 w-3.5" /> Advanced (JSON)
          </Button>
        </div>
      </div>

      {mode === "json" ? (
        <div>
          <Textarea
            value={jsonText}
            onChange={(e) => onJsonChange(e.target.value)}
            rows={16}
            className="font-mono text-sm"
          />
          {jsonError && <p className="mt-1 text-xs text-destructive">{jsonError}</p>}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
