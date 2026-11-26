import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { credentialStatus } from "@/sheets/google";
import { addSheetSource, syncNow } from "@/app/actions";
import { Card, Empty, fmtDate } from "@/components/ui";
import { Flash, one, type SP } from "@/components/flash";
import { Submit } from "@/components/submit";

export const dynamic = "force-dynamic";

export default async function SheetsSettings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = await getDb();
  const [sources, projects] = await Promise.all([
    db.select().from(t.sheetSources).orderBy(asc(t.sheetSources.label)),
    db.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).orderBy(asc(t.projects.name)),
  ]);
  const cred = credentialStatus();
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const back = "/settings/sheets";

  return (
    <div className="space-y-6">
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="text-2xl font-bold">Google Sheets</h1>
      <p className="text-sm text-gray-600">The app reads tracking sheets and never writes to them. Titles, due dates and states that come from a sheet can only be changed in the sheet.</p>

      <Card title="Connection">
        {cred.configured ? (
          <p className="text-sm">Connected with a service account. Share each sheet with <strong>{cred.shareWith ?? "the service account"}</strong> as Viewer.</p>
        ) : (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-bad">Not connected yet.</p>
            <ol className="list-decimal pl-5">
              <li>In Google Cloud, create a service account and turn on the Google Sheets API.</li>
              <li>Make a key for it and put it in <code>.env.local</code> as <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>, or point <code>GOOGLE_APPLICATION_CREDENTIALS</code> at the key file.</li>
              <li>Share each tracking sheet with the service account&apos;s email as Viewer.</li>
              <li>Restart the app. This page will show the email to share with.</li>
            </ol>
          </div>
        )}
      </Card>

      <Card title="Sheet sources">
        {sources.length === 0 ? <Empty>No sheets added yet.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-xs text-gray-600">{pname.get(s.projectId) ?? s.projectId} · Last read {s.lastSyncedAt ? fmtDate(s.lastSyncedAt) : "never"}{s.lastResult ? ` · ${s.lastResult}` : ""}</div>
                </div>
                <form action={syncNow}><input type="hidden" name="sourceId" value={s.id} /><input type="hidden" name="back" value={back} /><Submit small>Sync now</Submit></form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Add a sheet">
        <form action={addSheetSource} className="grid gap-3 text-sm">
          <input type="hidden" name="back" value={back} />
          <label className="grid gap-1">Client project
            <select name="projectId" required className="rounded border border-line px-2 py-1">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1">Label<input name="label" placeholder="Tracking sheet" className="rounded border border-line px-2 py-1" /></label>
          <label className="grid gap-1">Sheet address or ID<input name="spreadsheet" required className="rounded border border-line px-2 py-1" /></label>
          <label className="grid gap-1">Mapping (JSON: which tabs and columns to read)
            <textarea name="mapping" required rows={10} className="rounded border border-line p-2 font-mono text-xs" placeholder='{"tabs":[{"kind":"tasks","tab":"Tasks","defaults":{"workstream":"data","stage":"data"},"columns":{"key":"ID","title":"Task"}}]}' />
          </label>
          <p className="text-xs text-gray-500">See sheets.config.example.json in the repository for every option. The mapping holds tab and column names only.</p>
          <div><Submit>Add sheet</Submit></div>
        </form>
      </Card>
    </div>
  );
}
