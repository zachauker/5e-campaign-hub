"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, generateId, rollD20 } from "@/lib/utils";
import { getModifier } from "@/lib/types";
import type { CombatantWithParsed, StatBlock, DDBCharacter } from "@/lib/types";
import { characterUploadToCombatant, type CharacterUploadSchema } from "@/lib/character-schema";
import { CharacterUpload } from "./CharacterUpload";
import {
  Sword,
  User,
  Users,
  Zap,
  Loader2,
  Search,
  Plus,
  Library,
  Trash2,
} from "lucide-react";

type Tab = "monster" | "npc" | "upload" | "library" | "ddb" | "characters";

interface MonsterResult {
  slug: string;
  name: string;
  cr: string;
  type: string;
  size: string;
  hp: number;
  ac: number;
}

// Use the full DDBCharacter type from the API
type DDBCharacterResult = DDBCharacter;

interface LibraryEntry {
  id: string;
  name: string;
  type: string;
  data: CharacterUploadSchema;
  tags: string[];
  createdAt: string;
}

interface CharacterEntity {
  id: string;
  name: string;
  type: string;
}

interface AddCombatantDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddCombatantDialog({ open, onClose }: AddCombatantDialogProps) {
  const { encounter, addCombatant } = useEncounterStore();
  const [tab, setTab] = useState<Tab>("monster");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [monsterResults, setMonsterResults] = useState<MonsterResult[]>([]);
  const [ddbCharacters, setDdbCharacters] = useState<DDBCharacterResult[]>([]);
  const [loadingDDB, setLoadingDDB] = useState(false);
  const [count, setCount] = useState(1);
  const [npcForm, setNpcForm] = useState({ name: "", ac: "10", hpMax: "10", initiative: "" });
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [characterEntities, setCharacterEntities] = useState<CharacterEntity[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [linkingCharacter, setLinkingCharacter] = useState<CharacterEntity | null>(null);
  const [linkForm, setLinkForm] = useState({ ac: "10", hpMax: "10", initiative: "" });

  useEffect(() => {
    if (tab === "ddb") loadDDBCharacters();
    if (tab === "library") loadLibrary(libraryQuery);
    if (tab === "characters") loadCharacterEntities();
  }, [tab]);

  useEffect(() => {
    if (tab !== "library") return;
    const t = setTimeout(() => loadLibrary(libraryQuery), 250);
    return () => clearTimeout(t);
  }, [libraryQuery, tab]);

  async function loadLibrary(q: string) {
    setLoadingLibrary(true);
    try {
      const url = q.trim() ? `/api/library?q=${encodeURIComponent(q)}` : "/api/library";
      const res = await fetch(url);
      const data = await res.json();
      setLibraryEntries(data);
    } finally {
      setLoadingLibrary(false);
    }
  }

  async function loadCharacterEntities() {
    setLoadingCharacters(true);
    try {
      const url = encounter?.campaignId
        ? `/api/characters?campaignId=${encounter.campaignId}`
        : "/api/characters";
      const res = await fetch(url);
      const data = await res.json();
      setCharacterEntities(data.items);
    } finally {
      setLoadingCharacters(false);
    }
  }

  async function loadDDBCharacters() {
    setLoadingDDB(true);
    try {
      const res = await fetch("/api/ddb/characters");
      const data = await res.json();
      setDdbCharacters(data.characters ?? []);
    } finally {
      setLoadingDDB(false);
    }
  }

  const searchMonsters = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setMonsterResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/monsters/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setMonsterResults(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchMonsters(query), 300);
    return () => clearTimeout(timer);
  }, [query, searchMonsters]);

  async function persistCombatant(combatant: CombatantWithParsed) {
    await fetch(`/api/encounters/${combatant.encounterId}/combatants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(combatant),
    });
  }

  async function addMonster(result: MonsterResult) {
    if (!encounter) return;
    setAddingSlug(result.slug);
    try {
      const res = await fetch(`/api/monsters/search?slug=${result.slug}`);
      const data = await res.json();
      const statBlock: StatBlock = data.statBlock;

      for (let i = 0; i < count; i++) {
        const dexMod = statBlock.dex ? getModifier(statBlock.dex) : 0;
        const initiative = rollD20() + dexMod;
        const name = count > 1 ? `${result.name} ${i + 1}` : result.name;
        const combatant: CombatantWithParsed = {
          id: generateId(),
          encounterId: encounter.id,
          name,
          type: "monster",
          initiative,
          initiativeBonus: dexMod,
          hpCurrent: result.hp,
          hpMax: result.hp,
          hpTemp: 0,
          ac: result.ac,
          speed: 30,
          conditions: [],
          notes: null,
          isConcentrating: false,
          isVisible: true,
          sortOrder: encounter.combatants.length + i,
          ddbCharacterId: null,
          monsterSlug: result.slug,
          statBlock,
          avatarUrl: statBlock.imageUrl ?? null,
          playerName: null,
          color: null,
          characterId: null,
        };
        addCombatant(combatant);
        await persistCombatant(combatant);
      }
    } finally {
      setAddingSlug(null);
    }
  }

  async function addNPC() {
    if (!encounter || !npcForm.name.trim()) return;
    const combatant: CombatantWithParsed = {
      id: generateId(),
      encounterId: encounter.id,
      name: npcForm.name.trim(),
      type: "npc",
      initiative: npcForm.initiative ? parseFloat(npcForm.initiative) : null,
      initiativeBonus: 0,
      hpCurrent: parseInt(npcForm.hpMax, 10) || 10,
      hpMax: parseInt(npcForm.hpMax, 10) || 10,
      hpTemp: 0,
      ac: parseInt(npcForm.ac, 10) || 10,
      speed: 30,
      conditions: [],
      notes: null,
      isConcentrating: false,
      isVisible: true,
      sortOrder: encounter.combatants.length,
      ddbCharacterId: null,
      monsterSlug: null,
      statBlock: null,
      avatarUrl: null,
      playerName: null,
      color: null,
      characterId: null,
    };
    addCombatant(combatant);
    await persistCombatant(combatant);
    setNpcForm({ name: "", ac: "10", hpMax: "10", initiative: "" });
    onClose();
  }

  async function addFromUpload(data: CharacterUploadSchema, saveToLibrary: boolean) {
    if (!encounter) return;
    const combatant = characterUploadToCombatant(data, encounter.id);
    combatant.sortOrder = encounter.combatants.length;
    addCombatant(combatant);
    await persistCombatant(combatant);

    if (saveToLibrary) {
      await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    onClose();
  }

  async function addFromLibrary(entry: LibraryEntry) {
    if (!encounter) return;
    const combatant = characterUploadToCombatant(entry.data, encounter.id);
    combatant.sortOrder = encounter.combatants.length;
    addCombatant(combatant);
    await persistCombatant(combatant);
    onClose();
  }

  async function deleteFromLibrary(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/library/${id}`, { method: "DELETE" });
    setLibraryEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function addDDBCharacter(char: DDBCharacterResult) {
    if (!encounter) return;
    const combatant: CombatantWithParsed = {
      id: generateId(),
      encounterId: encounter.id,
      name: char.name,
      type: "pc",
      initiative: null,
      initiativeBonus: char.initiativeBonus,
      hpCurrent: char.currentHp ?? char.maxHp,
      hpMax: char.maxHp,
      hpTemp: char.tempHp ?? 0,
      ac: char.ac,
      speed: char.speed ?? 30,
      conditions: [],
      notes: null,
      isConcentrating: false,
      isVisible: true,
      sortOrder: encounter.combatants.length,
      ddbCharacterId: String(char.id),
      monsterSlug: null,
      statBlock: {
        name: char.name,
        type: char.classes?.map((c) => `${c.name} ${c.level}`).join(" / "),
        str: char.stats.str,
        dex: char.stats.dex,
        con: char.stats.con,
        int: char.stats.int,
        wis: char.stats.wis,
        cha: char.stats.cha,
        ac: char.ac,
        hp: char.maxHp,
        imageUrl: char.avatarUrl,
      },
      ddbCharacter: char,
      avatarUrl: char.avatarUrl ?? null,
      playerName: char.playerName ?? null,
      color: null,
      characterId: null,
    };
    addCombatant(combatant);
    await persistCombatant(combatant);
  }

  async function addLinkedCharacter() {
    if (!encounter || !linkingCharacter) return;
    const combatant: CombatantWithParsed = {
      id: generateId(),
      encounterId: encounter.id,
      name: linkingCharacter.name,
      type: linkingCharacter.type === "pc" ? "pc" : "npc",
      initiative: linkForm.initiative ? parseFloat(linkForm.initiative) : null,
      initiativeBonus: 0,
      hpCurrent: parseInt(linkForm.hpMax, 10) || 10,
      hpMax: parseInt(linkForm.hpMax, 10) || 10,
      hpTemp: 0,
      ac: parseInt(linkForm.ac, 10) || 10,
      speed: 30,
      conditions: [],
      notes: null,
      isConcentrating: false,
      isVisible: true,
      sortOrder: encounter.combatants.length,
      ddbCharacterId: null,
      monsterSlug: null,
      statBlock: null,
      avatarUrl: null,
      playerName: null,
      color: null,
      characterId: linkingCharacter.id,
    };
    addCombatant(combatant);
    await persistCombatant(combatant);
    setLinkingCharacter(null);
    setLinkForm({ ac: "10", hpMax: "10", initiative: "" });
    onClose();
  }

  const TYPE_COLORS: Record<string, string> = {
    pc: "text-[var(--hp-high)]",
    npc: "text-[var(--initiative)]",
    monster: "text-[var(--hp-low)]",
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "monster", label: "Monster", icon: <Sword className="w-3.5 h-3.5" /> },
    { key: "npc", label: "NPC", icon: <Zap className="w-3.5 h-3.5" /> },
    { key: "upload", label: "Upload", icon: <Library className="w-3.5 h-3.5" /> },
    { key: "library", label: "Library", icon: <Library className="w-3.5 h-3.5" /> },
    { key: "ddb", label: "D&D Beyond", icon: <User className="w-3.5 h-3.5" /> },
    { key: "characters", label: "Characters", icon: <Users className="w-3.5 h-3.5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>Add Combatant</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 p-4 pb-3 border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap",
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Monster search */}
        {tab === "monster" && (
          <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Search monsters (e.g. goblin, dragon)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                <span className="text-xs text-muted-foreground">×</span>
                <Input
                  type="number"
                  min="1"
                  max="20"
                  value={count}
                  onChange={(e) =>
                    setCount(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))
                  }
                  className="w-16 h-9 text-center"
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              {searching && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Searching Open5e...</span>
                </div>
              )}
              {!searching && monsterResults.length === 0 && query.length >= 2 && (
                <p className="text-center py-8 text-muted-foreground text-sm">No monsters found.</p>
              )}
              <div className="space-y-1.5">
                {monsterResults.map((m) => (
                  <div
                    key={m.slug}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add ${m.name}`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer group"
                    onClick={() => addMonster(m)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addMonster(m); }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{m.name}</span>
                        <span className="text-xs text-muted-foreground">CR {m.cr}</span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {m.size} {m.type}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        HP {m.hp} · AC {m.ac}
                      </div>
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-hidden
                      tabIndex={-1}
                      className="opacity-0 group-hover:opacity-100"
                    >
                      {addingSlug === m.slug ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* NPC / Quick custom */}
        {tab === "npc" && (
          <div className="p-4 space-y-3">
            <Input
              autoFocus
              placeholder="Name"
              value={npcForm.name}
              onChange={(e) => setNpcForm({ ...npcForm, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addNPC()}
            />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">AC</label>
                <Input
                  type="number"
                  value={npcForm.ac}
                  onChange={(e) => setNpcForm({ ...npcForm, ac: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Max HP</label>
                <Input
                  type="number"
                  value={npcForm.hpMax}
                  onChange={(e) => setNpcForm({ ...npcForm, hpMax: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Initiative</label>
                <Input
                  type="number"
                  placeholder="—"
                  aria-label="Initiative"
                  value={npcForm.initiative}
                  onChange={(e) => setNpcForm({ ...npcForm, initiative: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              For a full stat block, use the <strong>Upload</strong> tab with a JSON file.
            </p>
            <Button className="w-full" onClick={addNPC} disabled={!npcForm.name.trim()}>
              <Plus className="w-4 h-4" /> Add NPC
            </Button>
          </div>
        )}

        {/* JSON Upload */}
        {tab === "upload" && (
          <div className="p-4">
            <CharacterUpload onParsed={addFromUpload} />
          </div>
        )}

        {/* Library */}
        {tab === "library" && (
          <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search library..."
                value={libraryQuery}
                onChange={(e) => setLibraryQuery(e.target.value)}
                className="pl-8"
              />
            </div>

            <ScrollArea className="flex-1">
              {loadingLibrary && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
              {!loadingLibrary && libraryEntries.length === 0 && (
                <div className="text-center py-10 text-muted-foreground space-y-1">
                  <Library className="w-8 h-8 mx-auto opacity-50" />
                  <p className="text-sm">Library is empty.</p>
                  <p className="text-xs">Upload a JSON character — check the box to save it here.</p>
                </div>
              )}
              <div className="space-y-1.5">
                {libraryEntries.map((entry) => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add ${entry.name}`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer group"
                    onClick={() => addFromLibrary(entry)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addFromLibrary(entry); }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{entry.name}</span>
                        <span className={cn("text-xs capitalize", TYPE_COLORS[entry.type])}>
                          {entry.type}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        HP {entry.data.hpMax} · AC {entry.data.ac}
                        {entry.data.playerName && ` · ${entry.data.playerName}`}
                        {entry.tags.length > 0 && ` · ${entry.tags.join(", ")}`}
                      </p>
                    </div>
                    <div className="relative z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <Button size="icon-sm" variant="ghost" aria-hidden tabIndex={-1}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${entry.name} from library`}
                        title="Delete from library"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => deleteFromLibrary(entry.id, e)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* D&D Beyond characters */}
        {tab === "ddb" && (
          <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
            {loadingDDB ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading from D&D Beyond...</span>
              </div>
            ) : ddbCharacters.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <p className="text-muted-foreground text-sm">
                  No characters found. Add D&D Beyond character share URLs in Settings.
                </p>
                <Button variant="outline" size="sm" onClick={loadDDBCharacters}>
                  Retry
                </Button>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <div className="space-y-2">
                  {ddbCharacters.map((char) => (
                    <div
                      key={char.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Add ${char.name}`}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors cursor-pointer group"
                      onClick={() => { addDDBCharacter(char); onClose(); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addDDBCharacter(char); onClose(); }
                      }}
                    >
                      {char.avatarUrl && (
                        <img
                          src={char.avatarUrl}
                          alt={char.name}
                          className="w-10 h-10 rounded-full object-cover border border-border"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{char.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {char.classes?.map((c) => `${c.name}${c.subclass ? ` (${c.subclass})` : ""} ${c.level}`).join(" / ")}
                          {char.race && ` · ${char.race}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          HP {char.maxHp} · AC {char.ac}
                          {char.background && ` · ${char.background}`}
                          {char.playerName && ` · ${char.playerName}`}
                        </p>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-hidden
                        tabIndex={-1}
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {tab === "characters" && (
          <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
            {!linkingCharacter ? (
              <ScrollArea className="flex-1">
                {loadingCharacters && (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                )}
                {!loadingCharacters && characterEntities.length === 0 && (
                  <p className="text-center py-8 text-muted-foreground text-sm">
                    No characters yet. Add them from the Characters section.
                  </p>
                )}
                <div className="space-y-1.5">
                  {characterEntities.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setLinkingCharacter(c)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <span className="font-medium text-sm flex-1">{c.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">{c.type}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">
                  Adding <strong>{linkingCharacter.name}</strong> to combat
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">AC</label>
                    <Input
                      type="number"
                      value={linkForm.ac}
                      onChange={(e) => setLinkForm({ ...linkForm, ac: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Max HP</label>
                    <Input
                      type="number"
                      value={linkForm.hpMax}
                      onChange={(e) => setLinkForm({ ...linkForm, hpMax: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Initiative</label>
                    <Input
                      type="number"
                      placeholder="—"
                      aria-label="Initiative"
                      value={linkForm.initiative}
                      onChange={(e) => setLinkForm({ ...linkForm, initiative: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setLinkingCharacter(null)}>
                    Back
                  </Button>
                  <Button className="flex-1" onClick={addLinkedCharacter}>
                    <Plus className="w-4 h-4" /> Add
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
