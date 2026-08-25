// lib/workOrderColors.js
//
// Single source of truth for per-work-order / per-style colors, so the Plan
// Board and the Planning Dashboard show the same color for the same order.
// Full literal Tailwind class strings so they are never purged.
//
// The palette is ordered so that CONSECUTIVE entries look as different as
// possible. That matters because styles are colored by rank (see
// buildStyleColorMap): the Nth distinct style_code gets palette entry N, so
// styles that sort next to each other must not land on look-alike colors.

export const WO_PALETTE = [
  // --- bright pass: strong hue rotation, mid shades --------------------------
  { bg: "bg-red-500",     border: "border-red-600",     dot: "bg-red-500" },
  { bg: "bg-blue-600",    border: "border-blue-700",    dot: "bg-blue-600" },
  { bg: "bg-lime-500",    border: "border-lime-600",    dot: "bg-lime-500" },
  { bg: "bg-fuchsia-500", border: "border-fuchsia-600", dot: "bg-fuchsia-500" },
  { bg: "bg-amber-500",   border: "border-amber-600",   dot: "bg-amber-500" },
  { bg: "bg-sky-500",     border: "border-sky-600",     dot: "bg-sky-500" },
  { bg: "bg-emerald-500", border: "border-emerald-600", dot: "bg-emerald-500" },
  { bg: "bg-rose-500",    border: "border-rose-600",    dot: "bg-rose-500" },
  { bg: "bg-violet-500",  border: "border-violet-600",  dot: "bg-violet-500" },
  { bg: "bg-teal-500",    border: "border-teal-600",    dot: "bg-teal-500" },
  { bg: "bg-orange-500",  border: "border-orange-600",  dot: "bg-orange-500" },
  { bg: "bg-cyan-500",    border: "border-cyan-600",    dot: "bg-cyan-500" },
  { bg: "bg-pink-500",    border: "border-pink-600",    dot: "bg-pink-500" },
  { bg: "bg-green-600",   border: "border-green-700",   dot: "bg-green-600" },
  { bg: "bg-indigo-500",  border: "border-indigo-600",  dot: "bg-indigo-500" },
  { bg: "bg-yellow-400",  border: "border-yellow-500",  dot: "bg-yellow-400" },
  { bg: "bg-purple-500",  border: "border-purple-600",  dot: "bg-purple-500" },
  // --- deep pass: darker shades, same hue rotation --------------------------
  { bg: "bg-red-800",     border: "border-red-900",     dot: "bg-red-800" },     // maroon
  { bg: "bg-sky-800",     border: "border-sky-900",     dot: "bg-sky-800" },
  { bg: "bg-lime-700",    border: "border-lime-800",    dot: "bg-lime-700" },
  { bg: "bg-purple-800",  border: "border-purple-900",  dot: "bg-purple-800" },
  { bg: "bg-amber-800",   border: "border-amber-900",   dot: "bg-amber-800" },   // brown
  { bg: "bg-blue-900",    border: "border-blue-900",    dot: "bg-blue-900" },    // navy
  { bg: "bg-emerald-800", border: "border-emerald-900", dot: "bg-emerald-800" },
  { bg: "bg-pink-800",    border: "border-pink-900",    dot: "bg-pink-800" },
  { bg: "bg-teal-800",    border: "border-teal-900",    dot: "bg-teal-800" },
  { bg: "bg-orange-700",  border: "border-orange-800",  dot: "bg-orange-700" },
  { bg: "bg-cyan-800",    border: "border-cyan-900",    dot: "bg-cyan-800" },
  { bg: "bg-rose-800",    border: "border-rose-900",    dot: "bg-rose-800" },
  { bg: "bg-green-900",   border: "border-green-900",   dot: "bg-green-900" },
  { bg: "bg-indigo-800",  border: "border-indigo-900",  dot: "bg-indigo-800" },
  { bg: "bg-fuchsia-800", border: "border-fuchsia-900", dot: "bg-fuchsia-800" },
  { bg: "bg-violet-900",  border: "border-violet-900",  dot: "bg-violet-900" },
  // --- neutrals + a few light tones to round out the set --------------------
  { bg: "bg-slate-500",   border: "border-slate-600",   dot: "bg-slate-500" },   // cool gray
  { bg: "bg-stone-600",   border: "border-stone-700",   dot: "bg-stone-600" },   // warm gray
  { bg: "bg-red-400",     border: "border-red-500",     dot: "bg-red-400" },
  { bg: "bg-teal-400",    border: "border-teal-500",    dot: "bg-teal-400" },
  { bg: "bg-sky-400",     border: "border-sky-500",     dot: "bg-sky-400" },
  { bg: "bg-amber-300",   border: "border-amber-400",   dot: "bg-amber-300" },
  { bg: "bg-zinc-700",    border: "border-zinc-800",    dot: "bg-zinc-700" },
];

// Stable hash → the SAME key always gets the SAME palette entry, and the
// returned object is a reference into WO_PALETTE (so `===` comparisons in the
// picker work). Used as a fallback for keys that have no style_code (legacy
// orders), where rank-based assignment can't apply.
export function colorForWO(key) {
  const s = String(key == null ? "" : key);
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = (h >>> 0) % WO_PALETTE.length;
  return WO_PALETTE[idx];
}

// Normalize a tipo+modelo+correlativo (style_code) for use as a map key.
export function normStyleCode(code) {
  return String(code == null ? "" : code).trim().toUpperCase();
}

// Rank-based color assignment: give every DISTINCT style_code its own palette
// slot so codes are visually distinguishable instead of hash-colliding.
//
// Pass the full set of style_codes in play (from work orders and/or
// assignments). The list is de-duplicated and sorted, then the Nth distinct
// code is mapped to palette entry N. Feed BOTH boards the same set of codes and
// they will agree on colors. Assignment only wraps (repeats a color) once the
// number of distinct codes exceeds WO_PALETTE.length.
//
// Returns a Map<UPPERCASE style_code, palette index>.
export function buildStyleColorMap(styleCodes) {
  const uniq = [
    ...new Set(
      (Array.isArray(styleCodes) ? styleCodes : [])
        .map(normStyleCode)
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
  const map = new Map();
  uniq.forEach((code, i) => map.set(code, i % WO_PALETTE.length));
  return map;
}

// Convenience: resolve a style_code straight to its palette entry given a map
// built by buildStyleColorMap. Falls back to the hash so a code missing from
// the map still gets a stable color.
export function colorForStyle(styleCode, styleColorMap) {
  const code = normStyleCode(styleCode);
  if (code && styleColorMap && styleColorMap.has(code)) {
    return WO_PALETTE[styleColorMap.get(code)];
  }
  return colorForWO(`style:${code}`);
}

export default WO_PALETTE;