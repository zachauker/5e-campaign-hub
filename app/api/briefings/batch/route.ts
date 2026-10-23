import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { selectBuildTargets, type BuildScope } from "@/lib/run/briefing-batch";
import { buildBriefing } from "@/lib/run/briefing-build";
import { generateBriefing } from "@/lib/run/briefing-agent";
import { toClientErrorMessage } from "@/lib/state/errors";
import type { StateDb } from "@/lib/state/types";

const sdb: StateDb = db;

/** Bounds one request. A large campaign is built by calling again until `remaining` is 0. */
const MAX_PER_REQUEST = 25;

export async function POST(req: Request) {
  const body = await req.json();
  if (typeof body.campaignId !== "string" || !body.campaignId) {
    return NextResponse.json({ error: '"campaignId" is required and must be a string' }, { status: 400 });
  }
  const scope: BuildScope = body.scope === "all" ? "all" : "session";

  const keyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  const apiKey = keyRow?.value?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Add an Anthropic API key in Settings to build briefings." },
      { status: 400 },
    );
  }

  try {
    const targets = await selectBuildTargets(sdb, body.campaignId, scope);
    const batch = targets.slice(0, MAX_PER_REQUEST);

    let built = 0;
    const failures: { targetId: string; error: string }[] = [];

    for (const target of batch) {
      try {
        await buildBriefing(sdb, {
          campaignId: body.campaignId,
          targetKind: target.targetKind,
          targetId: target.targetId,
          generate: (inputs) => generateBriefing(inputs, { apiKey }),
        });
        built++;
      } catch (err) {
        // One entity that will not build must not abandon the other 24. The
        // caller sees exactly what was skipped rather than a silent shortfall.
        failures.push({ targetId: target.targetId, error: toClientErrorMessage(err) });
      }
    }

    return NextResponse.json({
      built,
      failures,
      remaining: Math.max(targets.length - batch.length, 0),
    });
  } catch (err) {
    return NextResponse.json({ error: toClientErrorMessage(err) }, { status: 400 });
  }
}
