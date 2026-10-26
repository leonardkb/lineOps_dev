import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Ruler,
  Scissors,
  Palette,
  Boxes,
  Send,
  Plus,
  Trash2,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  FileText,
  Shirt,
  Tag,
  Upload,
  FileSpreadsheet,
  X,
  FileUp,
  Save,
  RefreshCw,
  ClipboardCheck,
  ClipboardList,
  Camera,
  ImagePlus,
  ImageOff,
  Hash,
  Search,
  Calculator,
  Lock,
  ArrowRight,
  ShoppingCart,
} from "lucide-react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import { API_URL, TIPOS, MODELOS, SEGMENTS } from "../../lib/masterCodeCatalog";
import { SendToSampleModal, ConvertToPreOrderModal, SendToPurchasingModal, STYLE_STATUS } from "./StyleActionModals";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

/* ==========================================================================
   Style Data — one place to create a style

     1. Número de estilo  – tipo · modelo · correlativo (auto) + cliente, SAM
     2. BOM               – telas (del catálogo de telas: consumo de sala de
                            muestras, ancho, PO de compra), avíos y empaque
                            (con código de catálogo por tipo: CIE001, CAJ001…)
     3. Tallas            – tabla de especificación (POM)
     4. Confección        – workmanship
     5. Colorway          – colorways + color de cada material por colorway
     6. Imagen            – foto del estilo + fotos de referencia
     →  Completar creación del estilo
        luego: Enviar a muestras · Costeo del estilo · Convertir a pre-orden
        (la pre-orden aparece en la pestaña de pre-órdenes → Convertir a PO)

   The tech pack PDF / xlsx imports still auto-fill every step.
   ======================================================================== */

// ---- reference data -------------------------------------------------------
const SIZES = ["2XS", "XS", "S", "M", "L", "XL", "XXL", "S-T", "M-T", "L-T", "XL-T", "2XL-T"];

const FABRIC_POSITIONS = ["Cuerpo", "Manga", "Inserto axila", "Vista de cuello", "Refuerzo"];
const MACHINES = [
  "Overlock 4 hilos (#514)",
  "Overlock 3 hilos (#504)",
  "Cadeneta 1 aguja (#401)",
  "Recubridora 3 agujas (#602)",
  "Recubridora 2 agujas (#406)",
  "Plana 1 aguja",
  "Prensa de calor",
  "Manual",
];
const CRITICALITY = ["Crítica", "Crítica seguridad", "Mayor", "Menor"];

const uid = () => Math.random().toString(36).slice(2);
const num = (n, d = 2) =>
  (Number.isFinite(+n) ? +n : 0).toLocaleString("es-MX", { maximumFractionDigits: d });

// Units allowed on BOM lines (fabric yield, trims, packaging).
const UNITS = ["pzs", "unid", "mts", "yds", "kg"];
const FABRIC_UNITS = ["mts", "yds", "kg"];
// Old orders / tech packs use pza, m, yd… — fold them onto the BOM units.
const normUnit = (u, fallback = "pzs") => {
  const v = String(u || "").trim().toLowerCase();
  if (!v) return fallback;
  if (/^(pza|pzas|pz|pc|pcs|pieza|piezas|pzs)$/.test(v)) return "pzs";
  if (/^(u|un|und|unid|unidad|unidades|units?)$/.test(v)) return "unid";
  if (/^(m|mt|mts|metro|metros)$/.test(v)) return "mts";
  if (/^(yd|yds|yarda|yardas)$/.test(v)) return "yds";
  if (/^(kg|kgs|kilo|kilos)$/.test(v)) return "kg";
  return v;
};

// ---- empty style ----------------------------------------------------------
const EMPTY_HEADER = {
  customer: "", customerId: null, clienteCode: "",
  styleNo: "", styleName: "", description: "", season: "", samMinutes: "",
  // legacy header fields kept so older orders / the tech pack round-trip
  orderNo: "", version: "", quantity: "", orderDate: "", deliveryDate: "", patternMaker: "", factory: "",
};
const emptyFabric = () => ({ key: uid(), fabricId: null, code: "", name: "", position: "Cuerpo", yield: "", yieldUnit: "mts", width: "", supplier: "", po: "", composition: "", weight: "" });
const emptyItem = () => ({ key: uid(), materialId: null, code: "", clientCode: "", name: "", typeCode: "", placement: "", consumption: "", unit: "pzs", supplier: "", po: "" });
const CATALOG_CODE = /^[A-Z]{3}\d{3}$/;

// ==========================================================================
//  Import: parse an uploaded workbook and map it onto the wizard
//  Client-side (SheetJS). Tuned to the size-set and sample-request layouts,
//  with a generic fallback. Best-effort — the user reviews the result.
// ==========================================================================
const normSize = (s) =>
  String(s || "").toUpperCase().trim().replace(/\s+/g, "").replace(/\//g, "-");
const SIZE_LOOKUP = (() => {
  const m = {};
  SIZES.forEach((s) => (m[normSize(s)] = s));
  m["2XL"] = m["2XL"] || "XXL"; // files often say 2XL for XXL
  return m;
})();
const mapCrit = (v) => {
  const s = String(v || "").toLowerCase();
  if (s.includes("safety")) return "Crítica seguridad";
  if (s.includes("critical") || s.includes("crít")) return "Crítica";
  if (s.includes("minor") || s.includes("menor")) return "Menor";
  return "Mayor";
};

async function readWorkbook(file) {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return XLSX.read(text, { type: "string" });
  }
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array" });
}
// pick the sheet with the most rows; return array-of-arrays
function sheetRows(wb) {
  let best = [];
  wb.SheetNames.forEach((n) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: "" });
    if (rows.length > best.length) best = rows;
  });
  return best;
}

// --- size spec ---
function parseSizeSpec(rows) {
  const norm = (v) => String(v ?? "").trim();
  const sizeColsAt = (cells) => {
    const map = {};
    cells.forEach((c, ci) => {
      const key = SIZE_LOOKUP[normSize(c)];
      if (key && !(key in map)) map[key] = ci;
    });
    return map;
  };
  let hIdx = -1;
  let sizeCols = null;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(norm);
    const sizeMap = sizeColsAt(cells);
    const joined = cells.join(" ").toLowerCase();
    const looksHeader = /meas|point of measurement|c[oó]digo|punto de medida/.test(joined);
    if (Object.keys(sizeMap).length >= 2 && looksHeader) {
      hIdx = i;
      sizeCols = sizeMap;
      break;
    }
  }
  if (hIdx < 0) {
    for (let i = 0; i < rows.length; i++) {
      const map = sizeColsAt(rows[i].map(norm));
      if (Object.keys(map).length >= 3) {
        hIdx = i;
        sizeCols = map;
        break;
      }
    }
  }
  if (hIdx < 0) throw new Error("No reconocí la tabla de tallas. ¿Es el archivo de size spec?");

  const header = rows[hIdx].map((c) => norm(c).toLowerCase());
  const find = (re) => header.findIndex((c) => re.test(c));
  const codeCol = find(/meas.?\s*code|c[oó]digo|^code$/);
  const nameCol = find(/point of measurement|punto de medida|\bname\b|descrip/);
  const tMinusCol = find(/tolerance.*-|tol.*\(-|tol.*menos/);
  const tPlusCol = find(/tolerance.*\+|tol.*\(\+|tol.*m[aá]s/);
  const critCol = find(/criticality|criticidad/);

  const out = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const cells = rows[i].map(norm);
    const code = codeCol >= 0 ? cells[codeCol] : "";
    const name = nameCol >= 0 ? cells[nameCol] : "";
    const vals = {};
    Object.entries(sizeCols).forEach(([sz, ci]) => {
      const v = cells[ci];
      if (v !== "" && !isNaN(Number(v))) vals[sz] = String(v);
    });
    if (!code && Object.keys(vals).length === 0) continue; // skip section titles / blanks
    out.push({
      key: uid(),
      code,
      name,
      how: "",
      crit: critCol >= 0 ? mapCrit(cells[critCol]) : "Mayor",
      tMinus: tMinusCol >= 0 ? cells[tMinusCol] : "",
      tPlus: tPlusCol >= 0 ? cells[tPlusCol] : "",
      vals,
    });
  }
  if (!out.length) throw new Error("Encontré la tabla pero sin filas de medidas legibles.");
  return out;
}

// --- materials (fabric + trims) — sample-request layout, generic fallback ---
function parseMaterials(rows) {
  const norm = (v) => String(v ?? "").trim();
  const lc = (v) => norm(v).toLowerCase();
  const rowText = (r) => r.map(lc).join(" ");
  const colOf = (header, res) => {
    const h = header.map(lc);
    for (const re of res) {
      const i = h.findIndex((c) => re.test(c));
      if (i >= 0) return i;
    }
    return -1;
  };

  const shellIdx = rows.findIndex((r) => /shell fabric|布料|nombre de tela/.test(rowText(r)));
  const trimsIdx = rows.findIndex((r) => /^\s*trims\s*$|副料|av[ií]os/.test(rowText(r)));
  const fabrics = [];
  const trims = [];

  if (shellIdx >= 0) {
    // fabric header = first row after shell marker that has 'fabric' + width/position
    let fh = -1;
    for (let i = shellIdx + 1; i < rows.length; i++) {
      const t = rowText(rows[i]);
      if (/fabric/.test(t) && /(cut-?width|width|position|posici)/.test(t)) { fh = i; break; }
      if (/^\s*trims\s*$/.test(t)) break;
    }
    if (fh >= 0) {
      const H = rows[fh];
      const codeC = colOf(H, [/fabric/, /c[oó]digo|code/]);
      const widC = colOf(H, [/cut-?width|width|ancho/]);
      const posC = colOf(H, [/position|posici/]);
      const colC = colOf(H, [/color/]);
      const stop = trimsIdx > fh ? trimsIdx : rows.length;
      for (let i = fh + 1; i < stop; i++) {
        const c = rows[i].map(norm);
        const code = codeC >= 0 ? c[codeC] : "";
        if (!code || /trims/i.test(code)) continue;
        fabrics.push({
          key: uid(),
          code,
          position: posC >= 0 ? c[posC] || "Cuerpo" : "Cuerpo",
          composition: "",
          width: widC >= 0 ? c[widC] : "",
          weight: "",
          fabricNo: "",
          note: colC >= 0 && c[colC] ? `Color: ${c[colC]}` : "",
        });
      }
    }
  }

  if (trimsIdx >= 0) {
    let th = -1;
    for (let i = trimsIdx; i < rows.length; i++) {
      const t = rowText(rows[i]);
      if (/item|c[oó]digo|código/.test(t) && /description|descrip|position/.test(t)) { th = i; break; }
    }
    if (th >= 0) {
      const H = rows[th];
      const itemC = colOf(H, [/^item$|item|c[oó]digo|code/]);
      const descC = colOf(H, [/description|descrip/]);
      const posC = colOf(H, [/position|posici|placement/]);
      const qtyC = colOf(H, [/qty|cant|usage|consumo/]);
      const supC = colOf(H, [/supplier|proveedor|remark/]);
      for (let i = th + 1; i < rows.length; i++) {
        const c = rows[i].map(norm);
        const code = itemC >= 0 ? c[itemC] : "";
        const desc = descC >= 0 ? c[descC] : "";
        if (!code && !desc) continue;
        trims.push({
          key: uid(),
          code,
          desc: desc || code,
          spec: posC >= 0 ? c[posC] : "",
          consumption: qtyC >= 0 ? c[qtyC] : "",
          unit: "pza",
          supplier: supC >= 0 ? c[supC] : "",
        });
      }
    }
  }

  // generic fallback: a single header row with code + description-ish columns
  if (!fabrics.length && !trims.length) {
    const h = rows.findIndex(
      (r) => /c[oó]digo|code|item/.test(rowText(r)) && /descrip|description|material|proveedor|supplier/.test(rowText(r))
    );
    if (h < 0) throw new Error("No reconocí columnas de materiales. Revisa que sea el BOM o el Sample Request.");
    const H = rows[h];
    const codeC = colOf(H, [/c[oó]digo|code|item/]);
    const descC = colOf(H, [/descrip|description|material/]);
    const supC = colOf(H, [/proveedor|supplier/]);
    const qtyC = colOf(H, [/consumo|usage|qty|cant/]);
    for (let i = h + 1; i < rows.length; i++) {
      const c = rows[i].map(norm);
      const code = codeC >= 0 ? c[codeC] : "";
      const desc = descC >= 0 ? c[descC] : "";
      if (!code && !desc) continue;
      trims.push({ key: uid(), code, desc: desc || code, spec: "", consumption: qtyC >= 0 ? c[qtyC] : "", unit: "pza", supplier: supC >= 0 ? c[supC] : "" });
    }
  }

  if (!fabrics.length && !trims.length) throw new Error("El archivo no traía materiales legibles.");
  return { fabrics, trims };
}

