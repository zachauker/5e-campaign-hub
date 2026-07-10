import { Client } from "@notionhq/client";

const NOTION_ID_PATTERN = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

export function extractNotionPageId(url: string): string | null {
  const match = url.match(NOTION_ID_PATTERN);
  if (!match) return null;
  return match[1].replace(/-/g, "");
}

// Database and page ids share the same 32-hex shape; reuse the existing pattern.
export function extractNotionDatabaseId(url: string): string | null {
  return extractNotionPageId(url);
}

export interface NotionRow {
  id: string;
  url: string;
  properties: Record<string, unknown>;
}

// v5 API (2025-09-03): a database has one or more data sources. Resolve the
// pasted database URL to its first data source id, then query that.
export async function resolveDataSourceId(databaseId: string, token: string): Promise<string> {
  const notion = new Client({ auth: token });
  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources?: Array<{ id: string }>;
  };
  const first = db.data_sources?.[0]?.id;
  if (!first) throw new Error("That database has no data source");
  return first;
}

export async function queryDataSource(dataSourceId: string, token: string): Promise<NotionRow[]> {
  const notion = new Client({ auth: token });
  const rows: NotionRow[] = [];
  let cursor: string | undefined;

  do {
    const res = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    })) as unknown as {
      results: Array<{ id: string; url: string; properties: Record<string, unknown> }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    for (const p of res.results) {
      rows.push({ id: p.id, url: p.url, properties: p.properties });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return rows;
}

export interface NotionRichText {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string | null;
}

export interface NotionBlockData {
  id: string;
  type: string;
  richText?: NotionRichText[];
  checked?: boolean;
  imageUrl?: string;
  notionUrl?: string;
}

const SUPPORTED_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "to_do",
  "callout",
  "divider",
  "image",
]);

function mapRichText(
  richText: Array<{
    plain_text: string;
    annotations: { bold: boolean; italic: boolean; code: boolean };
    href: string | null;
  }>
): NotionRichText[] {
  return richText.map((t) => ({
    text: t.plain_text,
    bold: t.annotations.bold,
    italic: t.annotations.italic,
    code: t.annotations.code,
    href: t.href,
  }));
}

// The Notion SDK's block-children response is a union of partial/full block
// objects that's awkward to narrow generically across ~30 block types, so
// this reads the per-type payload dynamically (`block[block.type]`) rather
// than switching on every type's exact shape — matching this codebase's
// existing pragmatic approach to third-party JSON (see lib/ddb/client.ts).
export async function fetchNotionPageBlocks(pageId: string, token: string): Promise<NotionBlockData[]> {
  const notion = new Client({ auth: token });
  const blocks: NotionBlockData[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const raw of res.results) {
      const block = raw as unknown as Record<string, unknown> & { id: string; type: string };
      if (!SUPPORTED_TYPES.has(block.type)) {
        blocks.push({
          id: block.id,
          type: block.type,
          notionUrl: `https://www.notion.so/${pageId}#${block.id.replace(/-/g, "")}`,
        });
        continue;
      }

      const data = block[block.type] as Record<string, unknown>;
      blocks.push({
        id: block.id,
        type: block.type,
        richText: Array.isArray(data.rich_text)
          ? mapRichText(data.rich_text as Parameters<typeof mapRichText>[0])
          : undefined,
        checked: block.type === "to_do" ? Boolean(data.checked) : undefined,
        imageUrl:
          block.type === "image"
            ? ((data.type === "external"
                ? (data.external as { url: string }).url
                : (data.file as { url: string }).url) ?? undefined)
            : undefined,
      });
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}
