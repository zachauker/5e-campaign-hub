import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getReviewStatus } from "@/lib/vault/review-status";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionNoteId = searchParams.get("sessionNoteId");
  if (!sessionNoteId) return NextResponse.json({ error: "sessionNoteId required" }, { status: 400 });

  return NextResponse.json(await getReviewStatus(sdb, sessionNoteId));
}
