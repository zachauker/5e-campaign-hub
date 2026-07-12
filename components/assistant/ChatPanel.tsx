"use client";

import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/lib/store/ui-store";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
}

export function ChatPanel() {
  const open = useUIStore((s) => s.assistantOpen);
  const setOpen = useUIStore((s) => s.setAssistantOpen);
  const pending = useUIStore((s) => s.assistantPending);
  const { activeCampaignId } = useCampaignStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const consumed = useRef<string | null>(null);

  async function ask(question: string) {
    if (!question.trim() || !activeCampaignId) return;
    const nextMsgs: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages([...nextMsgs, { role: "assistant", content: "" }]);
    setProposals([]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId: activeCampaignId,
          messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Assistant failed" }));
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: err.error ?? "Assistant failed" };
          return copy;
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          const evt = JSON.parse(line) as {
            type: string;
            text?: string;
            proposal?: Proposal;
            message?: string;
          };
          if (evt.type === "text" && evt.text) {
            assistantText += evt.text;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: assistantText };
              return copy;
            });
          } else if (evt.type === "proposal" && evt.proposal) {
            setProposals((p) => [...p, evt.proposal!]);
          } else if (evt.type === "error") {
            assistantText += `\n\n⚠️ ${evt.message ?? "error"}`;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: assistantText };
              return copy;
            });
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (open && pending && consumed.current !== pending) {
      consumed.current = pending;
      void ask(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  async function confirm(p: Proposal) {
    setProposals((list) => list.filter((x) => x !== p));
    const res = await fetch(p.targetRoute, {
      method: p.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p.payload),
    });
    const ok = res.ok;
    setMessages((m) => [
      ...m,
      { role: "assistant", content: ok ? `✓ Done: ${p.summary}` : `⚠️ Failed: ${p.summary} (${res.status})` },
    ]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-semibold">Assistant</span>
        <button onClick={() => setOpen(false)} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {m.content || (busy ? "…" : "")}
            </div>
          </div>
        ))}
        {proposals.map((p, i) => (
          <div key={`p${i}`} className="rounded-lg border border-border p-3 text-sm">
            <p className="mb-2">{p.summary}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => confirm(p)}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setProposals((list) => list.filter((x) => x !== p))}>
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const q = input;
          setInput("");
          void ask(q);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your campaign…"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
