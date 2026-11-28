// Starts an empty database: one admin user and nothing else. No sample clients,
// so the dashboard shows only clients you add. For the made-up demo data, run
// `npm run db:sample` instead.

import { getDb } from "../src/db/client";
import * as t from "../src/db/schema";

const db = await getDb();
const existing = await db.select().from(t.users);
if (existing.length) {
  console.log("Database already has data. Nothing changed.");
  process.exit(0);
}
await db.insert(t.users).values({ id: "u-admin", name: process.env.RXG_ADMIN_NAME || "Admin", email: "admin@example.com", role: "admin" });
console.log("Empty database ready. Add a client on the Sheets page, attach its sheet and press Sync now.");
process.exit(0);
