import { NextResponse } from "next/server";
import { listInbox } from "@/lib/reference/inbox";

export async function GET() {
  return NextResponse.json({ files: listInbox() });
}
