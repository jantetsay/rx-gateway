"use client";

import { useFormStatus } from "react-dom";

/** Shows it was pressed and is working, so nobody presses twice. */
export function Submit({ children, tone = "primary", small }: { children: React.ReactNode; tone?: "primary" | "quiet" | "danger"; small?: boolean }) {
  const { pending } = useFormStatus();
  const cls = tone === "primary" ? "bg-navy text-white hover:bg-navy-deep"
    : tone === "danger" ? "bg-bad text-white hover:opacity-90"
    : "border border-line bg-white text-navy hover:bg-card";
  return (
    <button type="submit" disabled={pending} aria-busy={pending}
      className={`rounded-md font-semibold transition ${cls} ${small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm"}`}>
      {pending ? "Saving…" : children}
    </button>
  );
}
