import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy-initialized DB client. Calling `neon()` at module load fails the Next.js
// build step "Collecting page data" in environments without DATABASE_URL (CI,
// Vercel's page-data collection). Proxy defers the init until the first
// property access, which only happens at request time.
type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

function init(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL env var is required at runtime (not needed at build)."
    );
  }
  const sql = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = init() as unknown as object;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
