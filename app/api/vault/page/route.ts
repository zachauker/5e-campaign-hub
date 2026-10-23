import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AttachmentPathError } from "@/lib/vault/attachments";
import { vaultRoot } from "@/lib/vault/config";
import { FrontmatterError } from "@/lib/vault/frontmatter";
import { readVaultPage, VaultNoteNotFoundError } from "@/lib/vault/page";
import { VaultPathError } from "@/lib/vault/paths";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  const sourcePath = new URL(req.url).searchParams.get("path");
  if (!sourcePath) return fail("path required", 400);

  try {
    // `db` is a lazy proxy typed with the full schema; readVaultPage takes the
    // schema-less shape, as resolveEmbed does.
    return NextResponse.json(readVaultPage(db as never, vaultRoot(), sourcePath));
  } catch (err) {
    if (err instanceof VaultPathError) return fail(err.message, 400);
    if (err instanceof VaultNoteNotFoundError) return fail("Note not found", 404);
    if (err instanceof AttachmentPathError) {
      // sourcePath is client-supplied: quote and truncate so it cannot forge log lines.
      console.warn(`[vault] page refused for path ${JSON.stringify(sourcePath.slice(0, 120))}: ${err.message}`);
      return fail("Forbidden", 403);
    }
    if (err instanceof FrontmatterError) return fail(err.message, 422);
    throw err;
  }
}
