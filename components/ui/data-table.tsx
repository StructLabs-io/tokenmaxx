"use client";

/**
 * Shared TanStack Table v8 wrapper — Airtable-style sort/filter/pagination on
 * top of shadcn Table primitives. Pilot per §7 of the feedback plan; goal is
 * to apply this same component to /raw first, then /usage, /projects, /models,
 * /users, /reconcile.
 */

import { useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pageSize?: number;
  globalFilterPlaceholder?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageSize = 25,
  globalFilterPlaceholder,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: { sorting, columnFilters, globalFilter },
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className="space-y-2">
      {globalFilterPlaceholder !== undefined && (
        <div className="flex items-center gap-2">
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={globalFilterPlaceholder}
            className="h-8 max-w-xs text-sm"
          />
          {globalFilter && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setGlobalFilter("")}>
              Clear
            </Button>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} className="select-none">
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          disabled={!header.column.getCanSort()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            sorted === "asc" ? <ArrowUp className="h-3 w-3" />
                            : sorted === "desc" ? <ArrowDown className="h-3 w-3" />
                            : <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length} className="text-center py-6 text-muted-foreground text-sm">No data.</TableCell></TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {table.getFilteredRowModel().rows.length.toLocaleString()} rows
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Prev
          </Button>
          <span className="text-muted-foreground">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
          </span>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
