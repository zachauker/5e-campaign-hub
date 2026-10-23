import { createHash } from "crypto";

/** Stable content watermark. Trimmed so trailing-newline churn does not invalidate a review. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}
