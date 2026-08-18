/** Thrown by lib/state/* repos for "no row with that id" cases, so routes can
 * distinguish "not found" from "bad input" without string-matching messages. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * A caught value shaped like better-sqlite3's SqliteError: it always carries a
 * `code` string such as "SQLITE_CONSTRAINT_NOTNULL". Checking the shape rather
 * than importing the class keeps this module dependency-light and easy to test
 * with a plain object.
 */
function isSqliteError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_")
  );
}

/**
 * Turn a caught value into a message safe to send to a client. Deliberate
 * domain errors thrown by lib/state/* (including NotFoundError) carry their
 * message through unchanged. Raw driver errors — better-sqlite3's SqliteError,
 * which names internal tables and columns (e.g. "NOT NULL constraint failed:
 * thread_links.target_id") — are mapped to a generic message instead.
 */
export function toClientErrorMessage(err: unknown): string {
  if (isSqliteError(err)) {
    return "A database error occurred.";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "An unexpected error occurred.";
}
