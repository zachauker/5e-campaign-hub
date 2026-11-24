"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { validateCharacterUpload, type CharacterUploadSchema } from "@/lib/character-schema";
import { applySpeedText } from "@/lib/library/sheet-form";
import { portraitUrl } from "@/lib/library/portrait";

type Sheet = CharacterUploadSchema;
type StatBlockFields = NonNullable<Sheet["statBlock"]>;
type NamedEntry = { name: string; desc: string };
type ListKey = "abilities" | "actions" | "bonusActions" | "reactions" | "legendaryActions";

export interface StatSheetEditorProps {
  /** The sheet being edited. Controlled: every edit calls `onChange` with the next sheet. */
  value: Sheet;
  /** The library row this sheet belongs to. Null before a row exists, which disables portrait upload. */
  entryId: string | null;
  /** The row's uploaded portrait path, if any. Only needed to preview an existing upload. */
  imagePath?: string | null;
  onChange: (next: Sheet) => void;
  /** Called with the sheet only when it has no validation errors. Warnings do not block. */
  onSave: (value: Sheet) => void | Promise<void>;
  onCancel: () => void;
  saving?: boolean;
  /** Fired after an upload or removal succeeds, with the row's new imagePath. */
  onPortraitChanged?: (imagePath: string | null) => void;
  /** Hides Tags and Notes, for hosts that have nowhere to store them (a combatant). */
  hideLibraryFields?: boolean;
  className?: string;
}

const textareaClass =
  "flex w-full rounded-md border border-border bg-muted px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const labelClass = "block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

const LISTS: { key: ListKey; label: string; addLabel: string }[] = [
  { key: "abilities", label: "Traits and abilities", addLabel: "Add ability" },
  { key: "actions", label: "Actions", addLabel: "Add action" },
  { key: "bonusActions", label: "Bonus actions", addLabel: "Add bonus action" },
  { key: "reactions", label: "Reactions", addLabel: "Add reaction" },
  { key: "legendaryActions", label: "Legendary actions", addLabel: "Add legendary action" },
];

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

type Parsed<T> = { ok: true; value: T } | { ok: false };

/**
 * An input that holds the raw text while the DM types and only commits a value
 * once the text parses. A half-typed "-" or "1." therefore never reaches the
 * sheet as NaN; on blur the text snaps back to the last committed value.
 */
function DraftInput<T>({
  value,
  format,
  parse,
  onCommit,
  syncExternal = true,
  ...inputProps
}: {
  /** False for a value that is a lossy derivation of what was committed (Speed), so it cannot rewrite the draft. */
  syncExternal?: boolean;
  value: T;
  format: (v: T) => string;
  parse: (text: string) => Parsed<T>;
  onCommit: (v: T) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(() => format(value));
  const [seen, setSeen] = useState(value);
  // A change that did not come from this input (reset, other tab) wins over the draft.
  if (value !== seen) {
    setSeen(value);
    const p = syncExternal ? parse(draft) : null;
    if (p && (!p.ok || format(p.value) !== format(value))) setDraft(format(value));
  }
  return (
    <Input
      {...inputProps}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const p = parse(e.target.value);
        if (p.ok) onCommit(p.value);
      }}
      onBlur={(e) => {
        setDraft(format(value));
        inputProps.onBlur?.(e);
      }}
    />
  );
}

