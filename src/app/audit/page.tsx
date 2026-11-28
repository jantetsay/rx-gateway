import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { Empty } from "@/components/ui";
import { one, type SP } from "@/components/flash";

export const dynamic = "force-dynamic";

export default async function Audit({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const project = one(sp.project);
  const db = await getDb();
  const [rows, users, projects] = await Promise.all([
    db.select().from(t.auditLog).where(project ? eq(t.auditLog.projectId, project) : undefined).orderBy(desc(t.auditLog.id)).limit(300),
    db.select().from(t.users),
    db.select({ id: t.projects.id, name: t.projects.name }).from(t.projects),
  ]);
  const who = new Map(users.map((u) => [u.id, u.name]));
  const what = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <p className="text-sm text-gray-600">Every change, who made it and when. Read-only. Newest first, last 300.</p>
      {rows.length === 0 ? <Empty>No changes recorded yet.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-card text-left text-xs text-gray-600">
              <tr><th className="p-2">When (UTC)</th><th className="p-2">Who</th><th className="p-2">Action</th><th className="p-2">Item</th><th className="p-2">Client project</th><th className="p-2">Note</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap p-2 text-xs">{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td className="p-2">{r.actorId ? who.get(r.actorId) ?? "Unknown" : "System"}</td>
                  <td className="p-2">{r.action}</td>
                  <td className="p-2 text-xs">{r.entity}</td>
                  <td className="p-2">{r.projectId ? <Link href={`/audit?project=${r.projectId}`}>{what.get(r.projectId) ?? r.projectId}</Link> : ""}</td>
                  <td className="p-2 text-xs text-gray-600">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
