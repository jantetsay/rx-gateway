import { redirect } from "next/navigation";

// Sheets moved onto Settings. Old links still land in the right place.
export default function SheetsMoved() {
  redirect("/settings#sheets");
}
