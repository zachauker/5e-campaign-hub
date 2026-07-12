import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

// Ingests every .md file under reference-data/srd/ into one "SRD 5.1" collection
// by concatenating them, then delegating to ingest.ts. The DM places the openly-
// licensed SRD markdown there (see reference-data/srd/README.md).
const dir = path.join(process.cwd(), "reference-data", "srd");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
if (files.length === 0) {
  console.error("No SRD markdown found in reference-data/srd/. See reference-data/srd/README.md.");
  process.exit(1);
}
const combined = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
const tmp = path.join(dir, ".srd-combined.md");
fs.writeFileSync(tmp, combined);
try {
  execFileSync("npx", ["tsx", "scripts/reference/ingest.ts", tmp, "--collection", "SRD 5.1", "--replace"], { stdio: "inherit" });
} finally {
  fs.unlinkSync(tmp);
}
