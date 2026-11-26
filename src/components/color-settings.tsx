"use client";

// Status colors on Settings: a picker and a hex box per color, a live preview,
// and the dataviz checks rerun on every change, so a bad pick shows before it is
// saved. Saving and resetting go through server actions, which log each change.

import { useMemo, useState } from "react";
import { resetColors, saveColors } from "@/app/actions";
import { checkColors, COLOR_DEFS, DEFAULT_COLORS, contrast, inkOn, normalizeHex, SURFACE, type ColorKey, type StatusColors } from "@/domain/colors";
import { Submit } from "@/components/submit";

export function ColorSettings({ saved, back }: { saved: StatusColors; back: string }) {
  const [draft, setDraft] = useState<Record<ColorKey, string>>({ ...saved });
  const colors = useMemo(() => {
    const out = { ...saved };
    for (const d of COLOR_DEFS) out[d.key] = normalizeHex(draft[d.key]) ?? saved[d.key];
    return out as StatusColors;
  }, [draft, saved]);
  const issues = useMemo(() => checkColors(colors), [colors]);
  const unsaved = COLOR_DEFS.some((d) => colors[d.key] !== saved[d.key]);
  const set = (k: ColorKey, v: string) => setDraft((x) => ({ ...x, [k]: v }));

  const row = (k: ColorKey) => {
    const d = COLOR_DEFS.find((x) => x.key === k)!;
    const bad = draft[k] !== "" && !normalizeHex(draft[k]);
    const mine = issues.filter((i) => i.keys.includes(k));
    const worst = mine.some((i) => i.level === "fail") ? "fail" : mine.length ? "warn" : null;
    return (
      <li key={k} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[auto_12rem_1fr_auto]">
        <input type="color" aria-label={`${d.label} color`} value={colors[k]} onChange={(e) => set(k, e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-line bg-white p-0.5" />
        <div>
          <div className="text-sm font-semibold">{d.label}</div>
          <div className="text-xs text-gray-600">{contrast(colors[k], SURFACE).toFixed(1)}:1 on white
            {worst && <span className={`ml-2 font-semibold ${worst === "fail" ? "text-bad" : "text-warn"}`}>{worst === "fail" ? "Fails a check" : "See note"}</span>}
          </div>
        </div>
        <div className="col-span-2 text-xs text-gray-600 sm:col-span-1">{d.use}</div>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <input name={`c_${k}`} value={draft[k]} onChange={(e) => set(k, e.target.value)} aria-label={`${d.label} hex value`} aria-invalid={bad}
            className={`w-24 rounded border px-2 py-1 font-mono text-xs ${bad ? "border-bad" : "border-line"}`} />
          {colors[k] !== DEFAULT_COLORS[k] && (
            <button type="submit" formAction={resetColors} name="key" value={k} title={`Back to ${DEFAULT_COLORS[k]}`}
              className="rounded border border-line px-2 py-0.5 text-xs font-semibold text-navy hover:bg-card">Reset</button>
          )}
        </div>
      </li>
    );
  };

  return (
    <form action={saveColors} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Progress levels</h3>
          <p className="text-xs text-gray-600">Heat map cells, light to dark from not started to live.</p>
          <ul className="divide-y divide-line">{COLOR_DEFS.filter((d) => d.group === "level").map((d) => row(d.key))}</ul>
        </div>
        <div>
          <h3 className="text-sm font-bold">Due status</h3>
          <p className="text-xs text-gray-600">Card edges, markers and the late edge on partners. Always shown with its word.</p>
          <ul className="divide-y divide-line">{COLOR_DEFS.filter((d) => d.group === "status").map((d) => row(d.key))}</ul>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-gray-600">Preview</div>
        <div className="flex flex-wrap items-center gap-1">
          {COLOR_DEFS.filter((d) => d.group === "level").map((d) => (
            <span key={d.key} className="flex h-7 min-w-24 items-center justify-center rounded px-2 text-[11px] font-semibold"
              style={{ background: colors[d.key], color: inkOn(colors[d.key]) }}>{d.label.replace(/ \(.*\)$/, "")}</span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {COLOR_DEFS.filter((d) => d.group === "status").map((d) => (
            <span key={d.key} className="relative overflow-hidden rounded-md border border-line bg-card px-3 pb-1.5 pt-2.5 text-xs font-semibold text-navy">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: colors[d.key] }} />{d.label}
            </span>
          ))}
        </div>
      </div>

      <div aria-live="polite">
        {issues.length === 0 ? <p className="text-sm text-ok">Every check passes.</p> : (
          <ul className="space-y-1 text-sm">
            {issues.map((i) => (
              <li key={i.text} className={`rounded border px-2 py-1 ${i.level === "fail" ? "border-bad/40 bg-bad-bg text-bad" : "border-warn/30 bg-warn-bg text-warn"}`}>
                <strong>{i.level === "fail" ? "Fails: " : "Note: "}</strong>{i.text}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-gray-500">Checks follow the chart rules: contrast on white, levels getting darker step by step, readable words in cells, and status colors that stay apart, including for red-green color blindness. A pick that fails is still saved if you choose, with this warning.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Submit>Save colors</Submit>
        <button type="submit" formAction={resetColors} name="key" value=""
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold text-navy hover:bg-card">Reset all to defaults</button>
        {unsaved && <span className="text-xs text-warn">Not saved yet</span>}
      </div>
    </form>
  );
}
