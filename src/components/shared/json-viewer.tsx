import { useState } from "react"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

interface JsonViewerProps {
  data: unknown
  label?: string
  maxHeight?: string
  collapsible?: boolean
}

export function JsonViewer({
  data,
  label,
  maxHeight = "24rem",
  collapsible = true,
}: JsonViewerProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)

  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2)

  const handleCopy = () => {
    void copyText(json, "JSON").then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-lg border">
      {label && (
        <div className="flex items-center justify-between border-b px-3 py-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium"
            onClick={() => collapsible && setCollapsed(!collapsed)}
          >
            {collapsible &&
              (collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              ))}
            {label}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2"
            aria-label={copied ? "Copied" : "Copy JSON"}
            title="Copy JSON"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
      {!collapsed && (
        <pre
          className={cn(
            "overflow-auto p-3 text-xs font-mono bg-muted/30",
            !label && "rounded-lg"
          )}
          style={{ maxHeight }}
        >
          {json}
        </pre>
      )}
    </div>
  )
}
