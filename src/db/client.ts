// One PGlite database per server process. PGlite is Postgres compiled to WASM:
// no server to run locally, and the same SQL moves to a real Postgres later.

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = PgliteDatabase<typeof schema>;

const g = globalThis as unknown as { __rxgDb?: Promise<DB> };

export function dataDir(): string {
  return process.env.RXG_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
}

async function open(dir: string): Promise<DB> {
  if (dir !== "memory") mkdirSync(path.dirname(dir), { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Promise<DB> {
  g.__rxgDb ??= open(dataDir());
  return g.__rxgDb;
}

/** A throwaway in-memory database, for tests. */
export function memoryDb(): Promise<DB> {
  return open("memory");
}
