// One client's work as its tracking sheet has it: KPI tiles, where the open work
// sits, when it was due, the past-due list, EDI partners and what is due next.
// Status colors always come with a word or an icon, never color alone.

import Link from "next/link";
import type { DueWeek, SheetBoard, TabSplit } from "@/domain/sheetboard";
import { STAGE_LABEL } from "@/domain/template";
import { ColorBadge, Reasons, fmtDate } from "@/components/ui";

const SHOW = 10;

const ST = {
  pastDue: { label: "Past due", fill: "var(--color-st-critical)" },
  dueSoon: { label: "Due in 2 weeks", fill: "var(--color-st-warning)" },
  later: { label: "Due later", fill: "var(--color-series-1)" },
  noDate: { label: "No due date", fill: "var(--color-st-none)" },
} as const;
type SegKey = keyof typeof ST;
const SEGS: SegKey[] = ["pastDue", "dueSoon", "later", "noDate"];

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const wd = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

// ---------- Icons (decorative, always beside a word) ----------

const I = {
  alert: "M12 3 2 21h20L12 3Zm0 6v5m0 3v.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  nodate: "M4 5h16v15H4zM4 10h16M9 3v4m6-4v4M9 14l6 4m0-4-6 4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};
function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`h-5 w-5 ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// ---------- KPI tile ----------

function Kpi({ label, value, sub, icon, tone, href }: { label: string; value: React.ReactNode; sub?: string; icon: string; tone: "critical" | "warning" | "neutral" | "good"; href?: string }) {
  const accent = { critical: "var(--color-st-critical)", warning: "var(--color-st-warning)", good: "var(--color-st-good)", neutral: "var(--color-navy)" }[tone];
  const numberColor = tone === "critical" ? "text-bad" : tone === "warning" ? "text-warn" : "text-navy";
  return (
    <TileShell href={href}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</span>
        <span style={{ color: accent }}><Icon d={icon} /></span>
      </div>
      <div className={`mt-1 font-serif text-4xl font-bold leading-none ${numberColor}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-600">{sub}{href ? <span className="float-right font-semibold text-navy">Details</span> : null}</div>}
    </TileShell>
  );
}

function TileShell({ href, children }: { href?: string; children: React.ReactNode }) {
  const cls = "relative block overflow-hidden rounded-xl border border-line bg-white px-4 py-3 shadow-sm";
  if (!href) return <div className={cls}>{children}</div>;
  return <Link href={href} className={`${cls} text-inherit no-underline transition hover:border-navy/40 hover:shadow-md active:scale-[0.99]`}>{children}</Link>;
}

// ---------- Where the open work is: one stacked bar per tab ----------

function Legend() {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
      {SEGS.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ST[k].fill }} />
          {ST[k].label}
        </li>
      ))}
    </ul>
  );
}

