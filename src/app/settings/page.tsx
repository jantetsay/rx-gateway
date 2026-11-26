// Settings: status colors, the Google connection, sheet sources and their
// mappings, adding clients and sheets, and a log of every setting change.

import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import * as repo from "@/db/repo";
import { logRow } from "@/domain/settingslog";
import { ColorSettings } from "@/components/color-settings";
import { credentialStatus } from "@/sheets/google";
import { addClient, addSheetSource, syncNow, updateSheetMapping } from "@/app/actions";
import { STAGE_LABEL } from "@/domain/template";
import { STAGES } from "@/domain/types";
import { Card, Empty, fmtDate } from "@/components/ui";
import { Flash, one, type SP } from "@/components/flash";
import { Submit } from "@/components/submit";

export const dynamic = "force-dynamic";

const SEGMENTS = ["Wholesaler and distributor", "Manufacturer", "3PL provider", "Micro-distributor", "Government"];

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = await getDb();
  const [sources, projects, colors, log, users] = await Promise.all([
    db.select().from(t.sheetSources).orderBy(asc(t.sheetSources.label)),
    db.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).orderBy(asc(t.projects.name)),
    repo.statusColors(db),
    repo.settingsLog(db),
    db.select({ id: t.users.id, name: t.users.name }).from(t.users),
  ]);
  const cred = credentialStatus();
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const back = "/settings";
  const sourceLabel = new Map(sources.map((s) => [s.id, s.label]));
  const who = new Map(users.map((u) => [u.id, u.name]));
  const rows = log.map((e) => ({ ...logRow(e, (id) => sourceLabel.get(id) ?? "a removed sheet"), by: e.actorId ? who.get(e.actorId) ?? null : null }));
  const fmtAt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="text-2xl font-bold">Settings</h1>
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Settings sections">
        <a href="#colors">Status colors</a><a href="#google">Google connection</a><a href="#sheets">Sheet sources and mappings</a>
        <a href="#add">Add a client or sheet</a><a href="#log">Change log</a>
      </nav>

      <section id="colors" className="scroll-mt-4">
        <Card title="Status colors">
          <ColorSettings saved={colors} back={back} />
        </Card>
      </section>

      <h2 id="google" className="scroll-mt-4 pt-2 text-xl font-bold">Google Sheets</h2>
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

      <section id="sheets" className="scroll-mt-4">
      <Card title="Sheet sources and mappings">
        {sources.length === 0 ? <Empty>No sheets added yet.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-xs text-gray-600">{pname.get(s.projectId) ?? s.projectId} · Last read {s.lastSyncedAt ? fmtDate(s.lastSyncedAt) : "never"}{s.lastResult ? ` · ${s.lastResult}` : ""}</div>
                </div>
                <form action={syncNow}><input type="hidden" name="sourceId" value={s.id} /><input type="hidden" name="back" value={back} /><Submit small>Sync now</Submit></form>
                <details className="w-full">
                  <summary className="cursor-pointer text-xs font-semibold text-navy">Edit mapping</summary>
                  <form action={updateSheetMapping} className="mt-2 grid gap-2">
                    <input type="hidden" name="sourceId" value={s.id} /><input type="hidden" name="back" value={back} />
                    <textarea name="mapping" required rows={8} defaultValue={JSON.stringify(s.mapping, null, 2)} className="rounded border border-line p-2 font-mono text-xs" />
                    <p className="text-xs text-gray-600">Tab and column names only. Removing a tab takes its items and partners off at the next sync, unless someone logged tests or gaps against a partner in the app.</p>
                    <div><Submit small>Save mapping</Submit></div>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </section>

      <section id="add" className="scroll-mt-4 space-y-6">
      <Card title="Add a client">
        <p className="mb-2 text-xs text-gray-600">Creates a client record so a tracking sheet has somewhere to land. Pick where its work comes from: only its sheet (the dashboard then shows the sheet&apos;s items and nothing made up), or the standard plan of stages, gates and work items.</p>
        <form action={addClient} className="grid gap-3 text-sm sm:grid-cols-2">
          <input type="hidden" name="back" value={back} />
          <label className="grid gap-1">Client name<input name="name" required className="rounded border border-line px-2 py-1" /></label>
          <label className="grid gap-1">Segment
            <select name="segment" className="rounded border border-line px-2 py-1">
              {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="grid gap-1">Current stage
            <select name="stage" defaultValue="onboarding" className="rounded border border-line px-2 py-1">
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="grid gap-1">Start date<input type="date" name="start" className="rounded border border-line px-2 py-1" /></label>
          <label className="grid gap-1">Target go-live<input type="date" name="goLive" className="rounded border border-line px-2 py-1" /></label>
          <label className="grid gap-1">Work comes from
            <select name="plan" defaultValue="sheet" className="rounded border border-line px-2 py-1">
              <option value="sheet">Its tracking sheet only</option>
              <option value="template">The standard plan</option>
            </select>
          </label>
          <div className="self-end"><Submit>Add client</Submit></div>
        </form>
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
      </section>

      <section id="log" className="scroll-mt-4">
        <Card title="Change log">
          <p className="mb-2 text-xs text-gray-600">Every change to a setting on this page: status colors, sheets added and mapping edits. Newest first, the last {rows.length === 60 ? 60 : "few"}.</p>
          {rows.length === 0 ? <Empty>No setting changes yet.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-card text-left text-xs uppercase tracking-wide text-gray-600">
                  <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Old value</th><th className="px-3 py-2">New value</th><th className="px-3 py-2">By</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtAt(r.at)}</td>
                      <td className="px-3 py-2 font-semibold">{r.what}</td>
                      <td className="px-3 py-2"><LogValue v={r.old} swatch={r.colors?.old} /></td>
                      <td className="px-3 py-2"><LogValue v={r.new} swatch={r.colors?.new} /></td>
                      <td className="px-3 py-2 text-gray-600">{r.by ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function LogValue({ v, swatch }: { v: string | null; swatch?: string | null }) {
  if (!v) return <span className="text-gray-400">none</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch && <span aria-hidden className="inline-block h-3.5 w-5 rounded-sm border border-line" style={{ background: swatch }} />}
      <span className={swatch ? "font-mono text-xs" : "text-xs"}>{v}</span>
    </span>
  );
}
