// Notion data-source query returns each row's properties keyed by property name.
// These readers accept the raw property object (or undefined if absent) and are
// tolerant of missing/renamed properties — a renamed property just reads as empty.
type Prop = Record<string, unknown> | undefined;

function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

export function readTitle(p: Prop): string {
  return arr(p?.["title"]).map((t) => String(t.plain_text ?? "")).join("").trim();
}

export function readText(p: Prop): string {
  return arr(p?.["rich_text"]).map((t) => String(t.plain_text ?? "")).join("").trim();
}

export function readSelect(p: Prop): string | null {
  const sel = p?.["select"] as { name?: string } | null | undefined;
  return sel?.name ?? null;
}

export function readMultiSelect(p: Prop): string[] {
  return arr(p?.["multi_select"]).map((o) => String(o.name ?? "")).filter(Boolean);
}

export function readCheckbox(p: Prop): boolean {
  return p?.["checkbox"] === true;
}

export function readNumber(p: Prop): number | null {
  const n = p?.["number"];
  return typeof n === "number" ? n : null;
}

export function readUrl(p: Prop): string | null {
  const u = p?.["url"];
  return typeof u === "string" && u.length > 0 ? u : null;
}

export function readRelationIds(p: Prop): string[] {
  return arr(p?.["relation"]).map((r) => String(r.id ?? "").replace(/-/g, "")).filter(Boolean);
}

export function extractDdbId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/dndbeyond\.com\/(?:profile\/[^/]+\/)?characters\/(\d+)/i);
  return m ? m[1] : null;
}