function TabBars({ tabs }: { tabs: TabSplit[] }) {
  const max = Math.max(1, ...tabs.map((t) => t.pastDue + t.dueSoon + t.later + t.noDate));
  return (
    <div>
      <Legend />
      <ul className="space-y-4">
        {tabs.map((t) => {
          const open = t.pastDue + t.dueSoon + t.later + t.noDate;
          const segs = SEGS.filter((k) => t[k] > 0);
          return (
            <li key={t.tab}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{t.tab}</span>
                <span className="text-xs text-gray-600">{open} open · {t.done} done</span>
              </div>
              {open === 0 ? <div className="text-xs text-gray-500">Nothing open.</div> : (
                <div className="flex h-7 gap-[2px]" style={{ width: `${Math.max(8, (open / max) * 100)}%` }}>
                  {segs.map((k, i) => (
                    <div
                      key={k}
                      title={`${t.tab}: ${t[k]} ${ST[k].label.toLowerCase()}`}
                      className={`flex items-center justify-center text-xs font-semibold ${i === 0 ? "rounded-l" : ""} ${i === segs.length - 1 ? "rounded-r" : ""}`}
                      style={{ flexGrow: t[k], flexBasis: 0, background: ST[k].fill, color: k === "dueSoon" ? "#3a2a00" : "#fff" }}
                    >
                      {t[k] / open >= 0.08 ? t[k] : ""}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- When it's due: open items by week ----------

/** A bar anchored to the baseline with only its top corners rounded. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function WeekChart({ weeks }: { weeks: DueWeek[] }) {
  const W = 640, H = 200, padL = 28, padB = 26, padT = 20;
  const n = weeks.length;
  const max = Math.max(1, ...weeks.map((w) => w.pastDue + w.upcoming));
  const top = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const slot = (W - padL) / Math.max(1, n);
  const bw = Math.min(36, slot * 0.6);
  const y = (v: number) => H - padB - (v / top) * (H - padB - padT);
  const ticks = [...new Set([0, Math.round(top / 2), top])];
  const thisIdx = weeks.findIndex((w) => w.isThisWeek);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Open items by the week they are due">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6b7280">{t}</text>
        </g>
      ))}
      {thisIdx >= 0 && (
        <g>
          <line x1={padL + slot * thisIdx + slot / 2} x2={padL + slot * thisIdx + slot / 2} y1={padT - 8} y2={H - padB} stroke="var(--color-navy)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={padL + slot * thisIdx + slot / 2 + 4} y={padT - 6} fontSize={11} fill="var(--color-navy)" fontWeight={600}>This week</text>
        </g>
      )}
      {weeks.map((w, i) => {
        const x = padL + slot * i + (slot - bw) / 2;
        const total = w.pastDue + w.upcoming;
        const segs = [
          { v: w.pastDue, fill: "var(--color-st-critical)", label: "past due" },
          { v: w.upcoming, fill: "var(--color-series-1)", label: "still to come" },
        ].filter((s) => s.v > 0);
        let base = 0;
        return (
          <g key={w.start}>
            <title>{`Week of ${short(w.start)}${i === 0 && w.pastDue ? " or earlier" : ""}: ${w.pastDue} past due, ${w.upcoming} still to come`}</title>
            <rect x={padL + slot * i} y={padT} width={slot} height={H - padB - padT} fill="transparent" />
            {segs.map((s, j) => {
              const yTop = y(base + s.v);
              const h = y(base) - yTop - (j > 0 ? 2 : 0);
              base += s.v;
              return <path key={s.label} d={barPath(x, yTop, bw, Math.max(1, h), j === segs.length - 1 ? 4 : 0)} fill={s.fill} />;
            })}
            {total > 0 && <text x={x + bw / 2} y={y(total) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#23283a">{total}</text>}
            {(i % 2 === 0 || w.isThisWeek) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#6b7280">{short(w.start)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- The board ----------

export function SheetBoardCard({ b }: { b: SheetBoard }) {
  const p = b.row.snapshot.project;
  const c = b.counts;
  const read = b.sources.map((s) => s.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
  const pct = b.total ? Math.round((c.done / b.total) * 100) : 0;
  const maxLate = Math.max(1, ...b.pastDue.map((i) => i.daysLate));

  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-navy px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/projects/${p.id}`} className="font-serif text-2xl font-bold text-white no-underline hover:underline">{p.clientName}</Link>
              <ColorBadge color={b.row.color} />
            </div>
            <p className="mt-1 text-sm text-white/80">
              {STAGE_LABEL[p.stage]} · target go-live {fmtDate(p.committedDate ?? p.targetWindowEnd)} · sheet last read {fmtTime(read)}
              {!read && <> · <Link href="/settings/sheets" className="text-gold">press Sync now on Sheets</Link></>}
            </p>
          </div>
          <div className="min-w-56">
            <div className="flex justify-between gap-3 text-xs text-white/80"><span>Done</span><span>{c.done} of {b.total} ({pct}%)</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/20" role="img" aria-label={`${pct}% of items done`}>
              <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Open" value={c.open} sub={`of ${b.total} items`} icon={I.list} tone="neutral" href={`/projects/${p.id}/board?view=open`} />
        <Kpi label="Past due" value={c.pastDue} sub={c.open ? `${Math.round((c.pastDue / c.open) * 100)}% of open work` : undefined} icon={I.alert} tone={c.pastDue ? "critical" : "good"} href={`/projects/${p.id}/board?view=pastdue`} />
        <Kpi label="Due in 2 weeks" value={c.dueSoon} sub="next 14 days" icon={I.clock} tone={c.dueSoon ? "warning" : "neutral"} href={`/projects/${p.id}/board?view=soon`} />
        <Kpi label="No due date" value={c.noDate} sub="open, undated" icon={I.nodate} tone="neutral" href={`/projects/${p.id}/board?view=nodate`} />
        <Kpi label="EDI partners late" value={`${c.partnersPastDue}/${c.partners}`} sub="past their next step" icon={I.link} tone={c.partnersPastDue ? "critical" : "good"} href={`/projects/${p.id}/board?view=partners`} />
      </div>

      <div className="rounded-xl border border-line bg-white px-5 py-3 shadow-sm">
        <Reasons reasons={b.row.evaluation.computed.reasons} max={3} />
        {b.noOwners && <p className="mt-2 text-xs text-gray-600">The sheet names no owners, so none show here. Add an Owner column to the sheet and map it as &quot;owner&quot; to see who has each item.</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-base font-bold">Where the open work is</h3>
          <p className="mb-3 text-xs text-gray-600">Open items in each tab of the sheet, by when they are due.</p>
          {b.byTab.length ? <TabBars tabs={b.byTab} /> : <p className="text-sm text-gray-500">No items yet.</p>}
        </div>
        <div className="rounded-xl border border-line bg-white p-5 shadow-sm lg:col-span-3">
          <h3 className="text-base font-bold">When it&apos;s due</h3>
          <p className="mb-2 text-xs text-gray-600">Open items by the week they were or are due. Older weeks fold into the first bar.</p>
          <ul className="mb-2 flex flex-wrap gap-x-4 text-xs text-gray-700">
            <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-st-critical)" }} />Past due</li>
            <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-series-1)" }} />Still to come</li>
          </ul>
          <WeekChart weeks={b.weeks} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-base font-bold">Past due, most overdue first</h3>
            <Link href={`/projects/${p.id}`} className="text-xs">Every item</Link>
          </div>
          {b.pastDue.length === 0 ? <p className="text-sm text-gray-500">Nothing past due.</p> : (
            <ul className="divide-y divide-line">
              {b.pastDue.slice(0, SHOW).map((i) => (
                <li key={i.id} className="grid grid-cols-[1fr_9rem] items-center gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm">{i.title}{i.blocked && <span className="ml-1 text-xs font-semibold text-bad">Blocked</span>}</div>
                    <div className="text-xs text-gray-500">{i.tab} · due {fmtDate(i.due)} · {i.owner ?? "no owner named"}</div>
                  </div>
                  <div title={`${wd(i.daysLate)} late`}>
                    <div className="h-2 rounded-r" style={{ width: `${Math.max(6, (i.daysLate / maxLate) * 100)}%`, background: "var(--color-st-critical)" }} />
                    <div className="mt-0.5 text-xs font-semibold text-bad">{wd(i.daysLate)} late</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {b.pastDue.length > SHOW && <Link href={`/projects/${p.id}`} className="mt-2 block text-xs">And {b.pastDue.length - SHOW} more past due</Link>}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-bold">EDI partners</h3><Link href={`/projects/${p.id}/board?view=partners`} className="text-xs">Partner details</Link></div>
            {b.partners.length === 0 ? <p className="text-sm text-gray-500">No EDI partners in the sheet.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {b.partners.map((x) => {
                  const late = x.daysLate > 0;
                  const tone = late ? "border-bad/30 bg-bad-bg text-bad" : x.nextStepDate ? "border-ok/30 bg-ok-bg text-ok" : "border-line bg-card text-gray-600";
                  return (
                    <li key={x.id} className="rounded-lg border border-line px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/projects/${p.id}/edi`} className="text-sm font-semibold">{x.name}</Link>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
                          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                          {late ? `${x.daysLate}d late` : x.nextStepDate ? "On track" : "No date"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-gray-600">{x.nextStep ?? "No next step in the sheet"}{x.nextStepDate ? ` · ${fmtDate(x.nextStepDate)}` : ""}{x.owner ? ` · ${x.owner}` : ""}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-bold">Due in the next 2 weeks</h3>
            {b.dueSoon.length === 0 ? <p className="text-sm text-gray-500">Nothing due in the next two weeks.</p> : (
              <ul className="space-y-2">
                {b.dueSoon.slice(0, SHOW).map((i) => (
                  <li key={i.id} className="flex items-start gap-3">
                    <span className="w-14 shrink-0 rounded-md bg-warn-bg px-1.5 py-1 text-center text-xs font-semibold text-warn">{short(i.due!)}</span>
                    <span className="text-sm">{i.title}{i.owner ? <span className="block text-xs text-gray-500">{i.owner}</span> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
