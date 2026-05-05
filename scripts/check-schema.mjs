import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);

const all = await sql`
  SELECT tablename, indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND (tablename IN ('analysis_runs','product_transitions','gateway_products','accounts'))
  ORDER BY tablename, indexname
`;

console.log("All indexes on target tables:");
for (const i of all) {
  console.log(`  ${i.tablename}.${i.indexname}`);
}

const cols = await sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'accounts' AND table_schema = 'public'
  ORDER BY ordinal_position
`;

console.log("\nAll accounts columns:");
for (const c of cols) {
  console.log(`  ${c.column_name}  (${c.data_type})`);
}
