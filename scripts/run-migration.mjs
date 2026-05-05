import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("usage: node scripts/run-migration.mjs <path-to-sql>");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const raw = readFileSync(migrationFile, "utf8");

// Strip -- line comments first, then split on ;. Keeps multi-clause
// statements (ALTER TABLE ... ADD COLUMN ..., ADD COLUMN ...) intact.
const stripped = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const statements = stripped
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, " ").slice(0, 100);
  console.log("→", preview, "…");
  try {
    // sql.query executes raw SQL; sql.unsafe just wraps a string for interpolation.
    await sql.query(stmt);
    console.log("  ok");
  } catch (err) {
    console.error("  FAIL:", err.message);
    process.exit(1);
  }
}
console.log(`\n✓ ${migrationFile} applied (${statements.length} stmts)`);
