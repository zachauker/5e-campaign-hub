"use client";

import React from "react";
import { StatSheetPane } from "./StatSheetPane";

interface StatBlockPanelProps {
  onRefresh?: () => void;
  lastSyncedAt?: Date | null;
  syncing?: boolean;
  syncErrors?: Set<string>;
}

/** The encounter page's side panel: a fixed-width shell around the shared stat-sheet pane. */
export function StatBlockPanel(props: StatBlockPanelProps) {
  return (
    <div className="flex flex-col border-l border-border bg-card overflow-hidden w-80 min-w-80">
      <StatSheetPane {...props} />
    </div>
  );
}
