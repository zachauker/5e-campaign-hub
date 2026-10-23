import fs from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { vaultRoot } from "@/lib/vault/config";
import {
  AttachmentPathError,
  AttachmentWidthError,
  locateAttachment,
  parseWidth,
  renderResized,
} from "@/lib/vault/attachments";

const HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  // An SVG opened directly is a same-origin document; this stops it running script.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

// Error bodies are JSON, but still get nosniff; they are never cached as immutable.
const ERROR_HEADERS = { "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: ERROR_HEADERS });
const notFound = () => fail("Not found", 404);

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const target = params.get("target");
  if (!target) return fail("target required", 400);

  let width: number | null;
  try {
    width = parseWidth(params.get("w"));
  } catch (err) {
    if (err instanceof AttachmentWidthError) return fail(err.message, 400);
    throw err;
  }

  let found;
  try {
    found = locateAttachment(vaultRoot(), target);
  } catch (err) {
    if (err instanceof AttachmentPathError) {
      // target is attacker-controlled: quote and truncate so it cannot forge log lines.
      console.warn(`[vault] attachment refused for target ${JSON.stringify(target.slice(0, 120))}: ${err.message}`);
      return fail("Forbidden", 403);
    }
    throw err;
  }
  if (!found) return notFound();

  // SVG is served untouched: rasterising a vector defeats its purpose, and
  // sharp's SVG path is a different (and larger) attack surface.
  if (width !== null && found.contentType !== "image/svg+xml") {
    try {
      const buffer = await renderResized(found.path, width);
      return new NextResponse(new Uint8Array(buffer), {
        headers: { ...HEADERS, "Content-Type": found.contentType, "Content-Length": String(buffer.length) },
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return notFound();
      console.warn(
        `[vault] could not resize attachment ${JSON.stringify(target.slice(0, 120))}: ${err instanceof Error ? err.message : err}`,
      );
      return fail("Unreadable image", 422);
    }
  }

  try {
    const handle = await fs.promises.open(found.path, "r");
    const { size } = await handle.stat();
    const body = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
    return new NextResponse(body, {
      headers: { ...HEADERS, "Content-Type": found.contentType, "Content-Length": String(size) },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return notFound();
    throw err;
  }
}
