import { createHash } from "crypto";
import type { NotionBlockData } from "@/lib/notion/client";

/** Flatten Notion blocks into the plain text the review pass reads and cites against. */
export function blocksToPlainText(blocks: NotionBlockData[]): string {
  return blocks
    .map((b) => (b.richText ?? []).map((r) => r.text).join(""))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/** Stable content watermark. Trimmed so trailing-newline churn does not invalidate a review. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}
