// components/FabricWH/FabricLabelPrint.jsx
// Almacén de Tela — Etiquetas de rollo.
//
// Prints one label per roll in the supplier's format:
//
//   Venta:Ray-Fabrics                      ┌──────┐
//   Fabric Code:1056980                    │  QR  │
//   Composition :89% poliéster …           └──────┘
//   PO:DA26080065
//   Color:00ABLACK
//   L.oT:YA070575          Width:152 cm
//   Roll:A2640
//              94.05 Y  86 M
//   ─────────────────────────────────────────────
//   ║║│║│║║│║║ (Code 128 of the roll)     18.60KG
//        A2640
//
// Both codes hold only the roll number (A2640), so the PDA reads either one in
// «Escanear rollos» like a Skytex label.
//
// Needs:  npm i qrcode jsbarcode   (loaded only when labels are drawn)
import { useState, useEffect, useMemo } from "react";
import { Printer, Search, X, AlertCircle } from "lucide-react";
import { num, cx, Modal, Button, Pill, STATUS } from "./fabricShared";

const SIZES = {
  "100x70": { label: "100 × 70 mm", w: 100, h: 70 },
  "102x76": { label: "4 × 3 in (102 × 76 mm)", w: 101.6, h: 76.2 },
  "100x80": { label: "100 × 80 mm", w: 100, h: 80 },
};
const SIZE_KEY = "fabricLabelSize";
const MAX_LABELS = 500;

// ---------------------------------------------------------------------------
// Label content
// ---------------------------------------------------------------------------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n2 = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : null;
};
const fileOf = (r) => {
  const raw = typeof r.raw === "string" ? (() => { try { return JSON.parse(r.raw); } catch { return null; } })() : r.raw;
  return raw && typeof raw === "object" ? raw._archivo || null : null;
};

export function labelFields(r) {
  const yards = n2(r.yards) ?? (n2(r.meters) != null ? n2(Number(r.meters) / 0.9144) : null);
  const meters = n2(r.meters) ?? (n2(r.yards) != null ? n2(Number(r.yards) * 0.9144) : null);
  const qty = [yards != null && `${yards} Y`, meters != null && `${meters} M`].filter(Boolean).join("\u2003");
  const wNum = Number(r.weight);
  const unit = String(r.weight_unit || "KG").trim().toUpperCase();
  const weight = r.weight == null || r.weight === "" ? "" : Number.isFinite(wNum) ? `${wNum.toFixed(2)}${unit}` : `${r.weight}${r.weight_unit ? ` ${r.weight_unit}` : ""}`;
  const width = [r.width, r.width_unit].filter((x) => x != null && x !== "").join(" ");
  return {
    venta: r.supplier || "",
    code: r.fabric_item_number || "",
    composition: r.composition || "",
    po: r.po_number || "",
    color: r.color || "",
    lot: r.lot || "",
    width,
    roll: r.roll_no || "",
    qty,
    weight,
  };
}

// What the QR holds: only the roll number.
export function qrText(r) {
  return String(r.roll_no || "").trim();
}

let libs = null;
async function loadLibs() {
  if (!libs) {
    libs = Promise.all([import("qrcode"), import("jsbarcode")]).then(([q, b]) => ({
      QR: q.default || q,
      JsBarcode: b.default || b,
    })).catch((e) => { libs = null; throw e; });
  }
  return libs;
}