function parseNumber(text: string, optional: boolean): Parsed<number | undefined> {
  const t = text.trim();
  if (t === "") return optional ? { ok: true, value: undefined } : { ok: false };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** Optional number: clearing the field removes the key. */
function NumField({
  value,
  onCommit,
  ...rest
}: { value: number | undefined; onCommit: (v: number | undefined) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <DraftInput<number | undefined>
      {...rest}
      inputMode="decimal"
      value={value}
      format={(v) => (v === undefined ? "" : String(v))}
      parse={(t) => parseNumber(t, true)}
      onCommit={onCommit}
    />
  );
}

/** Required number: clearing is not a commit, so the previous value stands until blur restores it. */
function RequiredNumField({
  value,
  onCommit,
  ...rest
}: { value: number; onCommit: (v: number) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <DraftInput<number>
      {...rest}
      inputMode="decimal"
      value={value}
      format={(v) => String(v)}
      parse={(t) => {
        const p = parseNumber(t, false);
        return p.ok && p.value !== undefined ? { ok: true, value: p.value } : { ok: false };
      }}
      onCommit={onCommit}
    />
  );
}

/** Optional text: clearing the field removes the key rather than writing "". */
function TextField({
  value,
  onCommit,
  ...rest
}: { value: string | undefined; onCommit: (v: string | undefined) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return <Input {...rest} value={value ?? ""} onChange={(e) => onCommit(e.target.value === "" ? undefined : e.target.value)} />;
}

function TextArea({
  value,
  onCommit,
  ...rest
}: { value: string | undefined; onCommit: (v: string | undefined) => void } & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
>) {
  return (
    <textarea
      {...rest}
      className={cn(textareaClass, rest.className)}
      value={value ?? ""}
      onChange={(e) => onCommit(e.target.value === "" ? undefined : e.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
// Repeating editors
// ---------------------------------------------------------------------------

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

/** Name + description rows with add, remove and reorder. */
function NamedEntryList({
  title,
  addLabel,
  entries,
  onChange,
}: {
  title: string;
  addLabel: string;
  entries: NamedEntry[];
  onChange: (next: NamedEntry[]) => void;
}) {
  const update = (i: number, patch: Partial<NamedEntry>) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...entries];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...entries, { name: "", desc: "" }])}>
          <Plus className="h-3 w-3" />
          {addLabel}
        </Button>
      </div>
      {entries.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
      {entries.map((entry, i) => (
        <div key={i} className="rounded-md border border-border p-2 space-y-2">
          <div className="flex items-center gap-1">
            <Input
              placeholder="Name"
              aria-label={`${title} ${i + 1} name`}
              value={entry.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === entries.length - 1}>
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Remove" onClick={() => onChange(entries.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <textarea
            className={textareaClass}
            rows={3}
            placeholder="Description"
            aria-label={`${title} ${i + 1} description`}
            value={entry.desc}
            onChange={(e) => update(i, { desc: e.target.value })}
          />
        </div>
      ))}
    </section>
  );
}

/** `last` is the last parseable number, kept so a half-edited number never deletes the entry. */
type RecordRow = { key: string; raw: string; last?: number };

/**
 * A name -> number map (saving throws, skills). Rows live in local state so a
 * half-filled row can sit there; only rows with a name and a numeric value are
 * written to the sheet.
 */
function RecordEditor({
  title,
  keyPlaceholder,
  value,
  onChange,
}: {
  title: string;
  keyPlaceholder: string;
  value: Record<string, number> | undefined;
  onChange: (next: Record<string, number> | undefined) => void;
}) {
  const [rows, setRows] = useState<RecordRow[]>(() =>
    Object.entries(value ?? {}).map(([key, n]) => ({ key, raw: String(n), last: n }))
  );

  const commit = (next: RecordRow[]) => {
    next = next.map((r) => {
      const p = parseNumber(r.raw, false);
      return p.ok && p.value !== undefined ? { ...r, last: p.value } : r;
    });
    setRows(next);
    const rec: Record<string, number> = {};
    for (const r of next) {
      const k = r.key.trim();
      const p = parseNumber(r.raw, false);
      const n = p.ok && p.value !== undefined ? p.value : r.last;
      if (k && n !== undefined) rec[k] = n;
    }
    onChange(Object.keys(rec).length > 0 ? rec : undefined);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={cn(labelClass, "mb-0")}>{title}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => commit([...rows, { key: "", raw: "" }])}>
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            placeholder={keyPlaceholder}
            aria-label={`${title} name ${i + 1}`}
            value={row.key}
            onChange={(e) => commit(rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))}
          />
          <Input
            className="w-20 shrink-0"
            placeholder="+0"
            inputMode="decimal"
            aria-label={`${title} bonus ${i + 1}`}
            value={row.raw}
            onChange={(e) => commit(rows.map((r, idx) => (idx === i ? { ...r, raw: e.target.value } : r)))}
          />
          <IconButton label="Remove" onClick={() => commit(rows.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
      {rows.some((r) => !r.key.trim() || !parseNumber(r.raw, false).ok) && (
        <p className="text-xs text-muted-foreground">A row with no name, or a number never entered, is not saved. A number you clear keeps its last value.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

interface TabProps {
  value: Sheet;
  set: (patch: Partial<Sheet>) => void;
  setSb: (patch: Partial<StatBlockFields>) => void;
  /** Free-text speed: keeps top-level `speed` and `statBlock.speed` in step in one update. */
  setSpeed: (text: string) => void;
  /** Replaces the whole sheet in one update, for edits that touch several fields. */
  replace: (next: Sheet) => void;
  hideLibraryFields?: boolean;
}

function IdentityTab({ value, set, hideLibraryFields }: TabProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" />
        </Field>
        <Field label="Type">
          <select
            className="flex h-9 w-full rounded-md border border-border bg-muted px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={value.type}
            onChange={(e) => set({ type: e.target.value as Sheet["type"] })}
          >
            <option value="monster">Monster</option>
            <option value="npc">NPC</option>
            <option value="pc">Player character</option>
          </select>
        </Field>
        {!hideLibraryFields && (
        <Field label="Tags">
          <DraftInput<string[] | undefined>
            placeholder="undead, boss"
            value={value.tags}
            format={(v) => (v ?? []).join(", ")}
            parse={(t) => {
              const tags = t.split(",").map((s) => s.trim()).filter(Boolean);
              return { ok: true, value: tags.length > 0 ? tags : undefined };
            }}
            onCommit={(tags) => set({ tags })}
          />
        </Field>
        )}
        <Field label="Player name">
          <TextField value={value.playerName} onCommit={(playerName) => set({ playerName })} placeholder="Player name" />
        </Field>
        <Field label="Colour">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick colour"
              className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-muted p-1"
              value={/^#[0-9a-fA-F]{6}$/.test(value.color ?? "") ? value.color : "#888888"}
              onChange={(e) => set({ color: e.target.value })}
            />
            <TextField value={value.color} onCommit={(color) => set({ color })} placeholder="#c0392b" />
          </div>
        </Field>
      </div>
      {!hideLibraryFields && (
      <Field label="Notes">
        <TextArea
          rows={8}
          value={value.notes}
          onCommit={(notes) => set({ notes })}
          placeholder="Tactics, voice, how it fights. Shown on the sheet, not in the stat block."
        />
      </Field>
      )}
    </div>
  );
}

function StatsTab({ value, set, setSb, setSpeed }: TabProps) {
  const sb = value.statBlock;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="AC">
          <RequiredNumField value={value.ac} onCommit={(ac) => set({ ac })} />
        </Field>
        <Field label="Max HP">
          <RequiredNumField value={value.hpMax} onCommit={(hpMax) => set({ hpMax })} />
        </Field>
        <Field label="Hit dice">
          <TextField value={sb?.hitDice} onCommit={(hitDice) => setSb({ hitDice })} placeholder="12d8+24" />
        </Field>
        <Field label="Init. bonus">
          <NumField value={value.initiativeBonus} onCommit={(initiativeBonus) => set({ initiativeBonus })} />
        </Field>
        <Field label="Speed" className="col-span-2">
          <DraftInput<string>
            placeholder="30 ft."
            syncExternal={false}
            value={sb?.speed ?? (value.speed !== undefined ? `${value.speed} ft.` : "")}
            format={(v) => v}
            parse={(t) => ({ ok: true, value: t })}
            onCommit={setSpeed}
          />
        </Field>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {ABILITIES.map((ab) => (
          <Field key={ab} label={ab.toUpperCase()} className="text-center">
            <NumField
              className="px-1 text-center"
              value={sb?.[ab]}
              onCommit={(n) => setSb({ [ab]: n })}
              aria-label={ab.toUpperCase()}
            />
          </Field>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RecordEditor title="Saving throws" keyPlaceholder="STR" value={sb?.savingThrows} onChange={(savingThrows) => setSb({ savingThrows })} />
        <RecordEditor title="Skills" keyPlaceholder="Perception" value={sb?.skills} onChange={(skills) => setSb({ skills })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Senses">
          <TextField value={sb?.senses} onCommit={(senses) => setSb({ senses })} placeholder="darkvision 60 ft., passive Perception 15" />
        </Field>
        <Field label="Languages">
          <TextField value={sb?.languages} onCommit={(languages) => setSb({ languages })} placeholder="Common, Elvish" />
        </Field>
        <Field label="Damage resistances">
          <TextField value={sb?.damageResistances} onCommit={(damageResistances) => setSb({ damageResistances })} />
        </Field>
        <Field label="Damage immunities">
          <TextField value={sb?.damageImmunities} onCommit={(damageImmunities) => setSb({ damageImmunities })} />
        </Field>
        <Field label="Damage vulnerabilities">
          <TextField value={sb?.damageVulnerabilities} onCommit={(damageVulnerabilities) => setSb({ damageVulnerabilities })} />
        </Field>
        <Field label="Condition immunities">
          <TextField value={sb?.conditionImmunities} onCommit={(conditionImmunities) => setSb({ conditionImmunities })} />
        </Field>
        <Field label="CR">
          <TextField value={sb?.cr} onCommit={(cr) => setSb({ cr })} placeholder="7" />
        </Field>
        <Field label="XP">
          <NumField value={sb?.xp} onCommit={(xp) => setSb({ xp })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Field label="Size">
          <TextField value={sb?.size} onCommit={(size) => setSb({ size })} placeholder="Medium" />
        </Field>
        <Field label="Creature type">
          <TextField value={sb?.type} onCommit={(type) => setSb({ type })} placeholder="humanoid" />
        </Field>
        <Field label="Subtype">
          <TextField value={sb?.subtype} onCommit={(subtype) => setSb({ subtype })} placeholder="elf" />
        </Field>
        <Field label="Alignment">
          <TextField value={sb?.alignment} onCommit={(alignment) => setSb({ alignment })} />
        </Field>
        <Field label="AC note">
          <TextField value={sb?.acNote} onCommit={(acNote) => setSb({ acNote })} placeholder="plate armor" />
        </Field>
      </div>
    </div>
  );
}

function ActionsTab({ value, setSb }: TabProps) {
  const sb = value.statBlock;
  return (
    <div className="space-y-5">
      {LISTS.map(({ key, label, addLabel }) => (
        <NamedEntryList
          key={key}
          title={label}
          addLabel={addLabel}
          entries={sb?.[key] ?? []}
          onChange={(next) => setSb({ [key]: next.length > 0 ? next : undefined })}
        />
      ))}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Spellcasting</h3>
        <TextArea
          rows={6}
          aria-label="Spellcasting"
          value={sb?.spellcasting}
          onCommit={(spellcasting) => setSb({ spellcasting })}
          placeholder="Spellcasting ability, save DC, and spell lists, as free text."
        />
      </section>
    </div>
  );
}

function PortraitTab({
  value,
  replace,
  entryId,
  imagePath,
  imageVersion,
  busy,
  error,
  onUpload,
  onRemove,
}: TabProps & {
  entryId: string | null;
  imagePath: string | null;
  imageVersion: number;
  busy: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const remote = value.statBlock?.imageUrl ?? value.avatarUrl;
  const base = entryId ? portraitUrl({ id: entryId, imagePath, data: value }) : (remote ?? null);
  // The upload endpoint serves no-store, but the URL is stable, so bust the img cache on replace.
  const preview = base && imagePath && entryId ? `${base}?v=${imageVersion}` : base;

  const setRemote = (url: string | undefined) => {
    // One onChange: two calls built from the same `value` would overwrite each other.
    const next: Sheet = { ...value };
    if (url === undefined) delete next.avatarUrl;
    else next.avatarUrl = url;
    // portraitUrl reads statBlock.imageUrl first; keep it in step if the sheet already has one.
    if (value.statBlock?.imageUrl !== undefined) {
      const sb = { ...value.statBlock };
      if (url === undefined) delete sb.imageUrl;
      else sb.imageUrl = url;
      next.statBlock = sb;
    }
    replace(next);
  };


  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-xs text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : "No portrait"}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <label
              className={cn(
                "inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors",
                entryId && !busy ? "cursor-pointer hover:bg-accent" : "cursor-not-allowed opacity-50"
              )}
            >
              {imagePath ? "Replace image" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={!entryId || busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onUpload(file);
                }}
              />
            </label>
            {imagePath && (
              <Button type="button" variant="outline" disabled={busy} onClick={onRemove}>
                Remove upload
              </Button>
            )}
          </div>
          {!entryId && (
            <p className="text-xs text-muted-foreground">
              Uploads attach to a library entry, and this sheet has not been saved to the library yet. Save it first,
              then reopen it to upload an image. A remote image URL works now.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <Field label="Remote image URL">
        <TextField value={remote} onCommit={setRemote} placeholder="https://..." />
      </Field>
      <p className="text-xs text-muted-foreground">An uploaded image takes priority over the remote URL.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function StatSheetEditor({
  value,
  entryId,
  imagePath: imagePathProp = null,
  onChange,
  onSave,
  onCancel,
  saving = false,
  onPortraitChanged,
  hideLibraryFields,
  className,
}: StatSheetEditorProps) {
  const [attempted, setAttempted] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(imagePathProp);
  const [imageVersion, setImageVersion] = useState(0);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [portraitError, setPortraitError] = useState<string | null>(null);

  const validation = validateCharacterUpload(value);

  const set = (patch: Partial<Sheet>) => {
    const next: Sheet = { ...value, ...patch };
    // Clearing an optional field removes the key instead of leaving undefined behind.
    for (const k of Object.keys(patch) as (keyof Sheet)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };

  // A sheet may have no statBlock at all; the first stat or action write creates it, and it is never removed.
  const setSb = (patch: Partial<StatBlockFields>) => {
    const sb: StatBlockFields = { ...(value.statBlock ?? {}), ...patch };
    for (const k of Object.keys(patch) as (keyof StatBlockFields)[]) if (sb[k] === undefined) delete sb[k];
    onChange({ ...value, statBlock: sb });
  };

  const setSpeed = (text: string) => onChange(applySpeedText(value, text));

  const handleSave = () => {
    setAttempted(true);
    if (!validation.valid) return;
    void onSave(value);
  };

  const upload = async (file: File) => {
    if (!entryId) return;
    setPortraitBusy(true);
    setPortraitError(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch(`/api/library/${entryId}/image`, { method: "POST", body });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Upload failed");
      const { imagePath: next } = (await res.json()) as { imagePath: string };
      setImagePath(next);
      setImageVersion((v) => v + 1);
      onPortraitChanged?.(next);
    } catch (err) {
      setPortraitError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPortraitBusy(false);
    }
  };

  const removeUpload = async () => {
    if (!entryId) return;
    setPortraitBusy(true);
    setPortraitError(null);
    try {
      const res = await fetch(`/api/library/${entryId}/image`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove the image");
      setImagePath(null);
      onPortraitChanged?.(null);
    } catch (err) {
      setPortraitError(err instanceof Error ? err.message : "Could not remove the image");
    } finally {
      setPortraitBusy(false);
    }
  };

  const tabProps: TabProps = { value, set, setSb, setSpeed, replace: onChange, hideLibraryFields };
  const shownErrors = attempted ? validation.errors : [];

  return (
    <Tabs defaultValue="stats" className={cn("flex min-h-0 flex-col gap-3", className)}>
      {(shownErrors.length > 0 || validation.warnings.length > 0) && (
        <div className="max-h-28 shrink-0 space-y-1.5 overflow-y-auto text-xs">
          {shownErrors.length > 0 && (
            <ul role="alert" className="list-disc rounded-md border border-destructive/50 bg-destructive/10 py-2 pl-6 pr-3 text-destructive">
              {shownErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {validation.warnings.length > 0 && (
            <ul className="list-disc rounded-md border border-warning/50 bg-warning/10 py-2 pl-6 pr-3 text-warning">
              {validation.warnings.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <TabsList>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="portrait">Portrait</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <TabsContent value="identity">
          <IdentityTab {...tabProps} />
        </TabsContent>
        <TabsContent value="stats">
          <StatsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="portrait">
          <PortraitTab
            {...tabProps}
            entryId={entryId}
            imagePath={imagePath}
            imageVersion={imageVersion}
            busy={portraitBusy}
            error={portraitError}
            onUpload={upload}
            onRemove={removeUpload}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
