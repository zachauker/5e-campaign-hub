import {
  Anchor, BookMarked, BookOpen, Bug, ClipboardList, CircleCheck, CircleHelp, Coins, Dices, Eye, EyeOff,
  FileText, Footprints, GitFork, Info, Lightbulb, Link2, ListTodo, Map as MapIcon, MapPin, MessageCircle,
  OctagonAlert, Quote, ScrollText, Skull, Sparkles, Star, StickyNote, Swords, Target,
  TriangleAlert, User, Workflow, type LucideIcon,
} from "lucide-react";

export interface CalloutStyle {
  icon: LucideIcon;
  /** Border, background and text classes for the callout box. */
  box: string;
  /** Colour of the icon and title. */
  accent: string;
}

// Full class strings, never assembled from fragments: Tailwind finds classes by
// scanning source text, so `border-${hue}-500` would generate nothing.
const TONE = {
  amber: { box: "border-amber-500/40 bg-amber-500/10", accent: "text-amber-600 dark:text-amber-400" },
  red: { box: "border-red-500/40 bg-red-500/10", accent: "text-red-600 dark:text-red-400" },
  rose: { box: "border-rose-500/40 bg-rose-500/10", accent: "text-rose-600 dark:text-rose-400" },
  violet: { box: "border-violet-500/40 bg-violet-500/10", accent: "text-violet-600 dark:text-violet-400" },
  emerald: { box: "border-emerald-500/40 bg-emerald-500/10", accent: "text-emerald-600 dark:text-emerald-400" },
  teal: { box: "border-teal-500/40 bg-teal-500/10", accent: "text-teal-600 dark:text-teal-400" },
  orange: { box: "border-orange-500/40 bg-orange-500/10", accent: "text-orange-600 dark:text-orange-400" },
  cyan: { box: "border-cyan-500/40 bg-cyan-500/10", accent: "text-cyan-600 dark:text-cyan-400" },
  sky: { box: "border-sky-500/40 bg-sky-500/10", accent: "text-sky-600 dark:text-sky-400" },
  slate: { box: "border-slate-500/40 bg-slate-500/10", accent: "text-slate-600 dark:text-slate-400" },
  lime: { box: "border-lime-500/40 bg-lime-500/10", accent: "text-lime-600 dark:text-lime-400" },
  indigo: { box: "border-indigo-500/40 bg-indigo-500/10", accent: "text-indigo-600 dark:text-indigo-400" },
  purple: { box: "border-purple-500/40 bg-purple-500/10", accent: "text-purple-600 dark:text-purple-400" },
  fuchsia: { box: "border-fuchsia-500/40 bg-fuchsia-500/10", accent: "text-fuchsia-600 dark:text-fuchsia-400" },
  green: { box: "border-green-500/40 bg-green-500/10", accent: "text-green-600 dark:text-green-400" },
  blue: { box: "border-blue-500/40 bg-blue-500/10", accent: "text-blue-600 dark:text-blue-400" },
  yellow: { box: "border-yellow-500/40 bg-yellow-500/10", accent: "text-yellow-600 dark:text-yellow-400" },
  // The pre-vault callout look, kept for plain notes and unknown types.
  plain: { box: "border-border bg-muted", accent: "text-muted-foreground" },
} as const;

type Tone = keyof typeof TONE;
const style = (icon: LucideIcon, tone: Tone): CalloutStyle => ({ icon, ...TONE[tone] });

/** What a callout renders as when its type is not in the table. */
export const DEFAULT_CALLOUT_STYLE: CalloutStyle = style(StickyNote, "plain");

/**
 * Callout type (lowercased, as `MdBlock.calloutType` carries it) -> look.
 * Grouped as the vault's own style guide groups them, so related types read as
 * a family: player-facing, DM-only, NPC and place, mechanics, world, prep
 * workflow, then Obsidian's built-ins.
 */
const CALLOUT_STYLES: Record<string, CalloutStyle> = {
  // Player-facing boxed text
  "read-aloud": style(ScrollText, "amber"),
  abstract: style(FileText, "amber"),
  // DM-only
  dm: style(EyeOff, "rose"),
  // NPCs and places
  npc: style(User, "violet"),
  location: style(MapPin, "emerald"),
  describe: style(Eye, "teal"),
  // Mechanics
  combat: style(Swords, "red"),
  social: style(MessageCircle, "cyan"),
  check: style(Dices, "orange"),
  rules: style(BookMarked, "slate"),
  statblock: style(Skull, "red"),
  minis: style(Footprints, "lime"),
  // World
  lore: style(BookOpen, "indigo"),
  vision: style(Sparkles, "purple"),
  hook: style(Anchor, "fuchsia"),
  map: style(MapIcon, "sky"),
  // Prep workflow
  todo: style(ListTodo, "slate"),
  decision: style(GitFork, "orange"),
  goal: style(Target, "green"),
  dependency: style(Link2, "slate"),
  flow: style(Workflow, "cyan"),
  spotlight: style(Star, "yellow"),
  owed: style(Coins, "amber"),
  // Obsidian built-ins (and their common aliases)
  info: style(Info, "blue"),
  note: style(StickyNote, "plain"),
  tip: style(Lightbulb, "teal"),
  hint: style(Lightbulb, "teal"),
  important: style(Lightbulb, "teal"),
  warning: style(TriangleAlert, "amber"),
  caution: style(TriangleAlert, "amber"),
  attention: style(TriangleAlert, "amber"),
  success: style(CircleCheck, "green"),
  done: style(CircleCheck, "green"),
  question: style(CircleHelp, "yellow"),
  help: style(CircleHelp, "yellow"),
  faq: style(CircleHelp, "yellow"),
  failure: style(OctagonAlert, "red"),
  fail: style(OctagonAlert, "red"),
  missing: style(OctagonAlert, "red"),
  danger: style(OctagonAlert, "red"),
  error: style(OctagonAlert, "red"),
  bug: style(Bug, "red"),
  example: style(ClipboardList, "purple"),
  quote: style(Quote, "slate"),
  cite: style(Quote, "slate"),
  summary: style(FileText, "amber"),
  tldr: style(FileText, "amber"),
};

/**
 * The look for a callout type. An unknown type still gets a callout (the DM adds
 * types faster than the hub learns them), in the neutral default. `hasOwn`, not
 * a bare index: a hand-typed `[!constructor]` must not resolve through
 * `Object.prototype`.
 */
export function calloutStyle(type: string | undefined): CalloutStyle {
  const key = (type ?? "").toLowerCase();
  return Object.hasOwn(CALLOUT_STYLES, key) ? CALLOUT_STYLES[key] : DEFAULT_CALLOUT_STYLE;
}

/** The types with a dedicated look, for tests. */
export const KNOWN_CALLOUT_TYPES: readonly string[] = Object.keys(CALLOUT_STYLES);

/** Types whose conventional spelling is not "first letter capitalised". */
const ACRONYMS: Record<string, string> = { dm: "DM", npc: "NPC", tldr: "TL;DR", faq: "FAQ" };

/**
 * The header shown when a callout has no title of its own, as Obsidian does:
 * the type, humanised (`read-aloud` -> "Read aloud", `dm` -> "DM").
 */
export function calloutLabel(type: string | undefined): string {
  const key = (type ?? "").toLowerCase();
  if (key === "") return "Note";
  if (Object.hasOwn(ACRONYMS, key)) return ACRONYMS[key];
  const spaced = key.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