async function codesFor(r) {
  const { QR, JsBarcode } = await loadLibs();
  const qr = await QR.toString(qrText(r), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  let bar = "";
  try {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(el, String(r.roll_no), { format: "CODE128", displayValue: false, margin: 0, height: 60, width: 2, background: "#ffffff", lineColor: "#000000" });
    const w = el.getAttribute("width");
    const h = el.getAttribute("height");
    el.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
    el.setAttribute("preserveAspectRatio", "none");
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.removeAttribute("style");
    bar = el.outerHTML;
  } catch { bar = ""; }
  return { qr, bar };
}

function labelHtml(r, { qr, bar }) {
  const f = labelFields(r);
  return `<div class="label">
  <div class="top">
    <div class="info">
      <div>Venta:${esc(f.venta)}</div>
      <div>Fabric Code:${esc(f.code)}</div>
      <div class="comp">Composition :${esc(f.composition)}</div>
      <div>PO:${esc(f.po)}</div>
      <div>Color:${esc(f.color)}</div>
    </div>
    <div class="qr">${qr}</div>
  </div>
  <div class="pair"><span>L.oT:${esc(f.lot)}</span><span>Width:${esc(f.width)}</span></div>
  <div class="line">Roll:${esc(f.roll)}</div>
  <div class="qty">${esc(f.qty) || "&nbsp;"}</div>
  <div class="rule"></div>
  <div class="bottom">
    <div class="bc">${bar}<div class="bcText">${esc(f.roll)}</div></div>
    <div class="kg">${esc(f.weight)}</div>
  </div>
</div>`;
}

function pageHtml(labels, size, { preview = false } = {}) {
  const { w, h } = SIZES[size] || SIZES["100x70"];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas de rollos</title>
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${preview ? "#ffffff" : "transparent"}; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: ${w}mm; height: ${h}mm; padding: 3mm 3.5mm 2.5mm; display: flex; flex-direction: column; overflow: hidden;
           page-break-after: always; break-after: page; }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .top { display: flex; gap: 3mm; align-items: flex-start; }
  .info { flex: 1; min-width: 0; font-size: 3.2mm; line-height: 1.28; font-weight: 700; }
  .info > div { overflow-wrap: anywhere; }
  .comp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .qr { width: 19mm; height: 19mm; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .pair { display: flex; gap: 8mm; font-size: 3.2mm; font-weight: 700; margin-top: 0.6mm; }
  .pair span:first-child { min-width: 34mm; }
  .line { font-size: 3.2mm; font-weight: 700; margin-top: 0.4mm; }
  .qty { text-align: center; font-size: 5.4mm; font-weight: 800; margin: 1.6mm 0 1.4mm; letter-spacing: 0.1mm; }
  .rule { border-top: 0.35mm solid #000; margin: 0 -3.5mm; }
  .bottom { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 4mm; padding-top: 1.5mm; }
  .bc { width: 46mm; }
  .bc svg { width: 100%; height: 11mm; display: block; }
  .bcText { text-align: center; font-size: 3.2mm; font-weight: 700; margin-top: 0.6mm; }
  .kg { font-size: 5mm; font-weight: 800; white-space: nowrap; }
</style></head><body>${labels.join("")}</body></html>`;
}

function printHtml(html) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener("afterprint", done);
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.isConnected && frame.remove(), 120000);
  }, 250);
}

// ---------------------------------------------------------------------------
// Dialog. rolls = the rolls to choose from; preselect = ids checked on open.
// ---------------------------------------------------------------------------
export default function FabricLabelPrint({ open, onClose, rolls = [], preselect = null, title = "Imprimir etiquetas" }) {
  const [size, setSize] = useState(() => { try { return localStorage.getItem(SIZE_KEY) || "100x70"; } catch { return "100x70"; } });
  const [copies, setCopies] = useState(1);
  const [q, setQ] = useState("");
  const [file, setFile] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const [focus, setFocus] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const files = useMemo(() => [...new Set(rolls.map(fileOf).filter(Boolean))], [rolls]);

  // Reset whenever the dialog opens with a new list.
  useEffect(() => {
    if (!open) return;
    setQ(""); setError(null); setCopies(1);
    setFile(preselect ? "" : files[files.length - 1] || "");
    setSel(new Set(preselect ? preselect.map(String) : []));
    setFocus(preselect?.length ? String(preselect[0]) : rolls[0] ? String(rolls[0].id) : null);
  }, [open, rolls, preselect]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { try { localStorage.setItem(SIZE_KEY, size); } catch { /* ignore */ } }, [size]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rolls.filter((r) => {
      if (file && fileOf(r) !== file) return false;
      if (!t) return true;
      return [r.roll_no, r.po_number, r.lot, r.color, r.fabric_name, r.fabric_item_number, r.supplier]
        .some((v) => String(v ?? "").toLowerCase().includes(t));
    });
  }, [rolls, q, file]);

  const chosen = rolls.filter((r) => sel.has(String(r.id)));
  const allOn = shown.length > 0 && shown.every((r) => sel.has(String(r.id)));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    shown.forEach((r) => (allOn ? n.delete(String(r.id)) : n.add(String(r.id))));
    return n;
  });
  const total = chosen.length * copies;
  const missing = chosen.filter((r) => !r.supplier || (r.yards == null && r.meters == null) || r.weight == null).length;

  // Preview of one label (the focused roll, else the first selected).
  const focusRoll = rolls.find((r) => String(r.id) === focus) || chosen[0] || shown[0];
  useEffect(() => {
    let alive = true;
    if (!open || !focusRoll) { setPreview(""); return undefined; }
    codesFor(focusRoll)
      .then((c) => { if (alive) setPreview(pageHtml([labelHtml(focusRoll, c)], size, { preview: true })); })
      .catch(() => { if (alive) setError("Faltan las librerías para dibujar el QR y el código de barras (npm i qrcode jsbarcode)."); });
    return () => { alive = false; };
  }, [open, focusRoll, size]);

  const print = async () => {
    if (!chosen.length) return;
    if (total > MAX_LABELS) { setError(`Máximo ${MAX_LABELS} etiquetas por impresión. Seleccione menos rollos o menos copias.`); return; }
    setBusy(true); setError(null);
    try {
      const labels = [];
      for (const r of chosen) {
        const html = labelHtml(r, await codesFor(r));
        for (let i = 0; i < copies; i++) labels.push(html);
      }
      printHtml(pageHtml(labels, size));
    } catch (e) {
      setError(e.message || "No se pudieron generar las etiquetas.");
    } finally { setBusy(false); }
  };

  const { w, h } = SIZES[size];
  const pxW = Math.round(w * 3.78);
  const pxH = Math.round(h * 3.78);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-500">
            {chosen.length} rollo(s){copies > 1 ? ` × ${copies}` : ""} · {total} etiqueta(s)
          </span>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button icon={Printer} loading={busy} disabled={!chosen.length} onClick={print}>Imprimir {total} etiqueta(s)</Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[1fr_auto] gap-5">
        {/* Rolls */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[12rem] flex items-center gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 h-9">
              <Search className="w-4 h-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rollo, PO, lote, color" aria-label="Buscar rollos"
                className="flex-1 min-w-0 bg-transparent text-sm outline-none" />
              {q && <button onClick={() => setQ("")} aria-label="Borrar búsqueda" className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
            </div>
            {files.length > 0 && (
              <select value={file} onChange={(e) => setFile(e.target.value)} aria-label="Archivo"
                className="h-9 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-sm bg-white max-w-[14rem] focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Todos los rollos</option>
                {files.map((f) => <option key={f} value={f}>Archivo {f}</option>)}
              </select>
            )}
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
            <label className="px-3 py-2 flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border-b border-slate-200">
              <input type="checkbox" className="rounded border-slate-300 text-indigo-600" checked={allOn} onChange={toggleAll} />
              Todos{q || file ? " los filtrados" : ""} ({shown.length})
            </label>
            <ul className="max-h-[46vh] overflow-y-auto divide-y divide-slate-100">
              {shown.map((r) => {
                const id = String(r.id);
                const on = sel.has(id);
                return (
                  <li key={id} className={cx("flex items-center gap-3 px-3 py-2", on && "bg-indigo-50/60", focus === id && "ring-1 ring-inset ring-indigo-300")}>
                    <input type="checkbox" className="rounded border-slate-300 text-indigo-600 w-4 h-4 shrink-0" checked={on} onChange={() => toggle(id)} aria-label={`Seleccionar ${r.roll_no}`} />
                    <button onClick={() => setFocus(id)} className="min-w-0 flex-1 text-left" title="Ver la etiqueta">
                      <div className="font-mono text-sm font-semibold text-slate-900 truncate">{r.roll_no}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {[r.po_number && `PO ${r.po_number}`, r.lot && `Lote ${r.lot}`, r.color].filter(Boolean).join(" · ") || "Sin datos"}
                      </div>
                    </button>
                    {r.status && r.status !== "requested" && <Pill tone="slate">{STATUS[r.status]?.label || (r.status === "arrived" ? "Por asignar" : r.status)}</Pill>}
                    <span className="text-xs text-slate-500 fab-tnum w-14 text-right shrink-0">{r.yards != null ? `${num(r.yards, 1)} yd` : "—"}</span>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-3 py-6 text-sm text-slate-500 text-center">Ningún rollo coincide.</li>}
            </ul>
          </div>
        </div>

        {/* Options + preview */}
        <div className="space-y-3 lg:w-[400px]">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-600">
              Tamaño de etiqueta
              <select value={size} onChange={(e) => setSize(e.target.value)}
                className="mt-1 block h-9 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {Object.entries(SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Copias por rollo
              <input type="number" min={1} max={5} value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 1)))}
                className="mt-1 block h-9 w-20 rounded-lg ring-1 ring-inset ring-slate-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1.5">Vista previa{focusRoll ? ` · ${focusRoll.roll_no}` : ""}</div>
            <div className="rounded-xl bg-slate-100 p-3 overflow-auto">
              {preview ? (
                <iframe title="Vista previa de la etiqueta" srcDoc={preview} style={{ width: pxW, height: pxH }}
                  className="block mx-auto bg-white shadow ring-1 ring-slate-300" />
              ) : (
                <div style={{ width: Math.min(pxW, 360), height: Math.min(pxH, 260) }} className="mx-auto bg-white ring-1 ring-slate-200 flex items-center justify-center text-sm text-slate-400">
                  {rolls.length ? "Preparando…" : "Sin rollos"}
                </div>
              )}
            </div>
          </div>

          {missing > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              {missing} rollo(s) seleccionados no tienen proveedor, yardas o peso; esos datos saldrán vacíos en la etiqueta.
            </div>
          )}
          {error && (
            <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <p className="text-xs text-slate-500">
            En el cuadro de impresión elija la impresora de etiquetas, margen «Ninguno» y escala 100 %.
          </p>
        </div>
      </div>
    </Modal>
  );
}