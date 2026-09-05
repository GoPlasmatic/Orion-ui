import type { ReactNode } from "react"
import { flexRender, type RowData, type Table as TableInstance } from "@tanstack/react-table"
import { Table, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { SortableHead } from "@/components/shared/sortable-head"
import type { listTableFeatures } from "@/lib/table"
import type { ListSort } from "@/lib/use-list-state"
import { PAGE_SIZE } from "@/lib/use-pagination"

/**
 * The list table every entity page draws: a sortable header row, a page of
 * skeleton rows while loading, the empty state across the full width, and one
 * activatable row per entity. The columns and the data are the page's; the
 * chrome is not.
 */
export function EntityTable<T extends RowData>({
  table,
  isLoading,
  sort,
  empty,
  onOpen,
}: {
  table: TableInstance<typeof listTableFeatures, T>
  isLoading: boolean
  /** Column → server field and the current sort; absent for an unsortable table. */
  sort?: ListSort
  /** Rendered across the table when there are no rows. */
  empty: ReactNode
  onOpen: (row: T) => void
}) {
  const columnCount = table.getAllLeafColumns().length
  const rows = table.getRowModel().rows
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const field = sort?.fields[header.column.id]
                return (
                  <SortableHead
                    key={header.id}
                    field={field}
                    sort={sort?.sortBy ?? ""}
                    order={sort?.sortOrder ?? ""}
                    onSort={field && sort ? () => sort.onSort(field) : undefined}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </SortableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: columnCount }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} onActivate={() => onOpen(row.original)}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
