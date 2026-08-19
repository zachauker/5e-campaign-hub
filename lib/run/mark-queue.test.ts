import { describe, it, expect } from "vitest";
import { enqueue, markSent, markFailed, dueItems, serialise, deserialise, type QueuedMark } from "./mark-queue";

const item: QueuedMark = {
  localId: "m1", campaignId: "c", runSessionId: "r", atMs: 1000,
  tag: null, note: null, contextKind: null, contextId: null,
  attempts: 0, nextAttemptAt: 0,
};

describe("enqueue", () => {
  it("appends without mutating the input queue", () => {
    const queue: QueuedMark[] = [];
    const next = enqueue(queue, item);
    expect(next).toHaveLength(1);
    expect(queue).toHaveLength(0);
  });

  it("ignores a duplicate localId so a double-send cannot double-write", () => {
    const next = enqueue(enqueue([], item), item);
    expect(next).toHaveLength(1);
  });
});

describe("markSent", () => {
  it("removes the item", () => {
    expect(markSent(enqueue([], item), "m1")).toHaveLength(0);
  });

  it("is a no-op for an unknown id", () => {
    expect(markSent(enqueue([], item), "nope")).toHaveLength(1);
  });
});

describe("markFailed", () => {
  it("backs off exponentially and caps the delay", () => {
    let queue = enqueue([], item);
    queue = markFailed(queue, "m1", 1_000);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].nextAttemptAt).toBe(3_000);

    queue = markFailed(queue, "m1", 3_000);
    expect(queue[0].nextAttemptAt).toBe(7_000);

    for (let i = 0; i < 12; i++) queue = markFailed(queue, "m1", 0);
    expect(queue[0].nextAttemptAt).toBeLessThanOrEqual(60_000);
  });

  it("never drops the item, however many attempts fail", () => {
    let queue = enqueue([], item);
    for (let i = 0; i < 50; i++) queue = markFailed(queue, "m1", 0);
    expect(queue).toHaveLength(1);
  });
});

describe("dueItems", () => {
  it("returns only items whose backoff has elapsed", () => {
    let queue = enqueue([], item);
    queue = markFailed(queue, "m1", 10_000);
    expect(dueItems(queue, 11_000)).toHaveLength(0);
    expect(dueItems(queue, 13_000)).toHaveLength(1);
  });
});

describe("serialise / deserialise", () => {
  it("round-trips a queue", () => {
    const queue = enqueue([], item);
    expect(deserialise(serialise(queue))).toEqual(queue);
  });

  it("returns an empty queue for corrupt storage rather than throwing", () => {
    expect(deserialise("not json")).toEqual([]);
    expect(deserialise(null)).toEqual([]);
    expect(deserialise('{"not":"an array"}')).toEqual([]);
  });

  it("drops entries that are missing required fields", () => {
    expect(deserialise(JSON.stringify([{ localId: "x" }]))).toEqual([]);
  });
});
