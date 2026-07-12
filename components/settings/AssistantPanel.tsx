"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Loader2 } from "lucide-react";

export function AssistantPanel() {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  // Load on mount with a cancellation guard so a stale response can't set
  // state after the effect is torn down (the state writes are async, past
  // an await — not synchronous in the effect body).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch("/api/settings");
      const data = await r.json();
      if (cancelled) return;
      setConfigured(data.anthropic_api_key === "configured");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropic_api_key: apiKey.trim() }),
      });
      setConfigured(true);
      setApiKey("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-display text-xl">Assistant</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Anthropic API key for the campaign assistant. Create one at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            console.anthropic.com
          </a>
          .
        </p>
      </div>

      {configured && (
        <p className="text-sm text-[var(--hp-high)] flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> API key configured
        </p>
      )}

      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={configured ? "Replace key..." : "sk-ant-..."}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="flex-1"
        />
        <Button onClick={save} disabled={saving || !apiKey.trim()} className="gap-1.5 flex-none">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </section>
  );
}
