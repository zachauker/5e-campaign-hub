import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { listInbox, resolveInboxFile } from "./inbox";

let dir: string;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `inbox-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.REFERENCE_INBOX_DIR = dir;
  fs.writeFileSync(path.join(dir, "book.pdf"), "x");
  fs.writeFileSync(path.join(dir, "notes.md"), "x");
  fs.writeFileSync(path.join(dir, "ignore.zip"), "x");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("listInbox", () => {
  it("lists only .pdf/.md/.txt files", () => {
    const names = listInbox().map((f) => f.name).sort();
    expect(names).toEqual(["book.pdf", "notes.md"]);
  });
});

describe("resolveInboxFile", () => {
  it("resolves a plain filename inside the inbox", () => {
    expect(resolveInboxFile("book.pdf")).toBe(path.join(dir, "book.pdf"));
  });
  it("rejects traversal / absolute paths", () => {
    expect(() => resolveInboxFile("../secret")).toThrow();
    expect(() => resolveInboxFile("/etc/passwd")).toThrow();
    expect(() => resolveInboxFile("sub/../../x")).toThrow();
  });
  it("throws if the file does not exist or has an unsupported ext", () => {
    expect(() => resolveInboxFile("missing.pdf")).toThrow();
    expect(() => resolveInboxFile("ignore.zip")).toThrow();
  });
  it("rejects a symlink that escapes the inbox", () => {
    const outside = path.join(os.tmpdir(), `outside-${crypto.randomUUID()}.pdf`);
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(dir, "escape.pdf"));
    expect(() => resolveInboxFile("escape.pdf")).toThrow();
    fs.rmSync(outside, { force: true });
  });
});
