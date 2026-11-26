import Link from "next/link";
import type { Color } from "@/domain/types";

const STYLE: Record<Color, string> = {
  green: "bg-ok-bg text-ok border-ok/30",
  yellow: "bg-warn-bg text-warn border-warn/30",
  red: "bg-bad-bg text-bad border-bad/30",
};
const LABEL: Record<Color, string> = { green: "Green", yellow: "Yellow", red: "Red" };

/** Color always comes with its word, so it reads without color vision. */
export function ColorBadge({ color, title, small }: { color: Color; title?: string; small?: boolean }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border font-semibold ${STYLE[color]} ${small ? "px-1.5 text-[11px]" : "px-2 py-0.5 text-xs"}`}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-current" />
      {LABEL[color]}
    </span>
  );
}

export function Cell({ color, children, title }: { color: Color; children?: React.ReactNode; title?: string }) {
  return <span title={title} className={`block rounded border px-1.5 py-1 text-center text-xs font-semibold ${STYLE[color]}`}>{children ?? LABEL[color]}</span>;
}

export function Card({ title, children, action, className = "" }: { title?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-white p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Color }) {
  const c = tone === "red" ? "text-bad" : tone === "yellow" ? "text-warn" : tone === "green" ? "text-ok" : "text-navy";
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <div className={`font-serif text-3xl font-bold ${c}`}>{value}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}

export function Reasons({ reasons, max = 4 }: { reasons: string[]; max?: number }) {
  if (!reasons.length) return null;
  const shown = reasons.slice(0, max);
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-700">
      {shown.map((r, i) => <li key={i}>{r}</li>)}
      {reasons.length > max && <li className="list-none text-gray-500">and {reasons.length - max} more</li>}
    </ul>
  );
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "Not set";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function Trend({ trend }: { trend: "up" | "down" | "same" | null }) {
  if (!trend) return <span className="text-xs text-gray-400">New</span>;
  const map = { up: ["Better", "text-ok"], down: ["Worse", "text-bad"], same: ["Same", "text-gray-500"] } as const;
  const [label, cls] = map[trend];
  return <span className={`text-xs font-semibold ${cls}`}>{label}</span>;
}

export function ProjectLink({ id, name, client }: { id: string; name: string; client: string }) {
  return (
    <Link href={`/projects/${id}`} className="font-semibold">
      {client}
      <span className="block text-xs font-normal text-gray-500">{name}</span>
    </Link>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>;
}
