// components/FabricWH/FabricRollsUpload.jsx
// Almacén de Tela — Cargar la lista de rollos desde un Excel o CSV.
//
// The file is read in the browser (xlsx / xls with SheetJS, csv with the small
// parser below) and its cells go to POST /reception/import:
//   1. dryRun  → the server finds the header row and checks every required
//                column. Missing columns → the list of what is missing.
//                Otherwise a preview: new rolls, rolls already on the list…
//   2. confirm → the rolls go on the «por llegar» list and are checked off
//                with the normal scan in «Escanear rollos».
//
// Excel needs SheetJS:  npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
// (loaded only when an Excel file is chosen).
import { useState, useRef } from "react";
import {
  FileSpreadsheet, Upload, Download, AlertCircle, AlertTriangle, CheckCircle2, RotateCcw, ChevronDown,
} from "lucide-react";
import { post, num, cx, Modal, Button, Pill, notifyChange } from "./fabricShared";

// Must exist in the file (same names as the roll detail). Kept in the same
// order as IMPORT_COLUMNS in fabric-warehouse.js.
export const UPLOAD_REQUIRED = [
  "Rollo de tela", "Fabric name", "Color", "Lote", "Purchase order number", "Supplier", "Cliente",
  "Supplier Code", "Width", "Width Unit", "Weight", "Weight Unit", "Gramaje (g/m²)", "Composition",
  "Month Buy", "Fabric item number", "Tipo de tela", "Fecha de entrega", "Size", "Item SKU code",
  "Término de compra", "Importación", "Remarks",
];
// Read when present.
export const UPLOAD_OPTIONAL = ["Yardas", "Metros"];

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 3000;

const ACTION = {
  new: { label: "Nuevo", tone: "indigo" },
  update: { label: "Ya en la lista", tone: "slate" },
  rerequest: { label: "Vuelve a la lista", tone: "violet" },
  link: { label: "Sin solicitud · se completa", tone: "amber" },
  received: { label: "Ya recibido", tone: "emerald" },
  duplicate: { label: "Repetido", tone: "red" },
};

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------
function decodeText(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); } // CSV saved by Excel in Spanish
}

// RFC 4180 CSV with the delimiter detected from the header line (, ; tab |).
function parseCsv(input) {
  let text = input.replace(/^\uFEFF/, "");
  let sep = null;
  const sepLine = /^sep=(.)\r?\n/i.exec(text);
  if (sepLine) { sep = sepLine[1]; text = text.slice(sepLine[0].length); }
  if (!sep) {
    const first = (text.split(/\r?\n/).find((l) => l.trim()) || "").replace(/"[^"]*"/g, "");
    const count = (ch) => first.split(ch).length - 1;
    sep = [",", ";", "\t", "|"].reduce((a, b) => (count(b) > count(a) ? b : a), ",");
  }
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === "") { cell = ""; quoted = true; }
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => (v.trim() === "" ? null : v.trim())));
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cellValue = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : ymd(v);
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
};
const trimRow = (r) => { let n = r.length; while (n && r[n - 1] == null) n--; return r.slice(0, n); };

async function readSheets(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === "csv" || ext === "txt") {
    return [{ name: "CSV", firstRow: 1, rows: parseCsv(decodeText(buf)).map(trimRow) }];
  }
  let XLSX;
  try { XLSX = await import("xlsx"); }
  catch { throw new Error("Falta la librería para leer Excel en esta instalación. Guarde el archivo como CSV o instale «xlsx»."); }
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) return { name, firstRow: 1, rows: [] };
    // The real used range: Excel often reports formatted but empty rows/columns.
    const ref = XLSX.utils.decode_range(ws["!ref"]);
    let maxR = -1;
    let maxC = -1;
    for (const k of Object.keys(ws)) {
      if (k[0] === "!") continue;
      const c = ws[k];
      if (c == null || c.v == null || c.v === "") continue;
      const a = XLSX.utils.decode_cell(k);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    }
    if (maxR < 0) return { name, firstRow: 1, rows: [] };
    if (maxR - ref.s.r > MAX_ROWS + 50) {
      return { name, firstRow: ref.s.r + 1, rows: [], tooBig: maxR - ref.s.r };
    }
    const range = { s: ref.s, e: { r: maxR, c: Math.min(maxC, ref.s.c + 200) } };
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range })
      .map((r) => trimRow(r.map(cellValue)));
    return { name, firstRow: ref.s.r + 1, rows };
  });
}