// ==========================================================================
//  Reusable primitives (match the app: slate cards, rounded-xl, SectionCard)
// ==========================================================================
function SectionCard({ icon: Icon, title, subtitle, right, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800 truncate">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400";
const cellCls =
  "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400";
// Same look without w-full, for inputs that set their own width in a flex row
// (w-full plus w-24 on one element conflict and the row stacks).
const cellBase = cellCls.replace("w-full ", "");

// Generic editable table (rows of objects). columns: {key,label,type,width,options,align}
function EditableTable({ columns, rows, onChange, onAdd, addLabel = "Agregar", minRows = 0 }) {
  const patch = (key, field, value) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const remove = (key) =>
    onChange(rows.length > minRows ? rows.filter((r) => r.key !== key) : rows);
  const duplicate = (key) => {
    const i = rows.findIndex((r) => r.key === key);
    if (i < 0) return;
    onChange([...rows.slice(0, i + 1), { ...rows[i], key: uid() }, ...rows.slice(i + 1)]);
  };

  return (
    <>
      <div className="overflow-x-auto max-w-full">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-[11px] font-medium text-slate-400">
              {columns.map((c) => (
                <th key={c.key} className="px-1 pb-2 whitespace-nowrap" style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className="px-1 pb-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="align-top">
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    {c.type === "select" ? (
                      <select
                        value={r[c.key] ?? ""}
                        onChange={(e) => patch(r.key, c.key, e.target.value)}
                        className={cellCls}
                      >
                        {(c.options || []).map((o) => (
                          <option key={o.value ?? o} value={o.value ?? o}>
                            {o.label ?? o}
                          </option>
                        ))}
                      </select>
                    ) : c.type === "textarea" ? (
                      <textarea
                        rows={c.rows || 3}
                        value={r[c.key] ?? ""}
                        onChange={(e) => patch(r.key, c.key, e.target.value)}
                        className={`${cellCls} resize-y leading-snug`}
                      />
                    ) : c.type === "check" ? (
                      <button
                        type="button"
                        onClick={() => patch(r.key, c.key, !r[c.key])}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${
                          r[c.key]
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-300"
                        }`}
                      >
                        <Check size={14} />
                      </button>
                    ) : (
                      <input
                        type={c.type === "number" ? "number" : "text"}
                        step={c.type === "number" ? "any" : undefined}
                        value={r[c.key] ?? ""}
                        onChange={(e) => patch(r.key, c.key, e.target.value)}
                        className={`${cellCls} ${c.align === "right" ? "text-right" : ""} ${
                          c.mono ? "font-mono" : ""
                        }`}
                      />
                    )}
                  </td>
                ))}
                <td className="px-1 py-1">
                  <div className="flex items-center gap-1 pt-0.5">
                    <button
                      onClick={() => duplicate(r.key)}
                      title="Duplicar"
                      className="p-1 text-slate-300 hover:text-slate-600"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => remove(r.key)}
                      title="Quitar"
                      className="p-1 text-slate-300 hover:text-rose-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={onAdd}
        className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <Plus size={15} /> {addLabel}
      </button>
    </>
  );
}

// File drop target for imports.
function DropInput({ label, hint, onFile, status, accept = ".xlsx,.xls,.csv", icon: Ico = FileSpreadsheet, busy = false }) {
  const border =
    status?.ok === true
      ? "border-emerald-300 bg-emerald-50"
      : status?.ok === false
      ? "border-rose-300 bg-rose-50"
      : "border-slate-300 bg-slate-50 hover:border-slate-400";
  return (
    <label className="block cursor-pointer">
      <div className={`flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition-all ${border}`}>
        <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
          {busy ? (
            <RefreshCw size={18} className="text-slate-400 animate-spin" />
          ) : status?.ok === true ? (
            <Check size={18} className="text-emerald-600" />
          ) : status?.ok === false ? (
            <X size={18} className="text-rose-500" />
          ) : (
            <Ico size={18} className="text-slate-400" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-700">{label}</div>
          <div className={`text-[11px] truncate ${status?.ok === false ? "text-rose-600" : "text-slate-400"}`}>
            {status?.msg || hint || "Haz clic para elegir un archivo"}
          </div>
        </div>
        <Upload size={16} className="ml-auto text-slate-300 shrink-0" />
      </div>
      <input type="file" accept={accept} className="hidden" onChange={onFile} />
    </label>
  );
}

// Parse a "013:00A BLACK  101:10A WHITE" note/spec string into { cw: color }.
function parseCwColors(str) {
  const out = {};
  String(str || "")
    .split(/\s{2,}/)
    .forEach((p) => {
      const i = p.indexOf(":");
      if (i > 0) {
        const cw = p.slice(0, i).trim();
        const val = p.slice(i + 1).replace(/\s*Colorway \d+\/\d+/g, "").replace(/\bNOCOLR\b/g, "").trim();
        if (/^\d{3}$/.test(cw) && val) out[cw] = val;
      }
    });
  return out;
}
const cwSwatch = (name) => {
  const n = (name || "").toUpperCase();
  const map = { BLACK: "#111827", WHITE: "#f9fafb", MNNAVY: "#1e3a5f", NAVY: "#1e3a5f", "G MIST": "#9fb8ad", GRNGLW: "#b6e800", GREEN: "#22c55e", SNDRFT: "#d8cdb8", RDBARK: "#7c3a2d", BQBN: "#3b4a5a", FBRGLS: "#c9b98f", "LT OLV": "#8a8a5c", HYPRYL: "#5b6ee1", BLLEGN: "#2b3a67", ORCHID: "#b25fa6", CHLGRD: "#c0392b", CHLG: "#c0392b", PLYPNK: "#f4a6c0", SMKGRY: "#8b8b8b", RED: "#c0392b", PINK: "#f4a6c0" };
  for (const k in map) if (n.includes(k)) return map[k];
  return "#cbd5e1";
};

// Materials × colorway grid — one row per material, one column per colorway.
// Group imported per-variant trims into grid rows: one row per code+color, with
// quantities spread across the size columns (size taken from the variant).
// ---- QC photo board: multi-upload straight to S3 + a comment per photo -----
// Photos appear immediately (optimistic) with a local preview so you can start
// writing the comment right away; each one uploads to S3 in the background and
// shows its own status (subiendo / listo / error con reintento). We persist
// { s3Key, name, comment } once the upload succeeds; `url`/`status` are transient.
function QualityPhotoBoard({ photos, onChange, onToast }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const fileMap = useRef({}); // photo.key -> File (kept so "Reintentar" can re-send)

  const patch = (key, fields) => onChange((prev) => prev.map((p) => (p.key === key ? { ...p, ...fields } : p)));

  const uploadOne = async (key, file) => {
    patch(key, { status: "uploading", error: null });
    // Derive a content-type the backend accepts even when file.type is empty.
    const extType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif" };
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    const contentType = file.type || extType[ext] || "image/jpeg";
    try {
      console.log("[QC] pidiendo URL de subida →", `${API_URL}/api/style-orders/photo-upload-url`, { filename: file.name, contentType });
      // 1) presigned PUT URL for this image
      const up = await fetch(`${API_URL}/api/style-orders/photo-upload-url`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      let upData;
      try { upData = await up.json(); } catch { throw new Error("El servidor no respondió con la URL de subida (¿backend desplegado?)"); }
      console.log("[QC] respuesta upload-url:", up.status, upData);
      if (!up.ok || !upData.success) throw new Error(upData.error || "No se pudo iniciar la subida");
      // 2) upload the bytes straight to S3
      console.log("[QC] subiendo a S3 (PUT)…", upData.key);
      const putRes = await fetch(upData.url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      console.log("[QC] respuesta PUT S3:", putRes.status, putRes.ok);
      if (!putRes.ok) throw new Error(`S3 rechazó la subida (HTTP ${putRes.status}). Revisa CORS del bucket.`);
      patch(key, { status: "done", s3Key: upData.key });
      delete fileMap.current[key];
    } catch (err) {
      console.error("[QC] error subiendo foto:", err);
      patch(key, { status: "error", error: err.message });
      onToast?.(err.message);
    }
  };

  const addFiles = (fileList) => {
    const all = Array.from(fileList || []);
    // Some browsers/OS report an empty file.type (e.g. HEIC on Windows), so
    // fall back to matching the extension instead of dropping the file.
    const isImage = (f) => (f.type || "").startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(f.name || "");
    const files = all.filter(isImage);
    console.log("[QC] archivos elegidos:", all.length, "· imágenes válidas:", files.length, "· API_URL:", API_URL, "· tipos:", all.map((f) => f.type || "(vacío)"));
    if (!files.length) {
      if (all.length) onToast?.("El archivo no parece una imagen (usa JPG, PNG, WEBP o HEIC).");
      return;
    }
    const tiles = files.map((file) => {
      const key = uid();
      fileMap.current[key] = file;
      return { key, name: file.name, comment: "", at: new Date().toISOString(), url: URL.createObjectURL(file), status: "uploading" };
    });
    onChange((prev) => [...(prev || []), ...tiles]); // show them right away
    tiles.forEach((t) => uploadOne(t.key, fileMap.current[t.key]));
  };

  const onPick = (e) => {
    // Copy the files out BEFORE clearing value — e.target.files is a live list,
    // and resetting value empties it, which would drop the selection.
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow picking the same file again later
    addFiles(files);
  };
  const retry = (key) => { const f = fileMap.current[key]; if (f) uploadOne(key, f); };
  const setComment = (key, comment) => patch(key, { comment });
  const remove = (key) => {
    const p = photos.find((x) => x.key === key);
    if (p?.url?.startsWith("blob:")) URL.revokeObjectURL(p.url);
    delete fileMap.current[key];
    onChange((prev) => prev.filter((x) => x.key !== key));
  };

  const uploading = photos.some((p) => p.status === "uploading");

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />

      {/* dropzone — always available; each pick appends more photos */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
          drag ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <ImagePlus size={22} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-600">Toca para tomar o subir fotos</span>
        <span className="text-[11px] text-slate-400">JPG, PNG, WEBP o HEIC · se suben directo a S3 · puedes seleccionar varias</span>
      </div>

      {photos.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {photos.map((p) => (
              <div key={p.key} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="relative aspect-video bg-slate-100">
                  {p.url ? (
                    <img src={p.url} alt={p.name || "Foto de calidad"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-300">
                      <ImageOff size={22} />
                      <span className="text-[10px] text-slate-400">Vista previa no disponible</span>
                    </div>
                  )}

                  {/* uploading overlay */}
                  {p.status === "uploading" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-white">
                      <RefreshCw size={20} className="animate-spin" />
                      <span className="text-[11px] font-medium">Subiendo…</span>
                    </div>
                  )}
                  {/* error overlay with retry */}
                  {p.status === "error" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-rose-900/70 px-3 text-center text-white">
                      <AlertCircle size={20} />
                      <span className="text-[10px] leading-tight">{p.error || "No se pudo subir"}</span>
                      <button onClick={() => retry(p.key)} className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-white">
                        <RefreshCw size={12} /> Reintentar
                      </button>
                    </div>
                  )}
                  {/* done badge */}
                  {p.status !== "uploading" && p.status !== "error" && (
                    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
                      <Check size={11} /> En S3
                    </span>
                  )}

                  <button
                    onClick={() => remove(p.key)}
                    title="Quitar foto"
                    className="absolute top-2 right-2 rounded-full bg-black/55 p-1.5 text-white hover:bg-rose-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="p-3">
                  <textarea
                    value={p.comment || ""}
                    onChange={(e) => setComment(p.key, e.target.value)}
                    rows={2}
                    placeholder="Comentario de calidad (defecto, punto a revisar, aprobación…)"
                    className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-slate-400"
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="truncate pr-2">{p.name || "—"}</span>
                    {p.at && <span className="shrink-0">{new Date(p.at).toLocaleDateString("es-MX")}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* add-more button under the grid */}
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
          >
            <ImagePlus size={16} /> Agregar más fotos
            {uploading && <RefreshCw size={13} className="animate-spin text-slate-400" />}
          </button>
        </>
      )}
    </div>
  );
}

// ---- steps ----------------------------------------------------------------
const STEPS = [
  { id: "estilo", n: 1, label: "Número de estilo", sub: "Tipo · modelo · correlativo", icon: Hash },
  { id: "bom", n: 2, label: "BOM", sub: "Telas, avíos y empaque", icon: Layers },
  { id: "tallas", n: 3, label: "Tallas", sub: "Tabla de especificación", icon: Ruler },
  { id: "confeccion", n: 4, label: "Confección", sub: "Workmanship", icon: Scissors },
  { id: "colorway", n: 5, label: "Colorway", sub: "Colores por material", icon: Palette },
  { id: "imagen", n: 6, label: "Imagen", sub: "Foto del estilo", icon: Camera },
  { id: "completar", n: 7, label: "Completar estilo", sub: "Revisar y crear", icon: ClipboardCheck },
];

const segColor = (key) => SEGMENTS?.find?.((s) => s.key === key)?.color || "text-slate-800";

// ==========================================================================
//  Mapping: tech pack / saved order  →  Style Data state
// ==========================================================================
// Old orders and parsed tech packs carry the material lists in their legacy
// shapes (trimMaterials, garmentTrims, packingTrims). Fold them into the BOM
// lines; codes that already look like catalog codes (CIE001) stay as `code`,
// anything else is kept as the client/supplier reference in `clientCode`.
function toItem(t, extra = {}) {
  const raw = String(t.code || "").trim();
  const isCat = CATALOG_CODE.test(raw.toUpperCase());
  return {
    ...emptyItem(),
    key: t.key || uid(),
    materialId: t.materialId ?? null,
    code: t.clientCode !== undefined ? (t.code || "") : isCat ? raw.toUpperCase() : "",
    clientCode: t.clientCode !== undefined ? (t.clientCode || "") : isCat ? "" : raw,
    name: t.name || t.desc || "",
    typeCode: t.typeCode || (isCat ? raw.slice(0, 3).toUpperCase() : ""),
    placement: t.placement || "",
    consumption: String(t.consumption ?? t.qty ?? ""),
    unit: normUnit(t.unit),
    supplier: t.supplier || "",
    po: t.po || "",
    cwSpec: t.cwSpec ?? t.spec ?? "",
    ...extra,
  };
}
function toFabric(f) {
  return {
    ...emptyFabric(),
    key: f.key || uid(),
    fabricId: f.fabricId ?? null,
    code: f.code || "",
    name: f.name || f.composition || "",
    position: f.position || "Cuerpo",
    yield: String(f.yield ?? ""),
    yieldUnit: FABRIC_UNITS.includes(normUnit(f.yieldUnit, "mts")) ? normUnit(f.yieldUnit, "mts") : "mts",
    width: f.width || "",
    supplier: f.supplier || "",
    po: f.po || "",
    composition: f.composition || "",
    weight: f.weight || "",
    cwSpec: f.cwSpec ?? f.note ?? "",
  };
}

// Colorways: legacy ones (body / neckTape / swoosh…) or tech-pack ones get
// their per-material colors from the "013:00A BLACK" strings on each line.
function toColorways(list, fabrics, trims) {
  return (list || []).map((c) => {
    const components = { ...(c.components || {}) };
    if (!c.components) {
      [...fabrics, ...trims].forEach((line) => {
        const v = parseCwColors(line.cwSpec)[c.code];
        if (v) components[line.key] = v;
      });
    }
    return {
      key: c.key || uid(),
      code: String(c.code || "").toUpperCase().slice(0, 3),
      name: c.name || "",
      hex: c.hex || cwSwatch(c.body || c.name),
      components,
    };
  });
}

// BOM lines from any order shape (Style Data, older orders, parsed tech pack).
// Returns null for a section the source doesn't have.
function linesFrom(o) {
  const fabrics = o.fabrics?.length ? o.fabrics.map(toFabric) : null;
  let trims = null;
  if (o.trims) trims = o.trims.map((t) => toItem(t));
  else if (o.trimMaterials?.length || o.garmentTrims?.length) {
    const place = new Map((o.garmentTrims || []).map((g) => [String(g.code || "").trim(), g.placement]));
    const src = o.trimMaterials?.length ? o.trimMaterials : o.garmentTrims;
    trims = src.map((t) => toItem(t, { placement: t.placement || place.get(String(t.code || "").trim()) || "" }));
  }
  let packaging = null;
  if (o.packaging) packaging = o.packaging.map((t) => toItem(t));
  else if (o.packingTrims?.length) packaging = o.packingTrims.map((t) => toItem(t));
  return { fabrics, trims, packaging };
}

// Copy of another style's sections, with FRESH line keys (so they can't clash
// with lines already here) and the colorway matrix re-pointed at those keys.
function reusableFrom(o) {
  const { fabrics, trims, packaging } = linesFrom(o);
  const f = fabrics || [], t = trims || [], pk = packaging || [];
  const colorways = toColorways(o.colorways, f, t);    // still keyed by the source keys
  const keyMap = new Map();
  // purchase POs belong to the source style's own purchase → not copied
  const fresh = (line) => { const k = uid(); keyMap.set(line.key, k); return { ...line, key: k, po: "" }; };
  const out = { fabrics: f.map(fresh), trims: t.map(fresh), packaging: pk.map(fresh) };
  out.colorways = colorways.map((c) => ({
    ...c,
    key: uid(),
    components: Object.fromEntries(Object.entries(c.components || {}).filter(([k]) => keyMap.has(k)).map(([k, v]) => [keyMap.get(k), v])),
  }));
  out.spec = (o.spec || []).map((r) => ({ ...r, key: uid(), vals: { ...(r.vals || {}) } }));
  out.workmanship = (o.workmanship || []).map((r) => ({ ...r, key: uid() }));
  return out;
}

// Legacy mirrors so StyleCostingWizard and send-to-sample keep their inputs.
const legacyMirrors = (trims, packaging) => ({
  trimMaterials: trims.map((t) => ({ key: t.key, code: t.code || t.clientCode, desc: t.name, supplier: t.supplier, unit: t.unit, consumption: t.consumption, po: t.po, spec: t.cwSpec || "", qtyBySize: {} })),
  garmentTrims: trims.map((t) => ({ key: t.key, code: t.code || t.clientCode, desc: t.name, placement: t.placement, qty: t.consumption, unit: t.unit, po: t.po })),
  packingTrims: packaging.map((t) => ({ key: t.key, code: t.code || t.clientCode, desc: t.name, placement: t.placement, qty: t.consumption, unit: t.unit, po: t.po })),
});

// ==========================================================================
//  Catalog picker — searchable dropdown with "create in catalog"
// ==========================================================================
function CatalogPicker({ items, valueLabel, valueCode, placeholder, onPick, renderCreate, warn }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t ? items.filter((it) => [it.code, it.name, it.sub].filter(Boolean).join(" ").toLowerCase().includes(t)) : items;
    return base.slice(0, 60);
  }, [q, items]);

  const close = () => { setOpen(false); setQ(""); };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-left text-xs hover:border-slate-400 ${
          warn ? "border-amber-300" : "border-slate-200"
        }`}
      >
        {valueCode && <span className="font-mono font-semibold text-slate-800 shrink-0">{valueCode}</span>}
        <span className={`truncate ${valueLabel ? "text-slate-700" : "text-slate-400"}`}>{valueLabel || placeholder}</span>
        <ChevronDown size={13} className="ml-auto shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[min(22rem,90vw)] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="relative border-b border-slate-100 p-2">
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por código o nombre"
              className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-slate-400"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">Sin resultados en el catálogo.</li>}
            {filtered.map((it) => (
              <li key={it.id ?? it.code ?? it.name}>
                <button
                  type="button"
                  onClick={() => { onPick(it); close(); }}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                >
                  <span className="w-16 shrink-0 font-mono font-semibold text-slate-800">{it.code || "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{it.name}</span>
                  {it.sub && <span className="shrink-0 text-[10px] text-slate-400">{it.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
          {renderCreate && <div className="border-t border-slate-100 p-2">{renderCreate(q, close)}</div>}
        </div>
      )}
    </div>
  );
}

// Inline "new fabric" form (POST /api/fabrics {name, code}).
function NewFabricForm({ initialName, onCreated }) {
  const [name, setName] = useState(initialName || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${API_URL}/api/fabrics`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name: name.trim(), code: code.trim() || null }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo crear la tela");
      onCreated(data.fabric);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-slate-500">Nueva tela en el catálogo</div>
      <div className="flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className={`${cellBase} flex-1 min-w-0`} />
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Código" className={`${cellBase} w-24 shrink-0 font-mono`} />
        <button type="button" onClick={create} disabled={busy || !name.trim()} className="rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : "Crear"}
        </button>
      </div>
      {err && <div className="text-[11px] text-rose-600">{err}</div>}
    </div>
  );
}

// Inline "new trim / packaging item" form (POST /api/materials). The server
// assigns the code: type prefix + next number (CIE001, CIE002…).
function NewMaterialForm({ types, initialName, initialType, onCreated }) {
  const [typeCode, setTypeCode] = useState(initialType || types[0]?.code || "");
  const [name, setName] = useState(initialName || "");
  const t = types.find((x) => x.code === typeCode);
  const [unit, setUnit] = useState(t?.defaultUnit || "pzs");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (t?.defaultUnit) setUnit(t.defaultUnit); }, [typeCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextCode = t ? `${t.code}${String((t.count || 0) + 1).padStart(3, "0")}` : "";
  const create = async () => {
    if (!typeCode || !name.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${API_URL}/api/materials`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ typeCode, name: name.trim(), unit }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo crear el material");
      onCreated(data.material);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!types.length) return <div className="text-[11px] text-slate-400">Catálogo de materiales no disponible.</div>;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-slate-500">Nuevo material en el catálogo {nextCode && <span className="font-mono text-slate-700">· {nextCode}</span>}</div>
      <div className="flex flex-wrap gap-1.5">
        <select value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className={`${cellBase} min-w-0 flex-1`}>
          {types.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.label}</option>)}
        </select>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className={`${cellBase} w-20 shrink-0`}>
          {UNITS.map((u) => <option key={u}>{u}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (p. ej. Cierre nylon #5 negro)" className={`${cellBase} flex-1 min-w-0`} />
        <button type="button" onClick={create} disabled={busy || !name.trim()} className="rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : "Crear"}
        </button>
      </div>
      {err && <div className="text-[11px] text-rose-600">{err}</div>}
    </div>
  );
}

// ==========================================================================
//  BOM sections
// ==========================================================================
function LineShell({ cols, head, children, onAdd, addLabel, empty }) {
  return (
    <>
      <div className={`hidden md:grid ${cols} gap-2 px-1 pb-2 text-[11px] font-medium text-slate-400`}>{head}</div>
      {empty ? <p className="py-6 text-center text-sm text-slate-400">{empty}</p> : <div className="space-y-2 md:space-y-1.5">{children}</div>}
      <button type="button" onClick={onAdd} className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
        <Plus size={15} /> {addLabel}
      </button>
    </>
  );
}

const FABRIC_COLS = "md:grid-cols-[minmax(200px,2fr)_110px_120px_76px_68px_80px_minmax(100px,1fr)_minmax(100px,1fr)_28px]";

function FabricLines({ rows, onChange, catalog, onCatalogAdd }) {
  const patch = (key, fields) => onChange(rows.map((r) => (r.key === key ? { ...r, ...fields } : r)));
  const items = catalog.map((f) => ({ id: f.id, code: f.code || "", name: f.name }));
  return (
    <LineShell
      cols={FABRIC_COLS}
      head={<><span>Tela (catálogo)</span><span>Código</span><span>Posición</span><span>Consumo</span><span>Unidad</span><span>Ancho</span><span>Proveedor</span><span>PO de compra</span><span /></>}
      onAdd={() => onChange([...rows, emptyFabric()])}
      addLabel="Agregar tela"
      empty={rows.length === 0 ? "Sin telas. Agrega la tela principal del estilo." : null}
    >
      {rows.map((r) => (
        <div key={r.key} className={`grid grid-cols-2 ${FABRIC_COLS} gap-2 rounded-lg border border-slate-100 p-2 md:border-0 md:p-0 items-start`}>
          <div className="col-span-2 md:col-span-1">
            <CatalogPicker
              items={items}
              valueLabel={r.name}
              placeholder="Elegir tela…"
              onPick={(f) => patch(r.key, { fabricId: f.id, name: f.name, code: f.code || r.code })}
              renderCreate={(q, close) => (
                <NewFabricForm initialName={q} onCreated={(f) => { onCatalogAdd?.(f); patch(r.key, { fabricId: f.id, name: f.name, code: f.code || "" }); close(); }} />
              )}
            />
          </div>
          <input
            value={r.code}
            onChange={(e) => patch(r.key, { code: e.target.value.toUpperCase() })}
            readOnly={!!(r.fabricId && catalog.find((f) => f.id === r.fabricId)?.code)}
            title="Tomado de la ficha de la tela"
            placeholder="Código"
            className={`${cellCls} font-mono read-only:bg-slate-50 read-only:text-slate-500`}
          />
          <select value={r.position} onChange={(e) => patch(r.key, { position: e.target.value })} className={cellCls}>
            {[...new Set([...FABRIC_POSITIONS, r.position].filter(Boolean))].map((p) => <option key={p}>{p}</option>)}
          </select>
          <input type="number" step="any" min="0" value={r.yield} onChange={(e) => patch(r.key, { yield: e.target.value })} placeholder="0.00" title="Consumo por prenda (sala de muestras)" className={`${cellCls} text-right`} />
          <select value={r.yieldUnit} onChange={(e) => patch(r.key, { yieldUnit: e.target.value })} className={cellCls}>
            {FABRIC_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
          <input value={r.width} onChange={(e) => patch(r.key, { width: e.target.value })} placeholder='58"' className={cellCls} />
          <input value={r.supplier || ""} onChange={(e) => patch(r.key, { supplier: e.target.value })} placeholder="Proveedor" className={cellCls} />
          <input value={r.po} onChange={(e) => patch(r.key, { po: e.target.value })} placeholder="PO" className={`${cellCls} font-mono`} />
          <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} title="Quitar" className="justify-self-end p-1 text-slate-300 hover:text-rose-600">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </LineShell>
  );
}

const ITEM_COLS = "md:grid-cols-[minmax(220px,2fr)_minmax(120px,1fr)_80px_72px_minmax(100px,1fr)_minmax(90px,1fr)_28px]";

function ItemLines({ rows, onChange, catalog, types, addLabel, emptyText, onCatalogAdd }) {
  const patch = (key, fields) => onChange(rows.map((r) => (r.key === key ? { ...r, ...fields } : r)));
  const typeLabel = (code) => types.find((t) => t.code === code)?.label || "";
  const items = catalog.map((m) => ({ id: m.id, code: m.code, name: m.name, sub: typeLabel(m.typeCode), m }));
  const pick = (r, m) => patch(r.key, { materialId: m.id, code: m.code, typeCode: m.typeCode, name: r.name && r.clientCode ? r.name : m.name, unit: r.consumption ? r.unit : m.unit || r.unit, supplier: r.supplier || m.supplier || "" });
  return (
    <LineShell
      cols={ITEM_COLS}
      head={<><span>Material (código de catálogo)</span><span>Colocación</span><span>Consumo</span><span>Unidad</span><span>Proveedor</span><span>PO</span><span /></>}
      onAdd={() => onChange([...rows, emptyItem()])}
      addLabel={addLabel}
      empty={rows.length === 0 ? emptyText : null}
    >
      {rows.map((r) => {
        const linked = CATALOG_CODE.test(r.code || "");
        return (
          <div key={r.key} className={`grid grid-cols-2 ${ITEM_COLS} gap-2 rounded-lg border border-slate-100 p-2 md:border-0 md:p-0 items-start`}>
            <div className="col-span-2 md:col-span-1">
              <CatalogPicker
                items={items}
                valueCode={linked ? r.code : ""}
                valueLabel={r.name}
                placeholder="Elegir del catálogo…"
                warn={!linked}
                onPick={(it) => pick(r, it.m)}
                renderCreate={(q, close) => (
                  <NewMaterialForm
                    types={types}
                    initialName={q || r.name}
                    initialType={r.typeCode}
                    onCreated={(m) => { onCatalogAdd(m); pick(r, m); close(); }}
                  />
                )}
              />
              {!linked && (r.clientCode || r.name) && (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600">
                  <AlertCircle size={11} /> Sin código de catálogo{r.clientCode ? ` · ref. ${r.clientCode}` : ""}
                </div>
              )}
            </div>
            <input value={r.placement} onChange={(e) => patch(r.key, { placement: e.target.value })} placeholder="Dónde va" className={cellCls} />
            <input type="number" step="any" min="0" value={r.consumption} onChange={(e) => patch(r.key, { consumption: e.target.value })} placeholder="1" className={`${cellCls} text-right`} />
            <select value={r.unit} onChange={(e) => patch(r.key, { unit: e.target.value })} className={cellCls}>
              {[...new Set([...UNITS, r.unit].filter(Boolean))].map((u) => <option key={u}>{u}</option>)}
            </select>
            <input value={r.supplier} onChange={(e) => patch(r.key, { supplier: e.target.value })} className={cellCls} />
            <input value={r.po} onChange={(e) => patch(r.key, { po: e.target.value })} className={`${cellCls} font-mono`} />
            <div className="flex justify-end gap-0.5">
              <button type="button" onClick={() => {
                const i = rows.findIndex((x) => x.key === r.key);
                onChange([...rows.slice(0, i + 1), { ...r, key: uid() }, ...rows.slice(i + 1)]);
              }} title="Duplicar" className="hidden p-1 text-slate-300 hover:text-slate-600 xl:block">
                <Copy size={13} />
              </button>
              <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} title="Quitar" className="p-1 text-slate-300 hover:text-rose-600">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </LineShell>
  );
}

// ==========================================================================
//  Colorway — colorways × materials
// ==========================================================================
function ColorwayStep({ colorways, onChange, fabrics, trims }) {
  const patch = (key, fields) => onChange(colorways.map((c) => (c.key === key ? { ...c, ...fields } : c)));
  const setCell = (cwKey, lineKey, value) =>
    onChange(colorways.map((c) => (c.key === cwKey ? { ...c, components: { ...c.components, [lineKey]: value } } : c)));
  const lines = [
    ...fabrics.filter((f) => f.name || f.code).map((f) => ({ key: f.key, code: f.code, label: f.name, sub: f.position, kind: "Tela" })),
    ...trims.filter((t) => t.name || t.code).map((t) => ({ key: t.key, code: t.code || t.clientCode, label: t.name, sub: t.placement, kind: "Avío" })),
  ];
  const fillFabrics = (c) =>
    onChange(colorways.map((x) => {
      if (x.key !== c.key) return x;
      const comp = { ...x.components };
      fabrics.forEach((f) => { if (!comp[f.key]) comp[f.key] = x.name || x.code; });
      return { ...x, components: comp };
    }));

  return (
    <>
      <SectionCard icon={Palette} title="5 · Colorways" subtitle="El código de 3 letras es el color del código maestro (NEG, BLA…)" right={<span className="text-[11px] text-slate-400">{colorways.length}</span>}>
        {colorways.length === 0 && <p className="pb-2 text-sm text-slate-400">Agrega al menos un colorway.</p>}
        <div className="space-y-2">
          {colorways.length > 0 && (
            <div className="grid grid-cols-[2.25rem_5.5rem_minmax(0,1fr)_2rem] gap-2 px-0.5 text-[11px] font-medium text-slate-400">
              <span />
              <span>Código</span>
              <span>Nombre</span>
              <span />
            </div>
          )}
          {colorways.map((c) => (
            // one colorway per line: swatch · code · name · remove
            <div key={c.key} className="grid grid-cols-[2.25rem_5.5rem_minmax(0,1fr)_2rem] items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#cbd5e1"}
                onChange={(e) => patch(c.key, { hex: e.target.value })}
                className="h-9 w-9 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
                title="Color de referencia"
                aria-label={`Color de ${c.code || "colorway"}`}
              />
              <input
                value={c.code}
                onChange={(e) => patch(c.key, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) })}
                placeholder="NEG"
                aria-label="Código de color"
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-center font-mono text-sm tracking-widest outline-none focus:border-slate-500"
              />
              <input
                value={c.name}
                onChange={(e) => patch(c.key, { name: e.target.value })}
                placeholder="Nombre (p. ej. Negro)"
                aria-label="Nombre del colorway"
                className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <button type="button" onClick={() => onChange(colorways.filter((x) => x.key !== c.key))} title="Quitar" className="p-1.5 text-slate-300 hover:text-rose-600">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange([...colorways, { key: uid(), code: "", name: "", hex: "#cbd5e1", components: {} }])}
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <Plus size={15} /> Agregar colorway
        </button>
      </SectionCard>

      {colorways.length > 0 && (
        <SectionCard icon={Layers} title="5 · Color de cada material por colorway" subtitle="Filas: materiales del BOM · columnas: colorways">
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Primero agrega telas o avíos en el paso 2 (BOM).</p>
          ) : (
            <div className="overflow-x-auto max-w-full">
              <table className="text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400">
                    <th className="sticky left-0 z-10 bg-white px-2 pb-2 min-w-[200px]">Material</th>
                    {colorways.map((c) => (
                      <th key={c.key} className="px-1 pb-2 min-w-[120px]">
                        <div className="flex items-center gap-1.5">
                          <span className="h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ background: c.hex }} />
                          <span className="font-mono font-semibold text-slate-600">{c.code || "—"}</span>
                          <button type="button" onClick={() => fillFabrics(c)} title="Usar el nombre del colorway en las telas vacías" className="ml-auto text-[10px] font-normal text-slate-400 hover:text-slate-700">
                            llenar telas
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td className="sticky left-0 z-10 bg-white px-2 py-1 border-t border-slate-100">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] text-slate-400">{l.kind}</span>
                          <span className="font-mono text-[11px] text-slate-800">{l.code || "—"}</span>
                        </div>
                        <div className="max-w-[190px] truncate text-[10px] text-slate-500">{l.label}{l.sub ? ` · ${l.sub}` : ""}</div>
                      </td>
                      {colorways.map((c) => (
                        <td key={c.key} className="px-1 py-1 border-t border-slate-100">
                          <input value={c.components?.[l.key] || ""} onChange={(e) => setCell(c.key, l.key, e.target.value)} className={cellCls} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}

// ==========================================================================
//  Imagen — the style photo (S3, same store as master-code photos)
// ==========================================================================
function StyleImageCard({ image, onChange, onToast }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    const extType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif" };
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    const contentType = file.type || extType[ext] || "image/jpeg";
    const preview = URL.createObjectURL(file);
    onChange({ ...(image || {}), url: preview, name: file.name, uploading: true });
    setBusy(true);
    try {
      const up = await fetch(`${API_URL}/api/style-orders/style-photo-upload-url`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ filename: file.name, contentType }),
      });
      const data = await up.json();
      if (!up.ok || !data.success) throw new Error(data.error || "No se pudo preparar la subida");
      const put = await fetch(data.url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!put.ok) throw new Error(`S3 rechazó la subida (HTTP ${put.status})`);
      onChange({ s3Key: data.key, url: preview, name: file.name });
    } catch (err) {
      onChange(image || null);
      onToast?.(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,280px)_1fr] items-start">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}
        className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 hover:border-slate-300"
      >
        {image?.url ? (
          <img src={image.url} alt="Foto del estilo" className="h-full w-full object-contain" />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 text-slate-400">
            <ImagePlus size={26} />
            <span className="text-sm font-medium text-slate-600">Subir foto del estilo</span>
            <span className="text-[11px]">JPG, PNG, WEBP o HEIC</span>
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <RefreshCw size={20} className="animate-spin" />
          </span>
        )}
      </button>
      <div className="space-y-2 text-sm text-slate-600">
        <p>Esta es la imagen que identifica al estilo en el listado, en la pre-orden y en los códigos maestros que nazcan de él.</p>
        {image?.url && (
          <div className="flex gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:border-slate-400">
              Cambiar foto
            </button>
            <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50">
              <Trash2 size={12} /> Quitar
            </button>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f); }}
      />
    </div>
  );
}

// ==========================================================================
//  Reusar de otro estilo — pick a style, choose sections, replace or add
// ==========================================================================
const REUSE_SECTIONS = [
  { id: "ficha", label: "Ficha", hint: "Cliente, temporada, descripción y SAM" },
  { id: "fabrics", label: "Telas", hint: "Con consumo, ancho y proveedor" },
  { id: "trims", label: "Avíos", hint: "Con código de catálogo y consumo" },
  { id: "packaging", label: "Empaque", hint: "Con código de catálogo y consumo" },
  { id: "colorways", label: "Colorways", hint: "Y el color de cada material" },
  { id: "spec", label: "Tallas", hint: "Tabla de especificación" },
  { id: "workmanship", label: "Confección", hint: "Operaciones" },
];

function ReuseFromStyleModal({ excludeId, defaults, currentCounts, onApply, onClose }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);      // list row
  const [source, setSource] = useState(null);      // full order
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(new Set(defaults));
  const [mode, setMode] = useState("replace");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/style-orders`, { headers: authHeaders() });
        const data = await res.json();
        setList((data.orders || []).filter((o) => o.id !== excludeId));
      } catch (e) { setErr(e.message); setList([]); }
    })();
  }, [excludeId]);

  const pick = async (row) => {
    setPicked(row); setSource(null); setErr("");
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${row.id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo abrir el estilo");
      setSource(data.order);
    } catch (e) { setErr(e.message); }
  };

  const reusable = useMemo(() => (source ? reusableFrom(source) : null), [source]);
  const counts = reusable ? {
    ficha: [source.header?.customer || source.customerName, source.header?.season, source.header?.samMinutes].filter(Boolean).length,
    fabrics: reusable.fabrics.length, trims: reusable.trims.length, packaging: reusable.packaging.length,
    colorways: reusable.colorways.length, spec: reusable.spec.length, workmanship: reusable.workmanship.length,
  } : {};
  // replacing wipes what's there now — say how much
  const willReplace = mode === "replace"
    ? [...sel].filter((k) => k !== "ficha" && counts[k] > 0 && (currentCounts[k] || 0) > 0).map((k) => `${currentCounts[k]} ${REUSE_SECTIONS.find((x) => x.id === k).label.toLowerCase()}`)
    : [];

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const xs = list || [];
    return (t ? xs.filter((o) => [o.styleCode, o.styleNo, o.styleName, o.customerName, ...(o.suppliers || []).map((x) => x.name)].filter(Boolean).join(" ").toLowerCase().includes(t)) : xs).slice(0, 60);
  }, [list, q]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = [...sel].filter((k) => counts[k] > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white"><Copy size={18} /></div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800">Reusar de otro estilo</h2>
            <p className="text-xs text-slate-500">{picked ? "Elige qué copiar" : "Elige el estilo de origen"}</p>
          </div>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar"><X size={18} /></button>
        </div>

        {!picked ? (
          <div className="flex min-h-0 flex-1 flex-col p-5">
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, nombre, cliente o proveedor…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-500" />
            </div>
            <div className="min-h-[12rem] flex-1 overflow-y-auto rounded-lg border border-slate-200">
              {list === null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><RefreshCw size={15} className="animate-spin" /> Cargando estilos…</div>
              ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">{list.length ? "Ningún estilo coincide." : "Aún no hay otros estilos."}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filtered.map((o) => (
                    <li key={o.id}>
                      <button type="button" onClick={() => pick(o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-300">
                          {o.imageUrl ? <img src={o.imageUrl} alt="" className="h-full w-full object-cover" /> : <ImageOff size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-sm font-bold tracking-wider text-slate-800">{o.styleCode || "Sin número"}</span>
                          <span className="block truncate text-xs text-slate-500">{[o.styleName, o.customerName].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="shrink-0 text-right text-[11px] text-slate-400">
                          {(o.suppliers || []).reduce((n, x) => n + (x.fabric || 0) + (x.trim || 0) + (x.packaging || 0), 0) || "—"} materiales con proveedor
                        </span>
                        <ChevronRight size={15} className="shrink-0 text-slate-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <button type="button" onClick={() => { setPicked(null); setSource(null); }} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
              <ChevronLeft size={14} /> Otro estilo
            </button>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="font-mono text-base font-bold tracking-wider text-slate-800">{picked.styleCode || "Sin número"}</span>
              <span className="truncate text-sm text-slate-500">{[picked.styleName, picked.customerName].filter(Boolean).join(" · ")}</span>
            </div>
            {!reusable ? (
              err ? <p className="text-sm text-rose-600">{err}</p> : <div className="flex items-center gap-2 text-sm text-slate-400"><RefreshCw size={15} className="animate-spin" /> Leyendo el estilo…</div>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {REUSE_SECTIONS.map((x) => {
                    const n = counts[x.id] || 0;
                    const on = sel.has(x.id) && n > 0;
                    return (
                      <button key={x.id} type="button" disabled={!n} onClick={() => toggle(x.id)} aria-pressed={on}
                        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${on ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}>
                        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>{on && <Check size={11} />}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">{x.label} {x.id !== "ficha" && <span className="font-normal text-slate-400">· {n}</span>}</span>
                          <span className="block text-[11px] text-slate-500">{n ? x.hint : "El estilo no tiene"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">¿Qué hacer con lo que ya tiene este estilo?</div>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                    {[["replace", "Reemplazar"], ["append", "Agregar"]].map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setMode(id)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === id ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {mode === "replace"
                      ? willReplace.length ? `Se quitan ${willReplace.join(", ")} de este estilo.` : "Las secciones elegidas quedan iguales a las del estilo de origen."
                      : "Se suma a lo que ya hay. Colorways con el mismo código se combinan; medidas y operaciones repetidas no se duplican."}
                  </p>
                </div>
                <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  Se copian consumos, proveedores y códigos de catálogo; las POs de compra no, porque son de la compra del otro estilo. Revisa los consumos si este estilo cambia de talla o de corte.
                </p>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400">Cancelar</button>
          <button
            disabled={!reusable || !chosen.length}
            onClick={() => onApply({ source, reusable, sections: chosen, mode })}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <Copy size={15} /> Usar en este estilo
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================================================
//  Main
// ==========================================================================
export default function StyleOrderWizard({ orderId = null, copyFromId = null, presetCustomer = "", onDone, onAction }) {
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [toast, setToast] = useState(null);
  const [importStatus, setImportStatus] = useState({ size: null, materials: null });
  const [importReview, setImportReview] = useState(null);
  const [showImport, setShowImport] = useState(!orderId);
  const topRef = useRef(null);

  const [savedId, setSavedId] = useState(orderId || null);
  const [status, setStatus] = useState("draft");
  const [preOrder, setPreOrder] = useState(null); // { id, no, status }
  const [workOrders, setWorkOrders] = useState([]); // POs converted from this style
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null); // "sample" | "preorder" | "purchase"
  const [reuseDefaults, setReuseDefaults] = useState(null); // open "Reusar de otro estilo" with these sections preselected
  const [copiedFrom, setCopiedFrom] = useState(null);        // style code this one was started from

  // catalogs
  const [customers, setCustomers] = useState([]);
  const [fabricCatalog, setFabricCatalog] = useState([]);
  const [materialTypes, setMaterialTypes] = useState([]);
  const [materialCatalog, setMaterialCatalog] = useState([]);
  const [catalogOnline, setCatalogOnline] = useState(true);

  // 1 · style number
  const [style, setStyle] = useState({ tipo: "", modelo: "", correlativo: "" });
  const [origStyle, setOrigStyle] = useState(null); // number as saved — kept when re-picking the same tipo/modelo
  const [corrLoading, setCorrLoading] = useState(false);
  const [header, setHeader] = useState(presetCustomer && !orderId ? { ...EMPTY_HEADER, customer: presetCustomer } : EMPTY_HEADER);
  // 2 · BOM
  const [fabrics, setFabrics] = useState([emptyFabric()]);
  const [trims, setTrims] = useState([]);
  const [packaging, setPackaging] = useState([]);
  // 3 · 4
  const [spec, setSpec] = useState([]);
  const [workmanship, setWorkmanship] = useState([]);
  // 5
  const [colorways, setColorways] = useState([]);
  // 6
  const [image, setImage] = useState(null);
  const [qualityPhotos, setQualityPhotos] = useState([]);
  // passthrough (not edited here; kept so nothing is lost on save)
  const [legacy, setLegacy] = useState({ sam: [], skus: [], packing: undefined });

  const step = STEPS[stepIdx];
  const isDraft = status === "draft";
  const numberLocked = !isDraft && !!origStyle?.correlativo;
  const styleCode = style.tipo && style.modelo && style.correlativo.length === 2 ? `${style.tipo}${style.modelo}${style.correlativo}` : "";
  const setHeaderField = (k, v) => setHeader((h) => ({ ...h, [k]: v }));
  const showToast = (msg, kind = "error") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };
  const goto = (i) => {
    setStepIdx(i);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---- catalogs -----------------------------------------------------------
  useEffect(() => {
    (async () => {
      const get = async (path) => {
        const r = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
        if (r.status === 401) { window.location.href = "/login"; throw new Error("401"); }
        if (!r.ok) throw new Error(`${path} ${r.status}`);
        return r.json();
      };
      const [c, f, t, m] = await Promise.allSettled([
        get("/api/customers"), get("/api/fabrics"), get("/api/materials/types"), get("/api/materials"),
      ]);
      if (c.status === "fulfilled") setCustomers(c.value.customers || []);
      if (f.status === "fulfilled") setFabricCatalog(f.value.fabrics || []);
      if (t.status === "fulfilled") setMaterialTypes(t.value.types || []);
      if (m.status === "fulfilled") setMaterialCatalog(m.value.materials || []);
      setCatalogOnline(t.status === "fulfilled" && m.status === "fulfilled");
    })();
  }, []);

  const trimTypes = materialTypes.filter((t) => t.group === "trim");
  const packTypes = materialTypes.filter((t) => t.group === "packaging");
  const trimCatalog = materialCatalog.filter((m) => trimTypes.some((t) => t.code === m.typeCode));
  const packCatalog = materialCatalog.filter((m) => packTypes.some((t) => t.code === m.typeCode));
  const addToCatalog = (m) => {
    setMaterialCatalog((xs) => [...xs, m]);
    setMaterialTypes((ts) => ts.map((t) => (t.code === m.typeCode ? { ...t, count: (t.count || 0) + 1 } : t)));
  };

  // customer link: typing a name that matches the catalog links its id/code
  const setCustomerName = (name) => {
    const hit = customers.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    setHeader((h) => ({ ...h, customer: name, customerId: hit ? hit.id : null, clienteCode: hit?.code || "" }));
  };
  useEffect(() => {
    if (!header.customer || header.customerId || !customers.length) return;
    const hit = customers.find((c) => c.name.trim().toLowerCase() === String(header.customer).trim().toLowerCase());
    if (hit) setHeader((h) => ({ ...h, customerId: hit.id, clienteCode: hit.code || "" }));
  }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- correlativo: auto when tipo + modelo are chosen --------------------
  useEffect(() => {
    const { tipo, modelo, correlativo } = style;
    if (!tipo || !modelo || correlativo || numberLocked) return;
    if (origStyle && origStyle.tipo === tipo && origStyle.modelo === modelo && origStyle.correlativo) {
      setStyle((s) => ({ ...s, correlativo: origStyle.correlativo }));
      return;
    }
    let cancelled = false;
    setCorrLoading(true);
    fetch(`${API_URL}/api/master-codes/next-correlativo?type=${tipo}&modelo=${modelo}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.success) setStyle((s) => (s.tipo === tipo && s.modelo === modelo && !s.correlativo ? { ...s, correlativo: d.nextCorrelativo } : s)); })
      .catch(() => { if (!cancelled) showToast("No se pudo obtener el correlativo; escríbelo a mano"); })
      .finally(() => { if (!cancelled) setCorrLoading(false); });
    return () => { cancelled = true; };
  }, [style.tipo, style.modelo, style.correlativo, numberLocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- hydrate from a saved order or a parsed tech pack ---------------------
  // `partial` = tech pack import: only overwrite what the file brought.
  const hydrate = (o, { partial = false } = {}) => {
    // nulls from older rows would turn inputs uncontrolled — keep the defaults
    if (o.header) setHeader((h) => ({ ...h, ...Object.fromEntries(Object.entries(o.header).filter(([, v]) => v != null)) }));
    if (o.style || o.tipo) {
      const st = { tipo: o.style?.tipo || o.tipo || "", modelo: o.style?.modelo || o.modelo || "", correlativo: o.style?.correlativo || o.correlativo || "" };
      setStyle(st);
      if (!partial) setOrigStyle(st);
    }

    const { fabrics: newFabrics, trims: newTrims, packaging: newPack } = linesFrom(o);

    if (newFabrics || !partial) setFabrics(newFabrics || [emptyFabric()]);
    if (newTrims || !partial) setTrims(newTrims || []);
    if (newPack || !partial) setPackaging(newPack || []);
    if (o.spec?.length || !partial) setSpec(o.spec || []);
    if (o.workmanship?.length || !partial) setWorkmanship(o.workmanship || []);
    if (o.colorways?.length || !partial) setColorways(toColorways(o.colorways, newFabrics || [], newTrims || []));
    if (!partial) {
      setImage(o.image?.s3Key ? { s3Key: o.image.s3Key, url: o.image.url || o.imageUrl || null, name: o.image.name } : null);
      setStatus(o.status || "draft");
      setPreOrder(o.preOrderId ? { id: o.preOrderId, no: o.preOrderNo, status: o.preOrderStatus } : null);
      setWorkOrders(Array.isArray(o.workOrders) ? o.workOrders : []);
    }
    setLegacy((l) => ({
      sam: o.sam ?? l.sam,
      skus: o.skus ?? l.skus,
      packing: o.packing ?? l.packing,
    }));
    if (o.qualityPhotos?.length) hydratePhotos(o.qualityPhotos);
  };

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/style-orders/${orderId}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "No se pudo abrir el estilo");
        hydrate(data.order);
        setSavedId(orderId);
      } catch (err) {
        showToast(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // ---- reuse sections from another style ----------------------------------
  const nonEmptyFabric = (f) => f.name || f.code || f.yield;
  // Colors in a colorway are keyed by BOM line. When a line can't be followed
  // by key (colorways copied without their materials, or materials replaced
  // under existing colorways), it's matched by identity: same kind and same
  // code — or same name when there's no code.
  const lineIdent = (kind, l) => `${kind}|${String(l.code || "").trim().toUpperCase() || String(l.name || "").trim().toLowerCase()}`;
  const applyReuse = ({ source, reusable: r, sections, mode }) => {
    const has = (k) => sections.includes(k);
    const add = mode === "append";
    const done = [];

    // 1) final material lists
    const nextFabrics = has("fabrics") ? (add ? [...fabrics.filter(nonEmptyFabric), ...r.fabrics] : r.fabrics.length ? r.fabrics : [emptyFabric()]) : fabrics;
    const nextTrims = has("trims") ? (add ? [...trims, ...r.trims] : r.trims) : trims;
    const nextPack = has("packaging") ? (add ? [...packaging, ...r.packaging] : r.packaging) : packaging;
    if (has("fabrics")) done.push(`${r.fabrics.length} telas`);
    if (has("trims")) done.push(`${r.trims.length} avíos`);
    if (has("packaging")) done.push(`${r.packaging.length} empaque`);

    // 2) re-point colorway colors at the final lines
    const finalKeys = new Set([...nextFabrics, ...nextTrims].map((l) => l.key));
    const byIdent = new Map();
    nextFabrics.forEach((l) => { const k = lineIdent("f", l); if (!byIdent.has(k)) byIdent.set(k, l.key); });
    nextTrims.forEach((l) => { const k = lineIdent("t", l); if (!byIdent.has(k)) byIdent.set(k, l.key); });
    const identOfKey = (lines) => {
      const m = new Map();
      lines.fabrics.forEach((l) => m.set(l.key, lineIdent("f", l)));
      lines.trims.forEach((l) => m.set(l.key, lineIdent("t", l)));
      return m;
    };
    const remap = (components, identMap) => {
      const out = {};
      for (const [k, v] of Object.entries(components || {})) {
        const target = finalKeys.has(k) ? k : byIdent.get(identMap.get(k));
        if (target && v && !out[target]) out[target] = v;
      }
      return out;
    };
    const prevIdents = identOfKey({ fabrics, trims });     // lines being replaced
    const srcIdents = identOfKey({ fabrics: r.fabrics, trims: r.trims });
    let nextColorways = colorways.map((c) => ({ ...c, components: remap(c.components, prevIdents) }));
    if (has("colorways")) {
      const incoming = r.colorways.map((c) => ({ ...c, components: remap(c.components, srcIdents) }));
      if (add) {
        const codes = new Set(nextColorways.map((c) => c.code).filter(Boolean));
        nextColorways = [
          ...nextColorways.map((c) => {
            const src = incoming.find((x) => x.code && x.code === c.code);
            return src ? { ...c, components: { ...src.components, ...c.components } } : c;   // keep what's already filled in
          }),
          ...incoming.filter((x) => !x.code || !codes.has(x.code)),
        ];
      } else {
        nextColorways = incoming;
      }
      done.push(`${r.colorways.length} colorways`);
    }

    // 3) the rest
    if (has("ficha")) {
      const h = source.header || {};
      const pick = {
        customer: h.customer || source.customerName || "", customerId: h.customerId ?? source.customerId ?? null, clienteCode: h.clienteCode || "",
        season: h.season || "", description: h.description || "", samMinutes: h.samMinutes || "",
      };
      // "Agregar" only fills what's empty; "Reemplazar" overwrites
      setHeader((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(pick).filter(([k, v]) => v !== "" && v != null && (!add || !cur[k]))) }));
      done.push("ficha");
    }
    if (has("spec")) {
      setSpec((cur) => (add ? [...cur, ...r.spec.filter((x) => !cur.some((c) => c.code && c.code === x.code))] : r.spec));
      done.push(`${r.spec.length} medidas`);
    }
    if (has("workmanship")) {
      setWorkmanship((cur) => (add ? [...cur, ...r.workmanship.filter((x) => !cur.some((c) => c.area === x.area && c.instr === x.instr))] : r.workmanship));
      done.push(`${r.workmanship.length} operaciones`);
    }
    setFabrics(nextFabrics);
    setTrims(nextTrims);
    setPackaging(nextPack);
    setColorways(nextColorways);
    setReuseDefaults(null);
    showToast(`${add ? "Agregado" : "Copiado"} de ${source.styleCode || "otro estilo"}: ${done.join(", ")}`, "ok");
  };
  const currentCounts = {
    fabrics: fabrics.filter(nonEmptyFabric).length, trims: trims.length, packaging: packaging.length,
    colorways: colorways.length, spec: spec.length, workmanship: workmanship.length,
  };

  // ---- "Usar como base": a NEW style pre-filled from another one ------------
  // Everything is copied except what must be new: number (fresh correlativo),
  // client style no., photo, history (status / pre-order / POs) and PO data.
  useEffect(() => {
    if (!copyFromId || orderId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/style-orders/${copyFromId}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "No se pudo abrir el estilo de origen");
        const o = data.order;
        const r = reusableFrom(o);
        hydrate({ ...o, fabrics: r.fabrics, trims: r.trims, packaging: r.packaging, colorways: r.colorways, spec: r.spec, workmanship: r.workmanship, qualityPhotos: [] });
        setStyle((st) => ({ ...st, correlativo: "" }));   // → next correlativo
        setOrigStyle(null);
        setHeader((h) => ({ ...h, styleNo: "", orderNo: "", version: "", quantity: "", orderDate: "", deliveryDate: "", styleCode: "" }));
        setSavedId(null);
        setStatus("draft");
        setPreOrder(null);
        setWorkOrders([]);
        setImage(null);
        setQualityPhotos([]);
        setLegacy({ sam: o.sam || [], skus: [], packing: undefined });
        setCopiedFrom(o.styleCode || o.header?.styleNo || `#${o.id}`);
        showToast(`Basado en ${o.styleCode || "otro estilo"} — revisa y guarda`, "ok");
      } catch (err) {
        showToast(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFromId]);

  // reference photos: swap stored S3 keys for signed view URLs
  const hydratePhotos = async (photos) => {
    setQualityPhotos(photos);
    const keys = photos.filter((p) => p.s3Key && !p.url).map((p) => p.s3Key);
    if (!keys.length) return;
    try {
      const res = await fetch(`${API_URL}/api/style-orders/photo-view-urls`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ keys }),
      });
      const data = await res.json();
      if (res.ok && data.success) setQualityPhotos((cur) => cur.map((p) => (data.urls[p.s3Key] ? { ...p, url: data.urls[p.s3Key] } : p)));
    } catch { /* thumbnails just won't render */ }
  };

  // ---- imports --------------------------------------------------------------
  const onTechPackFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParsing(true);
    setImportStatus((s) => ({ ...s, pdf: { ok: null, msg: "Subiendo el tech pack…" } }));
    try {
      const up = await fetch(`${API_URL}/api/style-orders/upload-url`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ filename: file.name }) });
      const upData = await up.json();
      if (!up.ok || !upData.success) throw new Error(upData.error || "No se pudo iniciar la subida");
      const putRes = await fetch(upData.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!putRes.ok) throw new Error("Falló la subida a S3");
      setImportStatus((s) => ({ ...s, pdf: { ok: null, msg: "Leyendo el tech pack…" } }));
      const res = await fetch(`${API_URL}/api/style-orders/parse-techpack`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ key: upData.key }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo leer el PDF");
      const o = data.order;
      // the tech pack's own SAM breakdown doesn't replace the sample-room SAM
      hydrate({ ...o, header: o.header ? { ...o.header, samMinutes: header.samMinutes || o.header.samMinutes } : undefined }, { partial: true });
      const nTrims = o.trimMaterials?.length || o.garmentTrims?.length || 0;
      const filled = [
        o.fabrics?.length && `${o.fabrics.length} telas`,
        nTrims && `${nTrims} avíos`,
        o.packingTrims?.length && `${o.packingTrims.length} empaque`,
        o.spec?.length && `${o.spec.length} medidas`,
        o.workmanship?.length && `${o.workmanship.length} operaciones`,
        o.colorways?.length && `${o.colorways.length} colorways`,
      ].filter(Boolean).join(" · ");
      const fmtLabel = data.format === "nike_bom" ? "BOM Nike" : "Hoja de proceso SKM";
      setImportStatus((s) => ({ ...s, pdf: { ok: true, msg: `${fmtLabel} · ${file.name} → ${filled}` } }));
      showToast(`Tech pack cargado: ${filled}`, "ok");
      setImportReview({
        warnings: o.warnings || [],
        sections: [
          { id: "bom", label: "BOM", n: (o.fabrics?.length || 0) + nTrims, detail: `${o.fabrics?.length || 0} telas · ${nTrims} avíos · ${o.packingTrims?.length || 0} empaque` },
          { id: "tallas", label: "Tallas", n: o.spec?.length || 0, detail: `${o.spec?.length || 0} medidas` },
          { id: "confeccion", label: "Confección", n: o.workmanship?.length || 0, detail: `${o.workmanship?.length || 0} operaciones` },
          { id: "colorway", label: "Colorway", n: o.colorways?.length || 0, detail: `${o.colorways?.length || 0} colorways` },
        ],
      });
    } catch (err) {
      setImportStatus((s) => ({ ...s, pdf: { ok: false, msg: err.message } }));
    } finally {
      setParsing(false);
    }
  };

  const onSizeFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = parseSizeSpec(sheetRows(await readWorkbook(file)));
      setSpec(parsed);
      setImportStatus((s) => ({ ...s, size: { ok: true, msg: `${file.name} → ${parsed.length} medidas · paso 3 lleno` } }));
      showToast(`Especificación importada: ${parsed.length} puntos de medida`, "ok");
    } catch (err) {
      setImportStatus((s) => ({ ...s, size: { ok: false, msg: err.message } }));
    }
  };
  const onMaterialsFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { fabrics: fb, trims: tr } = parseMaterials(sheetRows(await readWorkbook(file)));
      if (fb.length) setFabrics(fb.map(toFabric));
      if (tr.length) setTrims(tr.map((t) => toItem({ ...t, spec: undefined }, { placement: t.spec || "" })));
      const parts = [fb.length ? `${fb.length} telas` : null, tr.length ? `${tr.length} avíos` : null].filter(Boolean).join(" · ");
      setImportStatus((s) => ({ ...s, materials: { ok: true, msg: `${file.name} → ${parts} · paso 2 lleno` } }));
      showToast(`Materiales importados: ${parts}`, "ok");
    } catch (err) {
      setImportStatus((s) => ({ ...s, materials: { ok: false, msg: err.message } }));
    }
  };

  // ---- completeness -------------------------------------------------------
  const unlinkedItems = [...trims, ...packaging].filter((t) => (t.name || t.clientCode) && !CATALOG_CODE.test(t.code || "")).length;
  const checks = [
    { id: "estilo", label: "Número de estilo", ok: !!styleCode, value: styleCode },
    { id: "estilo", label: "Cliente", ok: !!String(header.customer || "").trim(), value: header.customer },
    { id: "estilo", label: "Nombre o descripción", ok: !!String(header.styleName || header.description || "").trim(), value: header.styleName || header.description },
    { id: "estilo", label: "SAM de muestras", ok: Number(header.samMinutes) > 0, value: header.samMinutes ? `${num(header.samMinutes)} min` : "" },
    { id: "bom", label: "Al menos una tela", ok: fabrics.some((f) => f.name || f.code), value: `${fabrics.filter((f) => f.name || f.code).length} telas` },
    { id: "colorway", label: "Al menos un colorway", ok: colorways.some((c) => c.code), value: colorways.map((c) => c.code).filter(Boolean).join(", ") },
  ];
  const missing = checks.filter((c) => !c.ok);
  const stepState = {
    estilo: checks.filter((c) => c.id === "estilo").every((c) => c.ok) ? "ok" : "todo",
    bom: fabrics.some((f) => f.name || f.code) ? (unlinkedItems ? "warn" : "ok") : "todo",
    tallas: spec.length ? "ok" : "opt",
    confeccion: workmanship.length ? "ok" : "opt",
    colorway: colorways.some((c) => c.code) ? "ok" : "todo",
    imagen: image?.s3Key ? "ok" : "opt",
    completar: isDraft ? "opt" : "ok",
  };

  // ---- persist ------------------------------------------------------------
  const orderBody = () => ({
    masterCodeId: null,
    customerId: header.customerId || null,
    style,
    header: { ...header, styleCode },
    fabrics: fabrics.filter((f) => f.name || f.code || f.yield),
    trims: trims.filter((t) => t.name || t.code || t.clientCode),
    packaging: packaging.filter((t) => t.name || t.code || t.clientCode),
    spec,
    workmanship,
    colorways,
    image: image?.s3Key ? { s3Key: image.s3Key, name: image.name || null } : null,
    qualityPhotos: qualityPhotos.filter((p) => p.s3Key).map(({ key, s3Key, name, comment, at }) => ({ key, s3Key, name, comment, at })),
    ...legacyMirrors(trims, packaging),
    sam: legacy.sam,
    skus: legacy.skus,
    ...(legacy.packing !== undefined ? { packing: legacy.packing } : {}),
  });

  const saveOrder = async ({ quiet = false } = {}) => {
    if (image?.uploading) { showToast("Espera a que termine de subir la foto"); throw new Error("uploading"); }
    setSaving(true);
    try {
      const res = await fetch(savedId ? `${API_URL}/api/style-orders/${savedId}` : `${API_URL}/api/style-orders`, {
        method: savedId ? "PUT" : "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(orderBody()),
      });
      const data = await res.json();
      if (res.status === 409) {
        // someone took this number in the meantime → fetch the next one
        setStyle((s) => ({ ...s, correlativo: "" }));
        setOrigStyle(null);
        goto(0);
      }
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo guardar");
      setSavedId(data.id);
      setOrigStyle({ ...style });
      if (!quiet) showToast(savedId ? "Estilo guardado" : "Borrador guardado", "ok");
      return data.id;
    } catch (err) {
      if (err.message !== "uploading") showToast(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const completeStyle = async () => {
    if (missing.length) { showToast(`Falta: ${missing.map((m) => m.label).join(", ")}`); return; }
    try {
      const id = await saveOrder({ quiet: true });
      setSaving(true);
      const res = await fetch(`${API_URL}/api/style-orders/${id}/complete`, { method: "POST", headers: jsonHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "No se pudo completar el estilo");
      setStatus(data.status);
      showToast(`Estilo ${styleCode} creado`, "ok");
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      if (err.message !== "uploading") showToast(err.message);
    } finally {
      setSaving(false);
    }
  };

  // summary passed to the action modals (same shape as a list row)
  const asRow = () => ({
    id: savedId,
    styleCode,
    styleNo: header.styleNo,
    styleName: header.styleName || header.description,
    customerName: header.customer,
    customerId: header.customerId,
    quantity: Number(header.quantity) || 0,
    deliveryDate: header.deliveryDate || null,
    status,
  });

  const st = STYLE_STATUS[status] || STYLE_STATUS.draft;

  // ------------------------------------------------------------------ render
  return (
    <div className="min-h-screen bg-slate-100">
      <div ref={topRef} />

      {/* Style header bar */}
      <div className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
              {image?.url ? <img src={image.url} alt="" className="h-full w-full object-cover" /> : <Shirt size={18} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold tracking-wider">{styleCode || "Nuevo estilo"}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
                {preOrder && <span className="rounded-full bg-violet-500/30 px-2 py-0.5 font-mono text-[10px]">{preOrder.no || `PRE #${preOrder.id}`}</span>}
                {workOrders.length > 0 && (
                  <span className="rounded-full bg-sky-500/30 px-2 py-0.5 font-mono text-[10px]" title={workOrders.map((w) => w.no).join(", ")}>
                    {workOrders.length === 1 ? String(workOrders[0].no).split("-")[0] : `${workOrders.length} PO`}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {[header.customer, header.styleNo, header.styleName || header.description, header.season].filter(Boolean).join("  ·  ") || "Elige tipo y modelo para generar el número de estilo"}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-[11px] text-slate-300">
            <span>SAM <b className="text-white">{num(header.samMinutes)} min</b></span>
            <span>Telas <b className="text-white">{fabrics.filter((f) => f.name || f.code).length}</b></span>
            <span>Colorways <b className="text-white">{colorways.length}</b></span>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
        {/* Stepper rail */}
        <aside className="lg:sticky lg:top-6 h-fit min-w-0">
          <ol className="space-y-1.5">
            {STEPS.map((s, i) => {
              const active = i === stepIdx;
              const state = stepState[s.id];
              return (
                <li key={s.id}>
                  <button
                    onClick={() => goto(i)}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                      active ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                        active ? "bg-white/15" : state === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {state === "ok" && !active ? <Check size={14} /> : s.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-tight truncate">{s.label}</span>
                      <span className={`block text-[11px] truncate ${active ? "text-slate-300" : "text-slate-400"}`}>{s.sub}</span>
                    </span>
                    {!active && (state === "warn" || (state === "todo" && stepIdx > i)) && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title={state === "warn" ? "Hay materiales sin código de catálogo" : "Falta información obligatoria"} />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* Step body */}
        <section className="space-y-6 pb-28 min-w-0">
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
              <RefreshCw size={15} className="animate-spin" /> Cargando estilo…
            </div>
          )}

          {/* ---- STEP 1: style number ---- */}
          {step.id === "estilo" && (
            <>
              {copiedFrom ? (
                <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  <Copy size={15} className="mt-0.5 shrink-0" />
                  <span>
                    Estilo nuevo basado en <b className="font-mono">{copiedFrom}</b>: ya trae BOM, colorways, tallas y confección.
                    Lleva el siguiente número de la misma serie; cambia tipo o modelo si es otro producto. Revisa consumos y guarda.
                  </span>
                </div>
              ) : !savedId && (
                <button type="button" onClick={() => setReuseDefaults(["ficha", "fabrics", "trims", "packaging", "colorways", "spec", "workmanship"])}
                  className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-left hover:border-slate-500">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Copy size={17} /></span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Empezar desde un estilo existente</span>
                    <span className="block text-xs text-slate-500">Copia BOM, colorways, tallas y confección de un estilo parecido y solo ajusta lo que cambia.</span>
                  </span>
                  <ChevronRight size={16} className="ml-auto text-slate-400" />
                </button>
              )}
              <SectionCard
                icon={Hash}
                title="1 · Número de estilo"
                subtitle="Tipo y modelo — el correlativo se genera solo"
                right={numberLocked ? <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Lock size={12} /> Fijo</span> : null}
              >
                <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-[11px] text-slate-500">Número de estilo</div>
                    <div className="font-mono text-3xl font-bold tracking-wider">
                      <span className={style.tipo ? segColor("tipo") : "text-slate-300"}>{style.tipo || "TTT"}</span>
                      <span className={style.modelo ? segColor("modelo") : "text-slate-300"}>{style.modelo || "MMM"}</span>
                      <span className={style.correlativo ? segColor("correlativo") : "text-slate-300"}>{style.correlativo || "00"}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Correlativo</label>
                    <input
                      value={style.correlativo}
                      disabled={numberLocked}
                      onChange={(e) => setStyle((s) => ({ ...s, correlativo: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) }))}
                      placeholder="01"
                      className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center font-mono text-sm tracking-widest outline-none focus:border-slate-500 disabled:bg-slate-100"
                    />
                  </div>
                  <span className="pb-2 text-[11px] text-slate-400">
                    {corrLoading ? "Buscando el siguiente correlativo…" : numberLocked ? "El estilo ya está completo; su número no cambia." : "Se reserva al guardar."}
                  </span>
                </div>

                <p className="text-xs font-medium text-slate-600 mb-2">Tipo</p>
                <ChipGrid options={TIPOS} value={style.tipo} disabled={numberLocked} onChange={(v) => setStyle((s) => ({ ...s, tipo: v, correlativo: "" }))} />
                <p className="text-xs font-medium text-slate-600 mt-5 mb-2">Modelo</p>
                <ChipGrid options={MODELOS} value={style.modelo} disabled={numberLocked} onChange={(v) => setStyle((s) => ({ ...s, modelo: v, correlativo: "" }))} />
              </SectionCard>

              <SectionCard icon={FileText} title="1 · Ficha del estilo" subtitle="Cliente, nombre y SAM de la sala de muestras">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label="Cliente" hint={header.customerId ? `Vinculado${header.clienteCode ? ` · ${header.clienteCode}` : ""}` : header.customer ? "No está en el catálogo de clientes" : null}>
                    <input list="so-customers" className={inputCls} value={header.customer || ""} onChange={(e) => setCustomerName(e.target.value)} />
                    <datalist id="so-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
                  </Field>
                  <Field label="Estilo del cliente"><input className={`${inputCls} font-mono`} value={header.styleNo} onChange={(e) => setHeaderField("styleNo", e.target.value)} placeholder="FN2808" /></Field>
                  <Field label="Nombre del estilo"><input className={inputCls} value={header.styleName} onChange={(e) => setHeaderField("styleName", e.target.value)} /></Field>
                  <Field label="Temporada"><input className={inputCls} value={header.season} onChange={(e) => setHeaderField("season", e.target.value)} placeholder="SU26" /></Field>
                  <div className="sm:col-span-2 md:col-span-3">
                    <Field label="Descripción"><input className={inputCls} value={header.description} onChange={(e) => setHeaderField("description", e.target.value)} placeholder="Pantalón dama invierno franela" /></Field>
                  </div>
                  <Field label="SAM (min)" hint="Medido en la sala de muestras">
                    <input type="number" step="any" min="0" className={`${inputCls} text-right font-mono`} value={header.samMinutes || ""} onChange={(e) => setHeaderField("samMinutes", e.target.value)} />
                  </Field>
                </div>
              </SectionCard>

              {/* Import / auto-fill */}
              <SectionCard
                icon={Upload}
                title="Importar y autocompletar"
                subtitle="Sube el tech pack y los pasos 2 a 5 se llenan solos"
                right={
                  <button onClick={() => setShowImport((v) => !v)} className="text-xs text-slate-500 hover:text-slate-800">
                    {showImport ? "Ocultar" : "Mostrar"}
                  </button>
                }
              >
                {showImport ? (
                  <>
                    <DropInput label="Tech pack (PDF)" hint="加工指導書 / BOM Nike — llena BOM, tallas, confección y colorways" accept="application/pdf,.pdf" icon={FileUp} busy={parsing} onFile={onTechPackFile} status={importStatus.pdf} />
                    <div className="mt-4 grid sm:grid-cols-2 gap-4">
                      <DropInput label="Especificación de tallas (.xlsx)" hint="Alterno → paso 3" onFile={onSizeFile} status={importStatus.size} />
                      <DropInput label="BOM / avíos (.xlsx)" hint="Alterno → paso 2" onFile={onMaterialsFile} status={importStatus.materials} />
                    </div>
                    <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />
                      Los avíos importados llegan con el código del cliente; vincúlalos al catálogo en el paso 2 para darles su código (CIE001…).
                    </p>
                    {importReview && (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold text-slate-600 mb-2">Resumen de importación — toca una sección para revisarla</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {importReview.sections.map((s) => {
                            const empty = s.n === 0;
                            const idx = STEPS.findIndex((x) => x.id === s.id);
                            return (
                              <button key={s.id} onClick={() => idx >= 0 && goto(idx)}
                                className={`text-left rounded-lg border px-3 py-2 ${empty ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                                <div className="flex items-center gap-1.5">
                                  {empty ? <AlertCircle size={13} className="text-amber-500" /> : <Check size={13} className="text-emerald-600" />}
                                  <span className="text-xs font-medium text-slate-700">{s.label}</span>
                                </div>
                                <div className={`mt-0.5 text-[11px] ${empty ? "text-amber-600" : "text-slate-400"}`}>{empty ? "Vacío — captura manual" : s.detail}</div>
                              </button>
                            );
                          })}
                        </div>
                        {importReview.warnings.length > 0 && (
                          <ul className="mt-3 space-y-0.5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                            {importReview.warnings.map((w, i) => <li key={i} className="text-[11px] text-amber-700">• {w}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-400">Tech pack PDF o xlsx de tallas / BOM.</p>
                )}
              </SectionCard>
            </>
          )}

          {/* ---- STEP 2: BOM ---- */}
          {step.id === "bom" && (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <Copy size={16} className="text-slate-400" />
                <span className="text-sm text-slate-600">¿Un estilo parecido ya tiene este BOM?</span>
                <button type="button" onClick={() => setReuseDefaults(["fabrics", "trims", "packaging"])}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-500">
                  <Copy size={13} /> Reusar BOM de otro estilo
                </button>
              </div>
              {!catalogOnline && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  El catálogo de materiales no respondió (/api/materials). Puedes capturar las líneas, pero no asignarles código de catálogo hasta que esté disponible.
                </div>
              )}
              <SectionCard icon={Layers} title="2 · Telas" subtitle="Nombre y código de la ficha de la tela · consumo de la sala de muestras · ancho · proveedor · PO de compra"
                right={<span className="text-[11px] text-slate-400">{fabrics.length}</span>}>
                <FabricLines rows={fabrics} onChange={setFabrics} catalog={fabricCatalog} onCatalogAdd={(f) => setFabricCatalog((xs) => [...xs, f])} />
              </SectionCard>
              <SectionCard icon={Tag} title="2 · Avíos" subtitle="Cada avío con su código de catálogo por tipo (CIE001, BOT001…) · pzs, unid, mts, yds o kg"
                right={<span className="text-[11px] text-slate-400">{trims.length}</span>}>
                <ItemLines rows={trims} onChange={setTrims} catalog={trimCatalog} types={trimTypes} onCatalogAdd={addToCatalog}
                  addLabel="Agregar avío" emptyText="Sin avíos. Agrega cierres, botones, etiquetas, hilo…" />
              </SectionCard>
              <SectionCard icon={Boxes} title="2 · Empaque" subtitle="Cada insumo con su código de catálogo por tipo (CAJ001, BOL001…)"
                right={<span className="text-[11px] text-slate-400">{packaging.length}</span>}>
                <ItemLines rows={packaging} onChange={setPackaging} catalog={packCatalog} types={packTypes} onCatalogAdd={addToCatalog}
                  addLabel="Agregar empaque" emptyText="Sin empaque. Agrega bolsa, caja, gancho, hangtag…" />
              </SectionCard>
            </>
          )}

          {/* ---- STEP 3: Size spec ---- */}
          {step.id === "tallas" && (
            <SectionCard
              icon={Ruler}
              title="3 · Tabla de especificación de tallas"
              subtitle="Puntos de medida (POM), tolerancias y valores por talla — cm"
              right={<span className="text-[11px] text-slate-400">{spec.length} POM · {SIZES.length} tallas</span>}
            >
              <div className="overflow-x-auto max-w-full">
                <table className="text-xs border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-slate-400">
                      <th className="sticky left-0 z-10 bg-white px-2 pb-2 min-w-[90px]">Código</th>
                      <th className="px-2 pb-2 min-w-[200px]">Punto de medida</th>
                      <th className="px-2 pb-2 min-w-[90px]">Criticidad</th>
                      <th className="px-1 pb-2 w-16 text-right">Tol −</th>
                      <th className="px-1 pb-2 w-16 text-right">Tol +</th>
                      {SIZES.map((s) => <th key={s} className="px-1 pb-2 w-20 text-right">{s}</th>)}
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {spec.map((row) => {
                      const set = (fields) => setSpec((rs) => rs.map((r) => (r.key === row.key ? { ...r, ...fields } : r)));
                      return (
                        <tr key={row.key} className="align-top">
                          <td className="sticky left-0 z-10 bg-white px-1 py-1"><input value={row.code} onChange={(e) => set({ code: e.target.value })} className={`${cellCls} font-mono w-[86px]`} /></td>
                          <td className="px-1 py-1"><input value={row.name} onChange={(e) => set({ name: e.target.value })} className={`${cellCls} min-w-[200px]`} title={row.how} /></td>
                          <td className="px-1 py-1">
                            <select value={row.crit} onChange={(e) => set({ crit: e.target.value })} className={cellCls}>
                              {CRITICALITY.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-1"><input value={row.tMinus} onChange={(e) => set({ tMinus: e.target.value })} className={`${cellCls} w-16 text-right`} /></td>
                          <td className="px-1 py-1"><input value={row.tPlus} onChange={(e) => set({ tPlus: e.target.value })} className={`${cellCls} w-16 text-right`} /></td>
                          {SIZES.map((sz) => (
                            <td key={sz} className="px-1 py-1">
                              <input value={row.vals?.[sz] ?? ""} onChange={(e) => set({ vals: { ...row.vals, [sz]: e.target.value } })}
                                className={`${cellCls} w-20 text-right ${row.vals?.[sz] ? "" : "text-slate-300"}`} />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <button onClick={() => setSpec((rs) => rs.filter((r) => r.key !== row.key))} className="p-1 text-slate-300 hover:text-rose-600"><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {spec.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Sin medidas. Agrégalas o importa el xlsx de tallas en el paso 1.</p>}
              <button
                onClick={() => setSpec((rs) => [...rs, { key: uid(), code: "", name: "", how: "", crit: "Mayor", tMinus: "", tPlus: "", vals: {} }])}
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                <Plus size={15} /> Agregar punto de medida
              </button>
            </SectionCard>
          )}

          {/* ---- STEP 4: Workmanship ---- */}
          {step.id === "confeccion" && (
            <SectionCard icon={Scissors} title="4 · Confección (workmanship)" subtitle="Operaciones en orden de ensamble, con máquina y SPI">
              <EditableTable
                addLabel="Agregar operación"
                onAdd={() => setWorkmanship((w) => [...w, { key: uid(), area: "", instr: "", machine: "Plana 1 aguja", spi: "" }])}
                onChange={setWorkmanship}
                rows={workmanship}
                columns={[
                  { key: "area", label: "Área / paso", width: 150 },
                  { key: "instr", label: "Instrucción", type: "textarea", width: 460, rows: 3 },
                  { key: "machine", label: "Máquina", type: "select", width: 180, options: MACHINES },
                  { key: "spi", label: "SPI", width: 60, align: "right" },
                ]}
              />
            </SectionCard>
          )}

          {/* ---- STEP 5: Colorway ---- */}
          {step.id === "colorway" && (
            <ColorwayStep colorways={colorways} onChange={setColorways} fabrics={fabrics} trims={trims} />
          )}

          {/* ---- STEP 6: Image ---- */}
          {step.id === "imagen" && (
            <>
              <SectionCard icon={Camera} title="6 · Imagen del estilo" subtitle="Foto principal (se guarda en S3)">
                <StyleImageCard image={image} onChange={setImage} onToast={showToast} />
              </SectionCard>
              <SectionCard icon={ImagePlus} title="Fotos de referencia" subtitle="Opcional · detalles, muestras anteriores, con un comentario por foto"
                right={<span className="text-[11px] text-slate-400">{qualityPhotos.length}</span>}>
                <QualityPhotoBoard photos={qualityPhotos} onChange={setQualityPhotos} onToast={showToast} />
              </SectionCard>
            </>
          )}

          {/* ---- STEP 7: Review + complete ---- */}
          {step.id === "completar" && (
            <>
              {!isDraft && (
                <SectionCard icon={Check} title={`Estilo ${styleCode} creado`} subtitle="Siguiente paso para este estilo">
                  <div className={`grid gap-3 sm:grid-cols-2 ${workOrders.length ? "xl:grid-cols-4" : "lg:grid-cols-3"}`}>
                    <ActionTile icon={Send} tone="emerald" title="Enviar a muestras" text="Solicitud a la sala de muestras con BOM y avíos." onClick={() => setModal("sample")} />
                    <ActionTile icon={Calculator} tone="slate" title="Costeo del estilo" text="Costo de telas, avíos, empaque y minutos." onClick={() => onAction?.("costing", asRow())} disabled={!onAction} />
                    {workOrders.length > 0 && !(preOrder && preOrder.status === "partially_converted") ? (
                      <ActionTile icon={ClipboardCheck} tone="sky"
                        title={workOrders.length === 1 ? "1 orden de producción" : `${workOrders.length} órdenes de producción`}
                        text={workOrders.map((w) => String(w.no).split("-")[0]).join(", ")}
                        onClick={() => onAction?.("orders", asRow())} disabled={!onAction} />
                    ) : null}
                    {workOrders.length > 0 && (
                      <ActionTile icon={ShoppingCart} tone="teal" title="Enviar BOM a compras"
                        text="Materiales por color para las PO, con merma, a la bandeja de compras." onClick={() => setModal("purchase")} />
                    )}
                    {workOrders.length > 0 && !(preOrder && preOrder.status === "partially_converted") ? null : preOrder && preOrder.status !== "cancelled" ? (
                      <ActionTile icon={ArrowRight} tone="violet"
                        title={preOrder.status === "partially_converted" ? `Convertir el resto de ${preOrder.no || "la pre-orden"}` : `Convertir ${preOrder.no || "pre-orden"} a PO`}
                        text={workOrders.length ? `Ya hay ${workOrders.length} PO(s): ${workOrders.map((w) => String(w.no).split("-")[0]).join(", ")}` : "La pre-orden ya existe; complétala con tallas y colores."}
                        onClick={() => navigate(`/nuevo-orden-wizard?preOrderId=${preOrder.id}`)} />
                    ) : (
                      <ActionTile icon={ClipboardList} tone="violet" title="Convertir a pre-orden" text="Compromete piezas; aparecerá en la pestaña de pre-órdenes." onClick={() => setModal("preorder")} />
                    )}
                  </div>
                </SectionCard>
              )}

              <SectionCard icon={ClipboardCheck} title={isDraft ? "7 · Revisar y completar" : "Resumen del estilo"} subtitle={isDraft ? "Al completar, se habilitan muestras, costeo y pre-orden" : "Los cambios se guardan con el botón de abajo"}>
                <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                  {checks.map((c, i) => (
                    <button key={i} type="button" onClick={() => goto(STEPS.findIndex((s) => s.id === c.id))}
                      className="flex items-center gap-2 border-b border-slate-50 py-2 text-left text-sm hover:bg-slate-50">
                      {c.ok ? <Check size={15} className="shrink-0 text-emerald-600" /> : <AlertCircle size={15} className="shrink-0 text-amber-500" />}
                      <span className="w-44 shrink-0 text-xs text-slate-500">{c.label}</span>
                      <span className={`truncate ${c.ok ? "text-slate-800" : "text-amber-600"}`}>{c.ok ? c.value || "✓" : "Falta"}</span>
                    </button>
                  ))}
                  <Row k="Avíos" v={`${trims.length}`} />
                  <Row k="Empaque" v={`${packaging.length}`} />
                  <Row k="Medidas (POM)" v={`${spec.length}`} />
                  <Row k="Operaciones" v={`${workmanship.length}`} />
                  <Row k="Imagen" v={image?.s3Key ? "Sí" : "Sin foto"} />
                </div>
                {unlinkedItems > 0 && (
                  <button type="button" onClick={() => goto(1)} className="mt-4 flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    {unlinkedItems} {unlinkedItems === 1 ? "material no tiene" : "materiales no tienen"} código de catálogo. Puedes completar el estilo, pero vincúlalos antes de costear.
                  </button>
                )}
              </SectionCard>
            </>
          )}
        </section>
      </main>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => goto(Math.max(0, stepIdx - 1))}
            disabled={stepIdx === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-40 hover:border-slate-400"
          >
            <ChevronLeft size={16} /> Anterior
          </button>
          <div className="hidden sm:block text-xs text-slate-400">Paso {step.n} de {STEPS.length} · {step.label}</div>
          <div className="ml-auto flex items-center gap-2">
            {onDone && (
              <button onClick={() => onDone(savedId)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:border-slate-400">
                {isDraft ? "Salir" : "Volver al listado"}
              </button>
            )}
            {(isDraft || step.id !== "completar") && (
              <button
                onClick={() => saveOrder().catch(() => {})}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
              >
                {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                {isDraft ? "Guardar borrador" : "Guardar"}
              </button>
            )}
            {step.id !== "completar" ? (
              <button onClick={() => goto(Math.min(STEPS.length - 1, stepIdx + 1))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Siguiente <ChevronRight size={16} />
              </button>
            ) : isDraft ? (
              <button
                onClick={completeStyle}
                disabled={saving || missing.length > 0}
                title={missing.length ? `Falta: ${missing.map((m) => m.label).join(", ")}` : ""}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
                Completar creación del estilo
              </button>
            ) : (
              <button onClick={() => saveOrder().catch(() => {})} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                Guardar cambios
              </button>
            )}
          </div>
        </div>
      </div>

      {modal === "sample" && savedId && (
        <SendToSampleModal
          order={asRow()}
          onClose={() => setModal(null)}
          onSent={() => { setModal(null); setStatus((s) => (s === "draft" || s === "completed" ? "sent_to_sample" : s)); showToast("Enviado a muestras", "ok"); }}
          onError={(m) => showToast(m)}
        />
      )}
      {reuseDefaults && (
        <ReuseFromStyleModal
          excludeId={savedId}
          defaults={reuseDefaults}
          currentCounts={currentCounts}
          onApply={applyReuse}
          onClose={() => setReuseDefaults(null)}
        />
      )}
      {modal === "purchase" && savedId && (
        <SendToPurchasingModal styleId={savedId} onClose={() => setModal(null)} onSent={(d) => showToast(`${d.requestNo} enviada a compras`, "ok")} />
      )}
      {modal === "preorder" && savedId && (
        <ConvertToPreOrderModal
          order={asRow()}
          onClose={() => setModal(null)}
          onConverted={(d) => { setStatus("pre_order"); setPreOrder({ id: d.preOrderId, no: d.preOrderNo }); }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === "ok" ? "bg-slate-900" : "bg-rose-600"}`}>
          {toast.kind === "ok" ? <Check size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}
    </div>
  );
}

function ChipGrid({ options, value, onChange, disabled }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {options.map((opt) => {
        const active = value === opt.code;
        return (
          <button
            key={opt.code}
            type="button"
            disabled={disabled && !active}
            onClick={() => !disabled && onChange(opt.code)}
            className={`rounded-lg border px-2 py-2 text-center transition-all disabled:opacity-35 ${
              active ? "border-slate-900 bg-slate-900 text-white shadow" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            <span className="block font-mono text-sm font-bold tracking-wider">{opt.code}</span>
            <span className={`block text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const TONES = {
  emerald: "bg-emerald-600 group-hover:bg-emerald-700",
  violet: "bg-violet-600 group-hover:bg-violet-700",
  slate: "bg-slate-900 group-hover:bg-slate-700",
  sky: "bg-sky-600 group-hover:bg-sky-700",
  teal: "bg-teal-600 group-hover:bg-teal-700",
};
function ActionTile({ icon: Icon, tone, title, text, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300 hover:shadow-sm disabled:opacity-40">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${TONES[tone]}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-slate-50 py-2">
      <span className="w-[calc(11rem+23px)] shrink-0 pl-[23px] text-xs text-slate-500">{k}</span>
      <span className="text-sm text-slate-800">{v || "—"}</span>
    </div>
  );
}