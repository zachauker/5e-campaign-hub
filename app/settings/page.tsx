"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, Loader2, Plus, Trash2, User, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { NotionSyncPanel } from "@/components/settings/NotionSyncPanel";
import { AssistantPanel } from "@/components/settings/AssistantPanel";

interface SavedCharacterUrl {
  id: string;
  url: string;
  name?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const activeCampaignId = useCampaignStore((s) => s.activeCampaignId);
  const bumpCampaigns = useCampaignStore((s) => s.bumpCampaigns);
  const [campaignName, setCampaignName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareUrls, setShareUrls] = useState<SavedCharacterUrl[]>([]);
  const [newShareUrl, setNewShareUrl] = useState("");
  const [testingUrl, setTestingUrl] = useState(false);
  const [urlTestResult, setUrlTestResult] = useState<string | null>(null);
  const [urlTestOk, setUrlTestOk] = useState(false);
  const [notionToken, setNotionToken] = useState("");
  const [notionConfigured, setNotionConfigured] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        try { setShareUrls(JSON.parse(data.ddb_share_urls ?? "[]")); } catch {}
        setNotionConfigured(Boolean(data.notion_token));
      });
  }, []);

  // The campaign name is the active campaign's real name (campaigns.name), the
  // same source the TopBar and dashboard read — not a separate global setting.
  useEffect(() => {
    if (!activeCampaignId) return;
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((cs: { id: string; name: string }[]) => {
        setCampaignName(cs.find((c) => c.id === activeCampaignId)?.name ?? "");
      })
      .catch(() => {});
  }, [activeCampaignId]);

  async function save() {
    setSaving(true);
    try {
      if (activeCampaignId) {
        await fetch(`/api/campaigns/${activeCampaignId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: campaignName }),
        });
        // Tell the persistent TopBar / dashboard to re-fetch the renamed campaign.
        bumpCampaigns();
      }
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ddb_share_urls: JSON.stringify(shareUrls) }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotionToken() {
    if (!notionToken.trim()) return;
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notion_token: notionToken.trim() }),
    });
    setNotionConfigured(true);
    setNotionToken("");
  }

  async function addShareUrl() {
    const url = newShareUrl.trim();
    if (!url) return;
    if (shareUrls.some((u) => u.url === url)) {
      setUrlTestResult("Already added");
      setUrlTestOk(false);
      return;
    }
    setTestingUrl(true);
    setUrlTestResult(null);
    try {
      const res = await fetch("/api/ddb/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareUrl: url }),
      });
      const data = await res.json();
      if (data.character) {
        const { character: char } = data;
        setUrlTestOk(true);
        setUrlTestResult(`✓ ${char.name} — Level ${char.level} ${char.race ?? ""} (HP ${char.maxHp}, AC ${char.ac})`);
        const newEntry: SavedCharacterUrl = { id: crypto.randomUUID(), url, name: char.name };
        const updated = [...shareUrls, newEntry];
        setShareUrls(updated);
        setNewShareUrl("");
        // Persist immediately so the encounter dialog sees it without a manual save
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ddb_share_urls: JSON.stringify(updated) }),
        });
      } else {
        setUrlTestOk(false);
        setUrlTestResult(`✗ ${data.error ?? "Could not fetch character"}`);
      }
    } finally {
      setTestingUrl(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button size="icon-sm" variant="ghost" onClick={() => router.push("/")} aria-label="Back to dashboard" title="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-display text-2xl leading-none">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* General */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="font-display text-xl">General</h2>
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Campaign Name</label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="My Campaign"
            />
          </div>
        </section>

        {/* D&D Beyond Characters */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="font-display text-xl">D&D Beyond Characters</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Add each PC’s character sheet URL. They’ll appear in the D&D Beyond tab when adding combatants.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-muted border border-border p-3 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-[var(--initiative)]" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">How to get a character URL</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Open the character on D&D Beyond</li>
                <li>Click <strong>Share</strong> and enable sharing if prompted</li>
                <li>Copy the URL from the browser address bar</li>
                <li>Paste it below — characters don’t need to be public, just shared</li>
              </ol>
            </div>
          </div>

          {/* URL input */}
          <div className="flex gap-2">
            <Input
              placeholder="https://www.dndbeyond.com/characters/12345678"
              value={newShareUrl}
              onChange={(e) => { setNewShareUrl(e.target.value); setUrlTestResult(null); }}
              onKeyDown={(e) => e.key === "Enter" && addShareUrl()}
              className="flex-1"
            />
            <Button
              onClick={addShareUrl}
              disabled={testingUrl || !newShareUrl.trim()}
              className="gap-1.5 flex-none"
            >
              {testingUrl
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Plus className="w-3.5 h-3.5" />}
              Add
            </Button>
          </div>

          {urlTestResult && (
            <p className={cn("text-sm", urlTestOk ? "text-[var(--hp-high)]" : "text-destructive")}>
              {urlTestResult}
            </p>
          )}

          {/* Saved characters */}
          {shareUrls.length > 0 ? (
            <div className="space-y-1.5">
              {shareUrls.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted border border-border">
                  <User className="w-4 h-4 text-[var(--hp-high)] flex-none" />
                  <div className="flex-1 min-w-0">
                    {entry.name && <p className="text-sm font-medium leading-tight">{entry.name}</p>}
                    <p className="text-xs text-muted-foreground truncate">{entry.url}</p>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${entry.name || "character"}`}
                    title="Remove character"
                    className="text-destructive hover:text-destructive flex-none"
                    onClick={async () => {
                    const updated = shareUrls.filter((u) => u.id !== entry.id);
                    setShareUrls(updated);
                    await fetch("/api/settings", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ddb_share_urls: JSON.stringify(updated) }),
                    });
                  }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-lg">
              No characters added yet
            </p>
          )}
        </section>

        {/* Notion Integration */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="font-display text-xl">Notion Integration</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Paste your Notion internal integration secret to pull linked page content into character, location, item, and faction detail pages. Create one at{" "}
              <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                notion.so/my-integrations
              </a>
              , then share the relevant pages with it.
            </p>
          </div>

          {notionConfigured && (
            <p className="text-sm text-[var(--hp-high)] flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Token configured
            </p>
          )}

          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={notionConfigured ? "Replace token..." : "secret_..."}
              value={notionToken}
              onChange={(e) => setNotionToken(e.target.value)}
              className="flex-1"
            />
            <Button onClick={saveNotionToken} disabled={!notionToken.trim()} className="flex-none">
              Save
            </Button>
          </div>
        </section>

        {/* Notion Sync */}
        <NotionSyncPanel campaignId={activeCampaignId} />

        {/* Campaign Assistant */}
        <AssistantPanel />

        <Button onClick={save} disabled={saving} className="gap-1.5 w-full">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
          {saved ? "Saved!" : saving ? "Saving..." : "Save Settings"}
        </Button>
      </main>
    </div>
  );
}
