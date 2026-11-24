"use client";

import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatSheetEditor, type StatSheetEditorProps } from "./StatSheetEditor";

export function StatSheetEditorDialog({
  open,
  onClose,
  ...editorProps
}: StatSheetEditorProps & { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Edit stat sheet</DialogTitle>
          <DialogDescription className="sr-only">Edit the identity, stats, actions and portrait.</DialogDescription>
        </DialogHeader>
        <StatSheetEditor {...editorProps} className="min-h-0 flex-1" />
      </DialogContent>
    </Dialog>
  );
}
