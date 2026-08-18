import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchEntityOptions } from "./entity-options";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(handler: (url: string) => { ok: boolean; body?: unknown }) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const { ok, body } = handler(String(input));
    return { ok, json: async () => body ?? {} } as Response;
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe("fetchEntityOptions", () => {
  it("scopes every request to the campaign and returns {id, name} per kind", async () => {
    const spy = stubFetch((url) => ({
      ok: true,
      body: { items: [{ id: `${url.includes("factions") ? "f" : "l"}1`, name: "N", extra: "dropped" }] },
    }));

    const result = await fetchEntityOptions("camp1", ["faction", "location"]);

    expect(result).toEqual({
      ok: true,
      options: { faction: [{ id: "f1", name: "N" }], location: [{ id: "l1", name: "N" }] },
    });
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["/api/factions?campaignId=camp1", "/api/locations?campaignId=camp1"]);
  });

  it("never issues an unscoped request when there is no active campaign", async () => {
    // An unscoped /api/factions returns every campaign's rows, so the guard has
    // to be "don't ask", not "ask and filter".
    const spy = stubFetch(() => ({ ok: true }));
    const result = await fetchEntityOptions("", ["faction"]);

    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports an error rather than an empty list when a kind fails", async () => {
    // The whole point: an empty picker must not be indistinguishable from a
    // campaign that genuinely has no factions.
    stubFetch((url) => ({ ok: !url.includes("locations"), body: { items: [] } }));
    const result = await fetchEntityOptions("camp1", ["faction", "location"]);
    expect(result.ok).toBe(false);
  });

  it("tolerates a response with no items array", async () => {
    stubFetch(() => ({ ok: true, body: {} }));
    const result = await fetchEntityOptions("camp1", ["item"]);
    expect(result).toEqual({ ok: true, options: { item: [] } });
  });
});
