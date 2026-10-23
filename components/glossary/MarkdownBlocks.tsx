"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { MdBlock, MdInline } from "@/lib/vault/markdown";
import type { EmbedResult } from "@/lib/vault/embeds";
import { attachmentUrl, embedItemHref, safeExternalHref } from "@/lib/vault/paths";
import { calloutLabel, calloutStyle } from "@/components/glossary/callout-styles";

/** Width requested for an inline image: wide enough for a hi-dpi panel, well under the 2048 cap. */
const IMAGE_WIDTH = 1280;

function Inlines({ segments }: { segments: MdInline[] }) {
  return (
    <>
      {segments.map((s, i) => {
        let content: React.ReactNode = s.text;
        if (s.code) content = <code className="bg-muted px-1 rounded text-xs">{content}</code>;
        if (s.bold) content = <strong>{content}</strong>;
        if (s.italic) content = <em>{content}</em>;
        if (s.strike) content = <s className="text-muted-foreground">{content}</s>;
        const href = safeExternalHref(s.href);
        if (href) {
          content = (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
              {content}
            </a>
          );
        } else if (s.link) {
          // A [[wikilink]]. Resolving it to a hub page is not done here; it
          // reads as a link without pointing anywhere it cannot go.
          content = (
            <span className="text-primary underline decoration-dotted underline-offset-2" title={s.link.target}>
              {content}
            </span>
          );
        }
        return <React.Fragment key={i}>{content}</React.Fragment>;
      })}
    </>
  );
}

/** A fenced code block arrives as a paragraph holding one multi-line code run. */
function isCodeBlock(inlines: MdInline[]): boolean {
  return inlines.length === 1 && Boolean(inlines[0].code) && inlines[0].text.includes("\n");
}

function Table({ rows }: { rows: MdInline[][][] }) {
  // GFM guarantees a header row, so row 0 is the header by construction.
  const [header, ...body] = rows;
  if (!header) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {header.map((cell, c) => (
              <th key={c} className="border-b border-border px-2 py-1 text-left font-semibold">
                <Inlines segments={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border-b border-border/50 px-2 py-1 align-top">
                  <Inlines segments={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Embed({ result }: { result: EmbedResult }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{result.title}</p>
      {result.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {result.items.map((it) => (
            <Link
              key={`${it.kind}:${it.id}`}
              href={embedItemHref(it.kind, it.id)}
              className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40"
            >
              {it.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Callout({ block, embeds }: { block: MdBlock; embeds: Record<string, EmbedResult> }) {
  const look = calloutStyle(block.calloutType);
  const Icon = look.icon;
  const header = (
    <span className={cn("flex items-center gap-2 font-medium", look.accent)}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {block.calloutTitle || calloutLabel(block.calloutType)}
    </span>
  );
  const body = block.children && block.children.length > 0 && (
    <div className="mt-2 space-y-2">
      <Blocks blocks={block.children} embeds={embeds} />
    </div>
  );

  // A collapsed callout (`[!dm]-`) stays collapsed: the DM folded it on purpose.
  if (block.collapsed) {
    return (
      <details className={cn("rounded-lg border p-3", look.box)}>
        <summary className="cursor-pointer">{header}</summary>
        {body}
      </details>
    );
  }
  return (
    <div className={cn("rounded-lg border p-3", look.box)}>
      {header}
      {body}
    </div>
  );
}

function ListItem({ block, embeds }: { block: MdBlock; embeds: Record<string, EmbedResult> }) {
  const text = block.inlines && <Inlines segments={block.inlines} />;
  const nested = block.children && block.children.length > 0 && (
    <div className="mt-1 space-y-1">
      <Blocks blocks={block.children} embeds={embeds} />
    </div>
  );
  if (block.checked !== undefined) {
    return (
      <li className="list-none -ml-4">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={block.checked} disabled />
          <span className={cn(block.checked && "line-through text-muted-foreground")}>{text}</span>
        </div>
        {nested}
      </li>
    );
  }
  return (
    <li>
      {text}
      {nested}
    </li>
  );
}

function Blocks({ blocks, embeds }: { blocks: MdBlock[]; embeds: Record<string, EmbedResult> }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (b.type === "list_item") {
      // Consecutive items of one kind form one list, so <ol> can number them.
      const run: MdBlock[] = [b];
      while (i + 1 < blocks.length && blocks[i + 1].type === "list_item" && Boolean(blocks[i + 1].ordered) === Boolean(b.ordered)) {
        run.push(blocks[++i]);
      }
      const items = run.map((item) => <ListItem key={item.id} block={item} embeds={embeds} />);
      out.push(
        b.ordered ? (
          <ol key={b.id} className="ml-4 list-decimal space-y-1">{items}</ol>
        ) : (
          <ul key={b.id} className="ml-4 list-disc space-y-1">{items}</ul>
        ),
      );
      continue;
    }

    switch (b.type) {
      case "paragraph":
        if (!b.inlines || b.inlines.length === 0) break;
        out.push(
          isCodeBlock(b.inlines) ? (
            <pre key={b.id} className="overflow-x-auto rounded bg-muted p-2 text-xs">
              <code>{b.inlines[0].text}</code>
            </pre>
          ) : (
            // pre-line: Obsidian shows a single newline as a line break.
            <p key={b.id} className="whitespace-pre-line">
              <Inlines segments={b.inlines} />
            </p>
          ),
        );
        break;
      case "heading": {
        const depth = Math.min(Math.max(b.depth ?? 1, 1), 6);
        const Tag = `h${Math.min(depth + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6";
        const size = depth === 1 ? "text-lg pt-2" : depth === 2 ? "text-base pt-2" : "text-sm pt-1";
        out.push(
          <Tag key={b.id} className={cn("font-bold", size)}>
            {b.inlines && <Inlines segments={b.inlines} />}
          </Tag>,
        );
        break;
      }
      case "quote":
        out.push(
          <blockquote key={b.id} className="space-y-2 border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
            {b.children && <Blocks blocks={b.children} embeds={embeds} />}
          </blockquote>,
        );
        break;
      case "callout":
        out.push(<Callout key={b.id} block={b} embeds={embeds} />);
        break;
      case "divider":
        out.push(<hr key={b.id} className="border-border" />);
        break;
      case "image":
        if (!b.imageTarget) break;
        out.push(
          // eslint-disable-next-line @next/next/no-img-element -- served and resized by /api/vault/attachment, not a static asset
          <img
            key={b.id}
            src={attachmentUrl(b.imageTarget, IMAGE_WIDTH)}
            alt={b.imageTarget}
            loading="lazy"
            className="max-w-full rounded-lg border border-border"
          />,
        );
        break;
      case "table":
        if (b.rows) out.push(<Table key={b.id} rows={b.rows} />);
        break;
      case "embed": {
        // Only a view the hub can answer has an entry; every other embed draws nothing.
        const result = Object.hasOwn(embeds, b.id) ? embeds[b.id] : undefined;
        if (result) out.push(<Embed key={b.id} result={result} />);
        break;
      }
      case "unsupported":
      default:
        break;
    }
  }
  return <>{out}</>;
}

export function MarkdownBlocks({
  blocks,
  embeds = {},
}: {
  blocks: MdBlock[];
  /** Resolved relation embeds, keyed by block id (from `/api/vault/page`). */
  embeds?: Record<string, EmbedResult>;
}) {
  return (
    <div className="space-y-3 text-sm">
      <Blocks blocks={blocks} embeds={embeds} />
    </div>
  );
}
