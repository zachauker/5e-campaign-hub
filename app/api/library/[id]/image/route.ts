import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterLibrary } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  saveLibraryImage,
  readLibraryImage,
  deleteLibraryImage,
  libraryImageContentType,
} from "@/lib/library/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const entry = await db.query.characterLibrary.findFirst({ where: eq(characterLibrary.id, id) });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "An image file is required" }, { status: 400 });
  }

  const imagePath = await saveLibraryImage(id, file);
  // A different extension means the previous upload is now an orphan.
  if (entry.imagePath && entry.imagePath !== imagePath) await deleteLibraryImage(entry.imagePath);
  await db.update(characterLibrary).set({ imagePath }).where(eq(characterLibrary.id, id));
  return NextResponse.json({ imagePath });
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const entry = await db.query.characterLibrary.findFirst({ where: eq(characterLibrary.id, id) });
  if (!entry?.imagePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await readLibraryImage(entry.imagePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": libraryImageContentType(entry.imagePath),
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const entry = await db.query.characterLibrary.findFirst({ where: eq(characterLibrary.id, id) });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (entry.imagePath) await deleteLibraryImage(entry.imagePath);
  await db.update(characterLibrary).set({ imagePath: null }).where(eq(characterLibrary.id, id));
  return NextResponse.json({ ok: true });
}
