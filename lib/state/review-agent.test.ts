import { describe, it, expect } from "vitest";
import { captureFromToolResult, REVIEW_SYSTEM } from "./review-agent";

describe("captureFromToolResult", () => {
  it("captures a proposal", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    captureFromToolResult(JSON.stringify({ proposal: { summary: "s", targetRoute: "/api/threads" } }), proposals, counts);
    expect(proposals).toHaveLength(1);
    expect(counts.rejected).toBe(0);
  });

  it("counts a rejection without capturing a proposal", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    captureFromToolResult(JSON.stringify({ rejected: true, error: "citation not found verbatim" }), proposals, counts);
    expect(proposals).toHaveLength(0);
    expect(counts.rejected).toBe(1);
  });

  it("ignores plain read-tool output", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    captureFromToolResult(JSON.stringify([{ id: "t1", title: "Find Ovid" }]), proposals, counts);
    expect(proposals).toHaveLength(0);
    expect(counts.rejected).toBe(0);
  });

  it("ignores non-JSON output without throwing", () => {
    const proposals: unknown[] = [];
    const counts = { rejected: 0 };
    expect(() => captureFromToolResult("not json", proposals, counts)).not.toThrow();
    expect(proposals).toHaveLength(0);
  });
});

describe("REVIEW_SYSTEM", () => {
  it("tells the model citations must be verbatim and that nothing is applied", () => {
    expect(REVIEW_SYSTEM).toMatch(/verbatim/i);
    expect(REVIEW_SYSTEM).toMatch(/not applied|confirm/i);
  });
});
