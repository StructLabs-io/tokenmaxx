"use client";

/**
 * ProjectsClient — interactive project table with Add and Edit actions.
 *
 * Receives the initial project list from the RSC page.tsx.
 * Add: POST /api/projects
 * Edit: PATCH /api/projects/[id]
 */

import { useState, useTransition, useEffect } from "react";
import { PlusCircle, Pencil } from "lucide-react";
import type { ProjectTotals } from "@/lib/supabase/types";
import { formatTokens, formatCost } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// Dialog (lightweight — no Radix dep)
// ---------------------------------------------------------------------------

interface ProjectDialogProps {
  open: boolean;
  title: string;
  initialData?: {
    id: string;
    display_name: string;
    slug: string;
    client: string | null;
    billable: boolean;
  };
  isNew: boolean;
  onClose: () => void;
  onSave: (data: {
    display_name: string;
    slug: string;
    client?: string;
    billable: boolean;
  }) => Promise<void>;
  saving: boolean;
  error: string | null;
}

function ProjectDialog({
  open,
  title,
  initialData,
  isNew,
  onClose,
  onSave,
  saving,
  error,
}: ProjectDialogProps) {
  const [displayName, setDisplayName] = useState(initialData?.display_name ?? "");
  const [slug, setSlug] = useState(initialData?.slug ?? "");
  const [client, setClient] = useState(initialData?.client ?? "");
  const [billable, setBillable] = useState(initialData?.billable ?? true);
  const [slugTouched, setSlugTouched] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDisplayName(initialData?.display_name ?? "");
      setSlug(initialData?.slug ?? "");
      setClient(initialData?.client ?? "");
      setBillable(initialData?.billable ?? true);
      setSlugTouched(false);
    }
  }, [open, initialData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-derive slug from display_name when creating and slug hasn't been manually edited
  useEffect(() => {
    if (isNew && !slugTouched) {
      setSlug(slugify(displayName));
    }
  }, [displayName, isNew, slugTouched]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      display_name: displayName.trim(),
      slug: slug.trim(),
      client: client.trim() || undefined,
      billable,
    });
  }

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="w-full max-w-md rounded-lg border border-border bg-background shadow-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Display name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Display name <span className="text-destructive">*</span>
            </label>
            <input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Project"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Slug {isNew && <span className="text-destructive">*</span>}
              {!isNew && <span className="text-muted-foreground/60 normal-case font-normal ml-1">(read-only after creation)</span>}
            </label>
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              readOnly={!isNew}
              placeholder="my-project"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring read-only:opacity-60 read-only:cursor-not-allowed"
            />
          </div>

          {/* Client */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Client <span className="text-muted-foreground/60 normal-case font-normal">(optional)</span>
            </label>
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Acme Corp"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Billable checkbox */}
          <div className="flex items-center gap-2.5">
            <input
              id="billable"
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
            />
            <label
              htmlFor="billable"
              className="text-sm text-foreground cursor-pointer select-none"
            >
              Billable project
            </label>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-4 rounded-md border border-input text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !displayName.trim() || !slug.trim()}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : isNew ? "Create project" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extended row type carrying billable flag for the table
// ---------------------------------------------------------------------------

interface ProjectRow extends ProjectTotals {
  billable?: boolean;
}

