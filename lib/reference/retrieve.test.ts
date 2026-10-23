import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/db/test-helpers";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { searchReference, upsertVectors, type Embedder } from "./retrieve";

const DIMS = 384;
const pad = (signal: number[]): number[] => [...signal, ...Array(DIMS - signal.length).fill(0)];
// Deterministic stub: 3 signal axes (grapple/fireball/dragon) padded to 384.
const stub: Embedder = async (texts) =>
  texts.map((t) => {
    const s = t.toLowerCase();
    return pad([s.includes("grapple") ? 1 : 0, s.includes("fireball") ? 1 : 0, s.includes("dragon") ? 1 : 0]);
  });

function seed(db: ReturnType<typeof createTestDb>["db"]) {
  const now = new Date();
  db.insert(referenceCollections).values([
    { id: "srd", name: "SRD 5.1", sourceType: "srd", enabled: true, chunkCount: 2, notes: "official core rules", createdAt: now },
    { id: "off", name: "Disabled", sourceType: "text", enabled: false, chunkCount: 1, createdAt: now },
  ]).run();
  db.insert(referenceChunks).values([
    { id: "c1", collectionId: "srd", content: "Rules for grapple checks.", sourceRef: "SRD: Grappling", ordinal: 0, tokenCount: 5 },
    { id: "c2", collectionId: "srd", content: "Fireball deals 8d6 fire damage.", sourceRef: "SRD: Fireball", ordinal: 1, tokenCount: 6 },
    { id: "c3", collectionId: "off", content: "Grapple lore from a disabled book.", sourceRef: "Off: x", ordinal: 0, tokenCount: 6 },
  ]).run();
  return db;
}

describe("searchReference", () => {
  it("returns the nearest enabled chunk with its citation", async () => {
    const { db } = createTestDb();
    seed(db);
    await upsertVectors(db, [
      { chunkId: "c1", embedding: (await stub(["grapple"]))[0] },
      { chunkId: "c2", embedding: (await stub(["fireball"]))[0] },
    ], DIMS);
    const hits = await searchReference(db, { query: "how do I grapple?", embed: stub, k: 1, dims: DIMS });
    expect(hits[0]).toMatchObject({ sourceRef: "SRD: Grappling", collection: "SRD 5.1", note: "official core rules" });
  });

  it("excludes disabled collections", async () => {
    const { db } = createTestDb();
    seed(db);
    await upsertVectors(db, [{ chunkId: "c3", embedding: (await stub(["grapple"]))[0] }], DIMS);
    const hits = await searchReference(db, { query: "grapple", embed: stub, k: 5, dims: DIMS });
    expect(hits.find((h) => h.collection === "Disabled")).toBeUndefined();
  });

  it("returns an enabled match even when the NEAREST chunk is in a disabled collection", async () => {
    const { db } = createTestDb();
    seed(db);
    // Disabled chunk c3 is an EXACT match for the query (distance 0); enabled
    // chunk c1 is a real-but-farther match (same axis, half magnitude). If the
    // enabled filter were applied after the KNN limit, k=1 would spend its one
    // slot on c3 and return empty. Over-fetching must surface c1 instead.
    const near = pad([1, 0, 0]);
    const far = pad([0.5, 0, 0]);
    await upsertVectors(db, [
      { chunkId: "c3", embedding: near }, // disabled, nearest
      { chunkId: "c1", embedding: far },  // enabled, farther but real
    ], DIMS);
    const hits = await searchReference(db, { query: "grapple", embed: stub, k: 1, dims: DIMS });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceRef: "SRD: Grappling", collection: "SRD 5.1" });
  });
});
