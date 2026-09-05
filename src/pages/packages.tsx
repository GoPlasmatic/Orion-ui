import { useMemo, useState } from "react"
import { Link } from "react-router"
import { usePackages, usePackage } from "@/hooks/use-packages"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { EmptyState } from "@/components/shared/empty-state"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { enabledBadgeClass } from "@/lib/status"
import { formatDate } from "@/lib/utils"
import { Package } from "lucide-react"
import type { PackageState } from "@/api/types"

const stateClass = (state: PackageState) =>
  state === "applied" ? enabledBadgeClass : "border-warning/40 bg-warning/10 text-warning"

/**
 * Read-only view of package promotion receipts.
 *
 * Recording a receipt is CI's job (`orion-server package`, then
 * `PUT admin/packages/{name}`): the server keeps one receipt per version so it
 * can enforce that an applied version is immutable. Editing that state by hand
 * from a console would desync it from the artifact that owns it, so this page
 * only observes.
 */
export function PackagesPage() {
  const { offset, prev, next } = usePagination()
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading } = usePackages({ limit: PAGE_SIZE, offset })
  const rows = useMemo(() => data?.data ?? [], [data?.data])

  // The list is one row per receipt, ordered by name then newest-first. The
  // detail panel is per package, so default to whatever the first row names.
  const activeName = selected ?? rows[0]?.name ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packages"
        description="Promotion receipts — what was applied to this instance, and when"
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState
                        icon={Package}
                        title="No package receipts"
                        description="Receipts appear once a package is promoted to this instance with orion-server package or the /import endpoints."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow
                      key={`${r.name}@${r.version}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelected(r.name)}
                    >
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="font-mono text-sm">{r.version}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={stateClass(r.state)}>
                          {r.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.principal}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(r.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <PaginationFooter
            offset={offset}
            count={rows.length}
            total={data?.total}
            onPrev={prev}
            onNext={next}
          />
        </div>

        {activeName && <PackageDetailPanel name={activeName} />}
      </div>
    </div>
  )
}

function PackageDetailPanel({ name }: { name: string }) {
  const { data, isLoading } = usePackage(name)

  return (
    <Card className="h-fit">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">{name}</CardTitle>
        <Link
          to={`/audit?resource_type=package&resource_id=${encodeURIComponent(name)}`}
          className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
          title="Every audit row recorded against this package — staged, applied, refused"
        >
          Audit rows
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">Current</p>
              {data.current ? (
                <p className="font-mono text-sm">
                  {data.current.version}
                  <span className="ml-2 text-xs text-muted-foreground">
                    applied {formatDate(data.current.updated_at)}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing applied — every receipt is still staged.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                History ({data.versions.length} {data.versions.length === 1 ? "receipt" : "receipts"})
              </p>
              <ul className="space-y-2">
                {data.versions.map((v) => (
                  <li
                    key={`${v.version}-${v.created_at}`}
                    className="space-y-1 rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{v.version}</span>
                      <Badge variant="outline" className={stateClass(v.state)}>
                        {v.state}
                      </Badge>
                    </div>
                    <p
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={v.content_hash}
                    >
                      {v.content_hash}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {v.principal} · {formatDate(v.updated_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              An applied version is immutable: the same version arriving with a different content
              hash is refused. A failed apply leaves its receipt staged, so a corrected re-run at
              the same version is legal.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
