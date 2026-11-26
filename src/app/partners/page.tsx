import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { Empty, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

/** One verified profile per trading partner, reused across clients. Identifiers only; no secrets are stored. */
export default async function Partners() {
  const db = await getDb();
  const rows = await db.select().from(t.partnerProfiles).orderBy(asc(t.partnerProfiles.legalName));
  const used = await db.select({ profileId: t.ediPartners.profileId }).from(t.ediPartners);
  const count = (id: string) => used.filter((u) => u.profileId === id).length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Partner profiles</h1>
      <p className="text-sm text-gray-600">Checked once, reused for every client that trades with the partner. Certificates and passwords are never stored here.</p>
      {rows.length === 0 ? <Empty>No profiles yet.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-card text-left text-xs text-gray-600">
              <tr><th className="p-2">Partner</th><th className="p-2">Kind</th><th className="p-2">Method</th><th className="p-2">EDI version</th><th className="p-2">Hub needed</th><th className="p-2">Last checked</th><th className="p-2">Clients</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="p-2 font-semibold">{r.legalName}</td>
                  <td className="p-2">{r.kind}</td>
                  <td className="p-2">{r.method ?? "Not set"}</td>
                  <td className="p-2">{r.ediVersion ?? "Not set"}</td>
                  <td className="p-2">{r.hubRequired ? "Yes" : "No"}</td>
                  <td className="p-2">{r.verifiedAt ? fmtDate(r.verifiedAt) : "Not verified"}</td>
                  <td className="p-2">{count(r.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
