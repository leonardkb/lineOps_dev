// ==========================================================================
// ParseQualityBanner.jsx
//
// Surfaces what the tech-pack parser could and could not read. Without this,
// StyleOrderWizard.jsx sends every warning to console.warn, where no operator
// will ever see it — and the wizard shows the same cheerful green toast
// whether the parse was perfect or badly misaligned.
//
// Fatal issues block the wizard until acknowledged. Warnings inform.
//
//   import ParseQualityBanner from "./ParseQualityBanner";
//   <ParseQualityBanner
//     quality={parseQuality}
//     warnings={parseWarnings}
//     meta={parseMeta}
//     onDismiss={() => { setParseQuality(null); setParseWarnings([]); }}
//   />
// ==========================================================================

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, X } from "lucide-react";

const FORMAT_LABEL = {
  nike_bom: "Bill of Materials (Nike PLM)",
  skm_sheet: "Hoja de proceso (加工指導書)",
};

export default function ParseQualityBanner({ quality, warnings = [], meta, onDismiss }) {
  const [open, setOpen] = useState(false);
  if (!quality && !warnings.length) return null;

  const issues = quality?.issues || warnings.map((msg) => ({ sev: "warn", msg }));
  const fatal = issues.filter((i) => i.sev === "fatal");
  const warn = issues.filter((i) => i.sev !== "fatal");
  const confidence = quality?.confidence ?? null;

  const level = fatal.length ? "fatal" : warn.length ? "warn" : "ok";
  const theme = {
    fatal: { bg: "bg-red-50", border: "border-red-300", text: "text-red-900", sub: "text-red-700", Icon: XCircle, iconCls: "text-red-600" },
    warn: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-900", sub: "text-amber-700", Icon: AlertTriangle, iconCls: "text-amber-600" },
    ok: { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-900", sub: "text-emerald-700", Icon: CheckCircle2, iconCls: "text-emerald-600" },
  }[level];
  const { Icon } = theme;

  const headline = {
    fatal: "Revisa la importación antes de continuar",
    warn: "Importado con observaciones",
    ok: "Importación verificada",
  }[level];

  const detail = {
    fatal: `${fatal.length} problema(s) grave(s) — los datos pueden estar mal alineados.`,
    warn: `${warn.length} punto(s) a revisar. Todos los campos son editables.`,
    ok: "Todas las verificaciones internas pasaron.",
  }[level];

  return (
    <div className={`${theme.bg} ${theme.border} ${theme.text} border rounded-xl px-4 py-3 mb-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${theme.iconCls}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{headline}</span>
            {confidence != null && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/70 border border-current/20">
                confianza {Math.round(confidence * 100)}%
              </span>
            )}
            {meta?.format && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/70 border border-current/20">
                {FORMAT_LABEL[meta.format] || meta.format}
              </span>
            )}
          </div>

          <p className={`text-sm mt-0.5 ${theme.sub}`}>{detail}</p>

          {meta && (
            <p className={`text-xs mt-1 ${theme.sub} opacity-80`}>
              {[meta.fileName, meta.pages && `${meta.pages} páginas`, meta.parsedIn && `${meta.parsedIn} ms`]
                .filter(Boolean).join(" · ")}
            </p>
          )}

          {issues.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-2 text-sm font-medium inline-flex items-center gap-1 hover:underline"
              >
                {open ? "Ocultar detalle" : `Ver detalle (${issues.length})`}
                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {open && (
                <ul className="mt-2 space-y-1.5">
                  {[...fatal, ...warn].map((it, i) => (
                    <li key={i} className="text-sm flex gap-2">
                      <span
                        className={`shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full ${
                          it.sev === "fatal" ? "bg-red-500" : "bg-amber-500"
                        }`}
                      />
                      <span className={theme.sub}>{it.msg}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {onDismiss && level !== "fatal" && (
          <button type="button" onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// Does the parse have blocking problems? Use this to gate "Siguiente".
export function hasFatalIssues(quality) {
  return !!quality?.issues?.some((i) => i.sev === "fatal");
}