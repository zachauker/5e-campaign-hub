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

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const target = params.get("target");
  if (!target) return NextResponse.json({ error: "target required" }, { status: 400 });

  let width: number | null;
  try {
    width = parseWidth(params.get("w"));
  } catch (err) {
    if (err instanceof AttachmentWidthError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  let found;
  try {
    found = locateAttachment(vaultRoot(), target);
  } catch (err) {
    if (err instanceof AttachmentPathError) {
      console.warn(`[vault] attachment refused for target "${target}": ${err.message}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      console.warn(`[vault] could not resize attachment "${target}": ${err instanceof Error ? err.message : err}`);
      return NextResponse.json({ error: "Unreadable image" }, { status: 422 });
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
