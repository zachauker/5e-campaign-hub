import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threads, threadLinks } from "@/lib/db/schema";
import { updateThread } from "@/lib/state/threads";
import { getCampaignDay } from "@/lib/state/advance";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.threads.findFirst({ where: eq(threads.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const links = await db.query.threadLinks.findMany({ where: eq(threadLinks.threadId, id) });
  return NextResponse.json({ ...row, links });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const existing = await db.query.threads.findFirst({ where: eq(threads.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const currentDay = await getCampaignDay(sdb, existing.campaignId);
    const row = await updateThread(sdb, id, {
      title: body.title,
      stakes: body.stakes,
      notes: body.notes,
      status: body.status,
      resolvedSessionId: body.resolvedSessionId,
      links: body.links,
      currentDay,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(threads).where(eq(threads.id, id));
  return NextResponse.json({ ok: true });
}
