import { describe, it, expect } from "vitest";
import { NotFoundError, toClientErrorMessage } from "./errors";

describe("toClientErrorMessage", () => {
  it("passes through a deliberate domain Error's message", () => {
    expect(toClientErrorMessage(new Error("thread title is required"))).toBe(
      "thread title is required",
    );
  });

  it("passes through a NotFoundError's message", () => {
    expect(toClientErrorMessage(new NotFoundError("thread not found: abc"))).toBe(
      "thread not found: abc",
    );
  });

  it("maps a raw better-sqlite3-shaped error to a generic message", () => {
    const sqliteError = Object.assign(
      new Error("NOT NULL constraint failed: thread_links.target_id"),
      { code: "SQLITE_CONSTRAINT_NOTNULL" },
    );
    expect(toClientErrorMessage(sqliteError)).toBe("A database error occurred.");
    expect(toClientErrorMessage(sqliteError)).not.toContain("thread_links");
  });

  it("does not treat an error with a non-SQLITE code as a driver error", () => {
    const err = Object.assign(new Error("boom"), { code: "SOME_OTHER_CODE" });
    expect(toClientErrorMessage(err)).toBe("boom");
  });

  it("falls back to a generic message for a non-Error thrown value", () => {
    expect(toClientErrorMessage("just a string")).toBe("An unexpected error occurred.");
    expect(toClientErrorMessage(undefined)).toBe("An unexpected error occurred.");
  });
});
