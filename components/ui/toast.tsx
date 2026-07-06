"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "info" | "success" | "error";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. Pass 0 to keep it until dismissed. */
  duration?: number;
}

const ToastContext = createContext<((o: ToastOptions) => void) | null>(null);

/** Fire a transient, non-blocking notification. Replaces window.alert(). */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const VARIANTS: Record<ToastVariant, { Icon: typeof Info; color: string }> = {
  info: { Icon: Info, color: "text-[var(--initiative)]" },
  success: { Icon: CheckCircle2, color: "text-[var(--hp-high)]" },
  error: { Icon: AlertTriangle, color: "text-destructive" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (o: ToastOptions) => {
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, title: o.title, description: o.description, variant: o.variant ?? "info" }]);
      const duration = o.duration ?? 5000;
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Bottom-right stack; sits above app content but below modal dialogs.
          Bottom-center is reserved for the encounter's undo/save toasts. */}
      <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const { Icon, color } = VARIANTS[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 flex-none", color)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="flex-none text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