interface ProjectsClientProps {
  projects: ProjectRow[];
  totalTokens: number;
  unattributedCount: number;
  usingSeedData: boolean;
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function ProjectsClient({
  projects: initialProjects,
  totalTokens: initialTotalTokens,
  unattributedCount,
  usingSeedData,
}: ProjectsClientProps) {
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
  const totalTokens = projects.reduce((s, p) => s + p.totalTokens, 0);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectRow | null>(null);
  const [saving, startTransition] = useTransition();
  const [dialogError, setDialogError] = useState<string | null>(null);

  function openAdd() {
    setEditTarget(null);
    setDialogError(null);
    setDialogOpen(true);
  }

  function openEdit(project: ProjectRow) {
    setEditTarget(project);
    setDialogError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditTarget(null);
    setDialogError(null);
  }

  async function handleSave(data: {
    display_name: string;
    slug: string;
    client?: string;
    billable: boolean;
  }) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        setDialogError(null);

        try {
          let res: Response;
          if (editTarget) {
            res = await fetch(`/api/projects/${editTarget.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                display_name: data.display_name,
                client: data.client || null,
                billable: data.billable,
              }),
            });
          } else {
            res = await fetch("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
          }

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setDialogError(body.error ?? "Request failed");
            resolve();
            return;
          }

          const saved = await res.json();

          if (editTarget) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === saved.id
                  ? {
                      ...p,
                      display_name: saved.display_name,
                      client: saved.client,
                      billable: saved.billable,
                    }
                  : p
              )
            );
          } else {
            // New project: append with zero usage
            setProjects((prev) => [
              ...prev,
              {
                id: saved.id,
                slug: saved.slug,
                display_name: saved.display_name,
                client: saved.client,
                billable: saved.billable,
                totalTokens: 0,
                totalCost: null,
              },
            ]);
          }

          closeDialog();
          resolve();
        } catch {
          setDialogError("Network error — please try again");
          resolve();
        }
      });
    });
  }

  const isNew = editTarget === null;

  return (
    <>
      {/* Header row with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI usage by project (30-day window)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={usingSeedData ? "secondary" : "outline"}
            className="text-xs"
          >
            {usingSeedData ? "Seed data" : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
          </Badge>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <PlusCircle className="h-4 w-4" />
            Add project
          </button>
        </div>
      </div>

      {/* Projects table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Project</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">% of tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(() => {
              // §4.1 — Group projects by client like Toggl: client header row
              // (collapsible) above its project rows; clients ordered by total
              // tokens desc; projects within client ordered the same.
              const byClient = new Map<string, typeof projects>();
              for (const p of projects) {
                const c = p.client || "Unaffiliated";
                if (!byClient.has(c)) byClient.set(c, []);
                byClient.get(c)!.push(p);
              }
              const groups = Array.from(byClient.entries())
                .map(([client, ps]) => ({
                  client,
                  projects: [...ps].sort((a, b) => b.totalTokens - a.totalTokens),
                  totalTokens: ps.reduce((s, p) => s + p.totalTokens, 0),
                  totalCost: ps.some((p) => p.totalCost != null)
                    ? ps.reduce((s, p) => s + (p.totalCost ?? 0), 0)
                    : null,
                }))
                .sort((a, b) => b.totalTokens - a.totalTokens);

              const rows: React.ReactNode[] = [];
              for (const g of groups) {
                rows.push(
                  <TableRow key={`client-${g.client}`} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell className="pl-6 font-semibold text-sm text-foreground">
                      {g.client}
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        ({g.projects.length} project{g.projects.length !== 1 ? "s" : ""})
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground font-medium">
                      {formatTokens(g.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right text-foreground font-medium">
                      {totalTokens > 0
                        ? `${Math.round((g.totalTokens / totalTokens) * 100)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground font-medium">
                      {g.totalCost != null ? formatCost(g.totalCost) : "—"}
                    </TableCell>
                    <TableCell className="pr-6"></TableCell>
                  </TableRow>,
                );
                for (const project of g.projects) {
                  rows.push(
                    <TableRow key={project.id}>
                      <TableCell className="pl-10">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full shrink-0 opacity-70"
                            style={{ background: "#6366f1" }}
                          />
                          <span className="text-sm">{project.display_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatTokens(project.totalTokens)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {totalTokens > 0
                          ? `${Math.round((project.totalTokens / totalTokens) * 100)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {project.totalCost != null ? formatCost(project.totalCost) : "—"}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => openEdit(project)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Edit ${project.display_name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-xs text-primary hover:underline"
                          >
                            Details
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>,
                  );
                }
              }
              return rows;
            })()}

            {/* Unattributed row */}
            {unattributedCount > 0 && (
              <TableRow>
                <TableCell className="pl-6">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground shrink-0" />
                    <span className="text-muted-foreground italic">Unattributed</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="pr-6" />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit dialog */}
      <ProjectDialog
        open={dialogOpen}
        title={isNew ? "Add project" : "Edit project"}
        isNew={isNew}
        initialData={
          editTarget
            ? {
                id: editTarget.id,
                display_name: editTarget.display_name,
                slug: editTarget.slug,
                client: editTarget.client ?? null,
                billable: editTarget.billable ?? true,
              }
            : undefined
        }
        onClose={closeDialog}
        onSave={handleSave}
        saving={saving}
        error={dialogError}
      />
    </>
  );
}
