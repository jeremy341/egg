"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExportTarget = {
  projectId: string;
  /** The tab the card is on: overview, speed, events or visitors. */
  tab: "overview" | "speed" | "events" | "visitors";
  /** The card, as named in `EXPORT_CARDS`. */
  card: string;
};

/** The address of one download. The server reads the same data as the card and checks the owner. */
export function exportHref({ projectId, tab, card }: ExportTarget, format: "csv" | "json"): string {
  const q = new URLSearchParams({ tab, card, format });
  return `/api/projects/${encodeURIComponent(projectId)}/analytics/export?${q}`;
}

/**
 * A small "Export" menu for one card: Download CSV or Download JSON, for the same 30 days the
 * card shows. Both items are plain links with `download`, so they work from the keyboard and
 * need no script of their own. `label` names the card for a screen reader.
 */
export function ExportMenu({ target, label }: { target: ExportTarget; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" aria-label={`Export ${label}`} className="shrink-0" />}
      >
        <DownloadSimpleIcon aria-hidden="true" />
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem render={<a href={exportHref(target, "csv")} download />}>Download CSV</DropdownMenuItem>
        <DropdownMenuItem render={<a href={exportHref(target, "json")} download />}>Download JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
