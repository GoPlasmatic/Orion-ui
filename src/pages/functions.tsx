import { useMemo, useState } from "react"
import { useFunctions } from "@/hooks/use-functions"
import type { FunctionSchema } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { AlertCircle, FunctionSquare } from "lucide-react"

function FunctionCard({ fn }: { fn: FunctionSchema }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          {fn.name}
          <Badge variant="secondary" className="font-sans text-xs">{fn.category}</Badge>
        </CardTitle>
        <CardDescription>{fn.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {fn.input_fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No input fields.</p>
        ) : (
          <div className="space-y-2">
            {fn.input_fields.map((field) => (
              <div key={field.name} className="rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{field.name}</span>
                  <Badge variant="outline" className="text-xs">{field.kind}</Badge>
                  {field.required && (
                    <Badge variant="outline" className="border-chart-3/40 bg-chart-3/10 text-xs text-chart-3">
                      required
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function FunctionsPage() {
  const { data: functions, isLoading, error } = useFunctions()
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (functions ?? []).filter(
      (fn) =>
        !q ||
        fn.name.toLowerCase().includes(q) ||
        fn.description.toLowerCase().includes(q) ||
        fn.category.toLowerCase().includes(q)
    )
    const byCategory = new Map<string, FunctionSchema[]>()
    for (const fn of filtered) {
      const list = byCategory.get(fn.category) ?? []
      list.push(fn)
      byCategory.set(fn.category, list)
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [functions, query])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Functions"
        description="Workflow function reference — the input schema each task function accepts"
      />

      <Input
        placeholder="Search functions..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
        aria-label="Search functions"
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load the function registry.</p>
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={FunctionSquare}
          title="No functions found"
          description="No registered functions match the search."
        />
      ) : (
        grouped.map(([category, fns]) => (
          <section key={category} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {category}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {fns.map((fn) => (
                <FunctionCard key={fn.name} fn={fn} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
