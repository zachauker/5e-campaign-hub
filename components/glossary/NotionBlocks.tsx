"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { NotionBlockData, NotionRichText } from "@/lib/notion/client";

function RichText({ segments }: { segments: NotionRichText[] }) {
  return (
    <>
      {segments.map((s, i) => {
        let content: React.ReactNode = s.text;
        if (s.code) content = <code className="bg-muted px-1 rounded text-xs">{content}</code>;
        if (s.bold) content = <strong>{content}</strong>;
        if (s.italic) content = <em>{content}</em>;
        if (s.href) {
          content = (
            <a href={s.href} target="_blank" rel="noreferrer" className="text-primary underline">
              {content}
            </a>
          );
        }
        return <React.Fragment key={i}>{content}</React.Fragment>;
      })}
    </>
  );
}

export function NotionBlocks({ blocks }: { blocks: NotionBlockData[] }) {
  return (
    <div className="space-y-3 text-sm">
      {blocks.map((b) => {
        switch (b.type) {
          case "paragraph":
            return b.richText && b.richText.length > 0 ? (
              <p key={b.id}>
                <RichText segments={b.richText} />
              </p>
            ) : null;
          case "heading_1":
            return (
              <h2 key={b.id} className="text-lg font-bold pt-2">
                {b.richText && <RichText segments={b.richText} />}
              </h2>
            );
          case "heading_2":
            return (
              <h3 key={b.id} className="text-base font-bold pt-2">
                {b.richText && <RichText segments={b.richText} />}
              </h3>
            );
          case "heading_3":
            return (
              <h4 key={b.id} className="text-sm font-bold pt-1">
                {b.richText && <RichText segments={b.richText} />}
              </h4>
            );
          case "bulleted_list_item":
            return (
              <li key={b.id} className="ml-4 list-disc">
                {b.richText && <RichText segments={b.richText} />}
              </li>
            );
          case "numbered_list_item":
            return (
              <li key={b.id} className="ml-4 list-decimal">
                {b.richText && <RichText segments={b.richText} />}
              </li>
            );
          case "quote":
            return (
              <blockquote key={b.id} className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
                {b.richText && <RichText segments={b.richText} />}
              </blockquote>
            );
          case "to_do":
            return (
              <div key={b.id} className="flex items-center gap-2">
                <input type="checkbox" checked={b.checked} disabled />
                <span className={cn(b.checked && "line-through text-muted-foreground")}>
                  {b.richText && <RichText segments={b.richText} />}
                </span>
              </div>
            );
          case "callout":
            return (
              <div key={b.id} className="flex items-start gap-2 rounded-lg bg-muted border border-border p-3">
                <div>{b.richText && <RichText segments={b.richText} />}</div>
              </div>
            );
          case "divider":
            return <hr key={b.id} className="border-border" />;
          case "image":
            return b.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Notion-hosted URL, not a local asset
              <img key={b.id} src={b.imageUrl} alt="" className="rounded-lg border border-border max-w-full" />
            ) : null;
          default:
            return null;
        }
      })}
    </div>
  );
}
