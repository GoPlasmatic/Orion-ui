import { useMemo, useState } from "react"
import { useFunctions } from "@/hooks/use-functions"
import type { FunctionSchema } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/ui/callout"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { AlertCircle, FunctionSquare } from "lucide-react"

/**
 * Category display order. The server's `category` is an open string, so
 * anything unlisted sorts after these alphabetically rather than being hidden.
 */
const CATEGORY_ORDER = ["connector", "data", "control", "utility"]

const CATEGORY_BLURB: Record<string, string> = {
  connector: "Calls an external system through a connector reference.",
  data: "Reshapes, parses or emits the message documents.",
  control: "Directs the run itself — branching, calling another channel, halting.",
  utility: "Self-contained helpers that need no connector and no egress.",
}

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category)
  return i === -1 ? CATEGORY_ORDER.length : i
}

/**
 * One catalogue entry.
 *
 * `input_fields` is **absent** for an engine built-in (Orion 1.2), which is a
 * different statement from an empty array: the engine executes the function
 * itself and declares no input schema, so Orion does not input-validate it at
 * create time. Saying "no input fields" for both would tell an author the
 * function takes no configuration, which is false for `map` and `filter`.
 */
function FunctionCard({ fn }: { fn: FunctionSchema }) {
  const isEngine = fn.source === "engine"
  const fields = fn.input_fields ?? null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
          {fn.name}
          <Badge variant="secondary" className="font-sans text-xs">{fn.category}</Badge>
          <Badge
            variant="outline"
            className="font-sans text-xs"
            title={
              isEngine
                ? "A dataflow-rs built-in the engine executes itself"
                : "A handler Orion implements and input-schema validates at create time"
            }
          >
            {isEngine ? "engine" : "orion"}
          </Badge>
          {fn.aliases?.map((alias) => (
            <Badge
              key={alias}
              variant="outline"
              className="text-xs text-muted-foreground"
              title={`\`${alias}\` is also accepted for \`${fn.name}\``}
            >
              alias: {alias}
            </Badge>
          ))}
        </CardTitle>
        <CardDescription>{fn.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {fields === null ? (
          <p className="text-sm text-muted-foreground">
            Engine built-in — declares no input schema, so its <code className="font-mono">input</code>{" "}
            is not checked at create time. See the Orion function reference for the shape it expects.
          </p>
        ) : fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Takes no input fields.</p>
        ) : (
          <div className="space-y-2">
            {fields.map((field) => (
              <div key={field.name} className="rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{field.name}</span>
                  <Badge variant="outline" className="text-xs">{field.kind}</Badge>
                  {field.required && (
                    <Badge variant="warning" className="text-xs">
                      required
                    </Badge>
                  )}
                  {field.resolvable && (
                    <Badge
                      variant="outline"
                      className="text-xs"
                      title={`Folds {"var": "..."} nodes against the message at execution`}
                    >
                      resolvable
                    </Badge>
                  )}
                  {field.secret_at?.length > 0 && (
                    <Badge
                      variant="info"
                      className="text-xs"
                      title={secretHint(field.secret_at)}
                    >
                      secret
                    </Badge>
                  )}
                  {field.alias && (
                    <span className="text-xs text-muted-foreground">alias: {field.alias}</span>
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

/**
 * Where a field reads key material (1.3). `""` is the field's own value —
 * `{"secret": "name"}` stands in for the literal; any other path names the
 * member inside it that does, e.g. `[].key` for `jwt_verify.keys`.
 */
function secretHint(paths: string[]): string {
  const inside = paths.filter((p) => p !== "")
  const own = paths.includes("")
  const parts: string[] = []
  if (own) parts.push(`takes {"secret": "name"} in place of a literal`)
  if (inside.length) parts.push(`takes {"secret": "name"} at ${inside.join(", ")}`)
  return `${parts.join("; ")} — read from the instance's [secrets] store, never recorded in a trace`
}

export function FunctionsPage() {
  const { data: functions, isLoading, error } = useFunctions()
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("")

  const all = useMemo(() => functions ?? [], [functions])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = all.filter((fn) => {
      if (source && fn.source !== source) return false
      if (!q) return true
      return (
        fn.name.toLowerCase().includes(q) ||
        fn.description.toLowerCase().includes(q) ||
        fn.category.toLowerCase().includes(q) ||
        (fn.aliases ?? []).some((a) => a.toLowerCase().includes(q))
      )
    })
    const byCategory = new Map<string, FunctionSchema[]>()
    for (const fn of filtered) {
      const list = byCategory.get(fn.category) ?? []
      list.push(fn)
      byCategory.set(fn.category, list)
    }
    for (const list of byCategory.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return [...byCategory.entries()].sort(
      ([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b)
    )
  }, [all, query, source])

  const engineCount = all.filter((fn) => fn.source === "engine").length
  const shown = grouped.reduce((n, [, fns]) => n + fns.length, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Functions"
        description="Every function name a workflow task may call, and the input schema each one accepts"
      />

      {/* Orion 1.2 widened this endpoint from the schema registry to the whole
          catalogue. Worth saying once on the page: the two halves are validated
          differently, and that is exactly what the `engine` badge marks. */}
      {!isLoading && !error && engineCount > 0 && (
        <Callout variant="info">
          <span className="font-medium">{all.length} functions</span> — {all.length - engineCount}{" "}
          Orion handlers, which are input-schema validated when a workflow is created, and{" "}
          {engineCount} dataflow-rs engine built-ins, which the engine executes itself and which
          declare no input schema.
        </Callout>
      )}

      <FilterBar>
        <Input
          placeholder="Search functions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={FILTER_W}
          aria-label="Search functions"
        />
        <Select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={FILTER_W}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          <option value="orion">Orion handlers</option>
          <option value="engine">Engine built-ins</option>
        </Select>
        {(query || source) && (
          <span className="self-center text-xs text-muted-foreground">
            {shown} of {all.length}
          </span>
        )}
      </FilterBar>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load the function catalogue.</p>
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={FunctionSquare}
          title="No functions found"
          description="No catalogued function matches the search."
        />
      ) : (
        grouped.map(([category, fns]) => (
          <section key={category} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </h2>
              {CATEGORY_BLURB[category] && (
                <p className="text-xs text-muted-foreground">{CATEGORY_BLURB[category]}</p>
              )}
            </div>
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
