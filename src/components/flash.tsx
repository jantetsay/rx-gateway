export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div role="status" className={`mb-4 rounded-md border px-3 py-2 text-sm ${error ? "border-bad/40 bg-bad-bg text-bad" : "border-ok/40 bg-ok-bg text-ok"}`}>
      {error ?? ok}
    </div>
  );
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