function downloadTemplate() {
  const cols = [...UPLOAD_REQUIRED, ...UPLOAD_OPTIONAL];
  const line = cols.map((c) => (/[",;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
  const blob = new Blob(["\uFEFF" + line + "\r\n"], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "plantilla-rollos-tela.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
export default function FabricRollsUpload({ open, onClose, onDone }) {
  const inputRef = useRef(null);
  const [stage, setStage] = useState("pick");  // pick | reading | missing | preview | saving
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [result, setResult] = useState(null);  // dry run answer
  const [missing, setMissing] = useState(null); // { missing, found, headerRow, sheet }
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const [showCols, setShowCols] = useState(false);

  const reset = () => {
    setStage("pick"); setFile(null); setSheets([]); setSheetIdx(0);
    setResult(null); setMissing(null); setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };
  const close = () => { if (stage === "saving") return; reset(); onClose(); };

  const check = async (f, list, idx) => {
    const sh = list[idx];
    setStage("reading"); setError(null); setMissing(null); setResult(null);
    if (sh.tooBig) {
      setError(`La hoja «${sh.name}» tiene ${num(sh.tooBig)} renglones. El máximo es ${num(MAX_ROWS)} rollos por archivo; divídalo en varios.`);
      setStage("pick");
      return;
    }
    try {
      const d = await post("/reception/import", { fileName: f.name, firstRow: sh.firstRow, rows: sh.rows, dryRun: true });
      setResult(d);
      setStage("preview");
    } catch (e) {
      if (e.data?.code === "missing_columns") {
        setMissing({ missing: e.data.missing || [], found: e.data.found || [], headerRow: e.data.headerRow, sheet: sh.name });
        setStage("missing");
      } else {
        setError(e.message);
        setStage("pick");
      }
    }
  };

  const choose = async (f) => {
    if (!f) return;
    setError(null);
    if (!/\.(xlsx|xlsm|xls|csv|txt)$/i.test(f.name)) { setError("Elija un archivo de Excel (.xlsx, .xls) o CSV."); return; }
    if (f.size > MAX_BYTES) { setError("El archivo pesa más de 15 MB."); return; }
    setFile(f);
    setStage("reading");
    try {
      const list = await readSheets(f);
      const first = Math.max(0, list.findIndex((s) => s.rows.length || s.tooBig));
      if (!list.some((s) => s.rows.length || s.tooBig)) { setError("El archivo está vacío."); setStage("pick"); return; }
      setSheets(list);
      setSheetIdx(first);
      await check(f, list, first);
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo.");
      setStage("pick");
    }
  };

  const pickSheet = (i) => { setSheetIdx(i); check(file, sheets, i); };

  const save = async () => {
    const sh = sheets[sheetIdx];
    setStage("saving");
    try {
      const d = await post("/reception/import", { fileName: file.name, firstRow: sh.firstRow, rows: sh.rows, dryRun: false });
      notifyChange();
      onDone?.(d);
      reset();
      onClose();
    } catch (e) {
      setError(e.message);
      setStage("preview");
    }
  };

  const c = result?.counts || {};
  const usable = result ? result.total - (c.duplicate || 0) : 0;
  const sheetPicker = sheets.length > 1 && (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Hoja
      <select value={sheetIdx} onChange={(e) => pickSheet(Number(e.target.value))} disabled={stage === "reading" || stage === "saving"}
        className="rounded-lg ring-1 ring-inset ring-slate-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
        {sheets.map((s, i) => <option key={s.name + i} value={i}>{s.name}</option>)}
      </select>
    </label>
  );

  const footer = stage === "preview" || stage === "saving" ? (
    <>
      <Button variant="secondary" icon={RotateCcw} onClick={reset} disabled={stage === "saving"}>Otro archivo</Button>
      <Button icon={Upload} loading={stage === "saving"} disabled={!usable} onClick={save}>
        Cargar {num(usable)} rollo(s)
      </Button>
    </>
  ) : stage === "missing" ? (
    <>
      <Button variant="secondary" icon={Download} onClick={downloadTemplate}>Descargar plantilla</Button>
      <Button icon={RotateCcw} onClick={reset}>Elegir otro archivo</Button>
    </>
  ) : (
    <Button variant="secondary" onClick={close}>Cancelar</Button>
  );

  return (
    <Modal open={open} onClose={close} title="Cargar lista de rollos (Excel o CSV)" size="xl" footer={footer}>
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 ring-1 ring-red-200 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {(stage === "pick" || stage === "reading") && (
          <>
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}
              className={cx("flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors",
                drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50",
                stage === "reading" && "pointer-events-none opacity-70")}
            >
              <FileSpreadsheet className="w-10 h-10 text-indigo-500" />
              <span className="text-base font-semibold text-slate-900">
                {stage === "reading" ? `Revisando ${file?.name || "el archivo"}…` : "Elija o arrastre el archivo aquí"}
              </span>
              <span className="text-sm text-slate-500">Excel (.xlsx, .xls) o CSV · hasta {num(MAX_ROWS)} rollos</span>
              <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt" className="sr-only"
                onChange={(e) => choose(e.target.files?.[0])} />
            </label>

            <div className="rounded-xl ring-1 ring-slate-200">
              <button type="button" onClick={() => setShowCols((v) => !v)} aria-expanded={showCols}
                className="w-full px-4 py-3 flex items-center gap-2 text-left text-sm">
                <span className="font-medium text-slate-800 flex-1">El archivo debe tener estas {UPLOAD_REQUIRED.length} columnas</span>
                <ChevronDown className={cx("w-4 h-4 text-slate-400 transition-transform", showCols && "rotate-180")} />
              </button>
              {showCols && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {UPLOAD_REQUIRED.map((c) => <span key={c} className="text-xs rounded-md bg-slate-100 text-slate-700 px-2 py-1">{c}</span>)}
                  </div>
                  <p className="text-xs text-slate-500">
                    {UPLOAD_OPTIONAL.join(" y ")} se leen si vienen. Las celdas pueden ir vacías; lo que no puede faltar es la columna.
                    Un renglón por rollo.
                  </p>
                  <Button size="sm" variant="secondary" icon={Download} onClick={downloadTemplate}>Descargar plantilla CSV</Button>
                </div>
              )}
            </div>
          </>
        )}

        {stage === "missing" && missing && (
          <div className="space-y-4">
            <div className="rounded-xl bg-red-50 ring-1 ring-red-200 p-4">
              <div className="flex items-start gap-2 text-red-800">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div>
                  <div className="font-semibold">
                    Faltan {missing.missing.length} columna(s) en «{file?.name}»{sheets.length > 1 ? ` (hoja ${missing.sheet})` : ""}
                  </div>
                  <div className="text-sm mt-0.5">
                    No se cargó ningún rollo. Agregue estas columnas con el mismo nombre y vuelva a cargar el archivo.
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {missing.missing.map((m) => (
                  <span key={m} className="text-sm rounded-md bg-white text-red-700 ring-1 ring-red-300 px-2 py-0.5 font-medium">{m}</span>
                ))}
              </div>
            </div>
            {sheetPicker}
            {missing.found.length > 0 && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1.5">
                  Columnas que sí tiene el archivo{missing.headerRow ? ` (fila ${missing.headerRow})` : ""}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {missing.found.slice(0, 60).map((f, i) => (
                    <span key={f + i} className="text-xs rounded-md bg-slate-100 text-slate-600 px-2 py-1">{f}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(stage === "preview" || stage === "saving") && result && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{file?.name}</div>
                  <div className="text-xs text-slate-500">
                    Todas las columnas están · encabezados en la fila {result.headerRow} · {num(result.total)} rollo(s) · {num(result.yards, 1)} yd
                  </div>
                </div>
              </div>
              {sheetPicker}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <CountTile n={c.new} label="Nuevos en la lista" tone="indigo" />
              <CountTile n={(c.update || 0) + (c.rerequest || 0)} label="Ya estaban · se actualizan" tone="slate" />
              <CountTile n={c.link} label="Escaneados sin solicitud · se completan" tone="amber" />
              <CountTile n={c.received} label="Ya recibidos · solo datos vacíos" tone="emerald" />
            </div>

            {(result.errorCount > 0 || result.duplicates?.length > 0) && (
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-sm text-amber-900 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4" />
                  {result.errorCount > 0 && `${result.errorCount} renglón(es) no se cargan`}
                  {result.errorCount > 0 && result.duplicates?.length > 0 && " · "}
                  {result.duplicates?.length > 0 && `${result.duplicates.length} rollo(s) repetidos (se toma el primero)`}
                </div>
                <ul className="text-xs space-y-0.5 max-h-28 overflow-y-auto">
                  {result.errors.slice(0, 30).map((e) => (
                    <li key={`e${e.row}`}>Fila {e.row}{e.roll_no ? ` · ${e.roll_no}` : ""}: {e.error}</li>
                  ))}
                  {result.duplicates.slice(0, 30).map((d) => (
                    <li key={`d${d.row}`}>Fila {d.row} · {d.roll_no}: repetido{d.first ? ` (fila ${d.first})` : ""}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
              <div className="max-h-[38vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
                    <tr>
                      {["Fila", "Rollo", "PO", "Tela · color", "Lote", "Yardas", ""].map((h, i) => (
                        <th key={i} className={cx("px-3 py-2 font-medium whitespace-nowrap", h === "Yardas" ? "text-right" : "text-left")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.preview.map((p) => (
                      <tr key={p.row}>
                        <td className="px-3 py-2 text-xs text-slate-400 fab-tnum">{p.row}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-900 whitespace-nowrap">{p.roll_no}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{p.po_number || "—"}</td>
                        <td className="px-3 py-2 max-w-[220px] truncate">{p.fabric_name || "—"} <span className="text-slate-400">· {p.color || "—"}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap">{p.lot || "—"}</td>
                        <td className="px-3 py-2 text-right fab-tnum">{p.yards != null ? num(p.yards, 1) : "—"}</td>
                        <td className="px-3 py-2 text-right"><Pill tone={ACTION[p.action]?.tone}>{ACTION[p.action]?.label || p.action}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.total > result.preview.length && (
                <div className="px-3 py-2 text-xs text-slate-500 border-t border-slate-100">
                  Se muestran {result.preview.length} de {num(result.total)} rollos.
                </div>
              )}
            </div>

            <p className="text-sm text-slate-600">
              Al cargar, los rollos quedan en la lista por llegar. Después escanee cada rollo como siempre para marcar su llegada.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CountTile({ n = 0, label, tone }) {
  const t = {
    indigo: "bg-indigo-50 text-indigo-900", slate: "bg-slate-50 text-slate-800",
    amber: "bg-amber-50 text-amber-900", emerald: "bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div className={cx("rounded-xl px-3 py-2.5", t, !n && "opacity-50")}>
      <div className="text-2xl font-bold fab-tnum leading-tight">{num(n)}</div>
      <div className="text-xs leading-snug">{label}</div>
    </div>
  );
}