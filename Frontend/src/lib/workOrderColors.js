// lib/workOrderColors.js
//
// Single source of truth for per-work-order colors, so the Plan Board and the
// Planning Dashboard show the same color for the same order.
// Full literal Tailwind class strings so they are never purged.

export const WO_PALETTE = [
  { bg: "bg-blue-500", border: "border-blue-600", dot: "bg-blue-500" },
  { bg: "bg-emerald-500", border: "border-emerald-600", dot: "bg-emerald-500" },
  { bg: "bg-amber-500", border: "border-amber-600", dot: "bg-amber-500" },
  { bg: "bg-violet-500", border: "border-violet-600", dot: "bg-violet-500" },
  { bg: "bg-rose-500", border: "border-rose-600", dot: "bg-rose-500" },
  { bg: "bg-cyan-500", border: "border-cyan-600", dot: "bg-cyan-500" },
  { bg: "bg-lime-500", border: "border-lime-600", dot: "bg-lime-500" },
  { bg: "bg-fuchsia-500", border: "border-fuchsia-600", dot: "bg-fuchsia-500" },
  { bg: "bg-orange-500", border: "border-orange-600", dot: "bg-orange-500" },
  { bg: "bg-teal-500", border: "border-teal-600", dot: "bg-teal-500" },
  { bg: "bg-indigo-500", border: "border-indigo-600", dot: "bg-indigo-500" },
  { bg: "bg-pink-500", border: "border-pink-600", dot: "bg-pink-500" },
  { bg: "bg-sky-500", border: "border-sky-600", dot: "bg-sky-500" },
  { bg: "bg-green-500", border: "border-green-600", dot: "bg-green-500" },
];

// Stable hash → a given work order always maps to the same color everywhere.
export const colorForWO = (id) => {
  const s = String(id ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return WO_PALETTE[Math.abs(h) % WO_PALETTE.length];
};