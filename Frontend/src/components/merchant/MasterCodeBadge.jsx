import { SEGMENTS, parseMasterCode } from "../../lib/masterCodeCatalog";

/*
  Renders a master code with color-coded segments.
  <MasterCodeBadge code="DAMPAN01130INV-NEG-FN2808" size="md" />
  size: "sm" | "md" | "lg"
*/
export default function MasterCodeBadge({ code, size = "md", showLabels = false }) {
  const parts = parseMasterCode(code);
  const text =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-xs" : "text-sm";

  return (
    <span className="inline-flex flex-wrap items-end gap-x-0.5">
      {SEGMENTS.map((seg) => (
        <span key={seg.key} className="inline-flex items-end">
          {(seg.key === "color" || seg.key === "estilo") && (
            <span className={`font-mono font-bold text-slate-400 ${text}`}>-</span>
          )}
          <span className="inline-flex flex-col items-center">
            <span className={`font-mono font-bold tracking-wider ${text} ${seg.color}`}>
              {parts[seg.key]}
            </span>
            {showLabels && (
              <span className="text-[9px] uppercase tracking-wide text-slate-400">
                {seg.label}
              </span>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}