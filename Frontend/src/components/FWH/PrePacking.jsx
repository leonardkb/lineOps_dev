// components/warehouse/PrePacking.jsx
// Almacén de Producto Terminado — Pre-empaque.
// Create a pre-packing list for a client + work order (PO), add boxes (mostly
// auto-filled from the order), then confirm the list to push its boxes into
// finished inventory.
import { Fragment, useState, useEffect, useCallback } from "react";
import {
  Package, Plus, Check, ChevronLeft, Loader2, AlertCircle,
  Boxes, ClipboardList, RefreshCw, Download, ChevronDown, ChevronRight, Clock,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Size code -> printable label. Keep in sync with SIZE_LABELS in
// finished-warehouse.js (the export uses that copy). Any code without a label
// falls back to showing the code itself. PARTIAL LIST — extend as needed.
const SIZE_LABELS = {
  "130": "xxxs", "132": "xxs", "134": "xs", "136": "(S)", "138": "(M)",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const sizeLabelOf = (code) => {
  const k = String(code ?? "").trim();
  return SIZE_LABELS[k] ?? k;
};

// Local "today" as YYYY-MM-DD (for <input type="date"> defaults).
const todayYMD = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

const num = (v) => Math.round(Number(v) || 0).toLocaleString();

// Thin fetch wrapper: throws on non-ok so callers can try/catch once.
async function api(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export default function PrePacking() {
  const [view, setView] = useState("index");      // "index" | "editor"
  const [toast, setToast] = useState(null);
  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  // ---- index ----
  const [lists, setLists] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    try { const d = await api("/api/pre-packing-lists"); setLists(d.lists || []); }
    catch (e) { showToast(e.message, true); }
    finally { setLoadingLists(false); }
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  // ---- new-list picker ----
  const [clients, setClients] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [pick, setPick] = useState({ customerId: "", workOrderId: "", asOfDate: todayYMD() });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api("/api/finished-warehouse/clients").then((d) => setClients(d.clients || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!pick.customerId) { setWorkOrders([]); return; }
    api(`/api/finished-warehouse/work-orders?customerId=${pick.customerId}`)
      .then((d) => setWorkOrders(d.workOrders || []))
      .catch(() => setWorkOrders([]));
  }, [pick.customerId]);

  // ---- editor ----
  const [list, setList] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [busy, setBusy] = useState(false);

  // Cut-off day + per-size progress (accumulated produced vs ordered, to that day).
  const [asOfDate, setAsOfDate] = useState(todayYMD());
  const [progress, setProgress] = useState(null);      // { sizes, totals, availableDays, date }
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [pickedSizes, setPickedSizes] = useState(null); // Set of size_code, or null = all

  // Read the per-size progress for a list at a given day (read-only, no box writes).
  const loadProgress = useCallback(async (listId, date) => {
    setLoadingProgress(true);
    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : "";
      const d = await api(`/api/pre-packing-lists/${listId}/size-progress${qs}`);
      setProgress(d);
    } catch (e) { showToast(e.message, true); }
    finally { setLoadingProgress(false); }
  }, []);

  // Pull the order lines into boxes as the accumulated per-size production to `date`.
  const regenerateBoxes = async (listId, date = asOfDate) => {
    setBusy(true);
    try {
      const d = await api(`/api/pre-packing-lists/${listId}/generate-boxes`, {
        method: "POST",
        body: JSON.stringify({ asOfDate: date || "" }),
      });
      setBoxes(d.boxes || []);
      if (d.asOfDate !== undefined) setList((prev) => (prev ? { ...prev, as_of_date: d.asOfDate } : prev));
      await loadProgress(listId, date);
      showToast(
        date
          ? `${d.boxesGenerated || 0} caja(s) · acumulado al ${date}`
          : `${d.boxesGenerated || 0} caja(s) generadas desde la orden`
      );
    } catch (e) { showToast(e.message, true); }
    finally { setBusy(false); }
  };

  const openEditor = async (listId) => {
    try {
      const d = await api(`/api/pre-packing-lists/${listId}`);
      setList(d.list);
      setBoxes(d.boxes || []);
      const day = (d.list.as_of_date && String(d.list.as_of_date).slice(0, 10)) || todayYMD();
      setAsOfDate(day);
      setPickedSizes(null);
      setView("editor");
      // The effect below reads the progress for `day`; no need to fetch it twice.
      // Seed older/empty draft lists straight from their order so the user can
      // just export. Lists created after this change already arrive populated.
      if (d.list.status === "draft" && d.list.work_order_id && (d.boxes || []).length === 0) {
        regenerateBoxes(listId, day);
      }
    } catch (e) { showToast(e.message, true); }
  };

  // Changing the date now updates "Progreso por talla" straight away — the
  // operator can look at any day without regenerating boxes first. Regenerating
  // is still what writes those pieces into the list.
  useEffect(() => {
    if (view !== "editor" || !list?.id || !list?.work_order_id) return;
    loadProgress(list.id, asOfDate);
  }, [view, list?.id, list?.work_order_id, asOfDate, loadProgress]);

  const createList = async () => {
    if (!pick.customerId) return showToast("Seleccione un cliente", true);
    setCreating(true);
    try {
      const d = await api("/api/pre-packing-lists", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(pick.customerId),
          workOrderId: pick.workOrderId ? Number(pick.workOrderId) : null,
          asOfDate: pick.asOfDate || "",
        }),
      });
      setPick({ customerId: "", workOrderId: "", asOfDate: todayYMD() });
      await loadLists();

      // The order may split into one list per PO cliente.
      const created = d.lists || (d.list ? [{ list: d.list, boxesGenerated: d.boxesGenerated }] : []);
      if (created.length === 0) { showToast("No se pudo crear la lista", true); return; }

      if (created.length > 1) {
        const total = created.reduce((s, c) => s + (c.boxesGenerated || 0), 0);
        showToast(`${created.length} listas creadas (una por PO cliente) · ${total} caja(s)`);
      } else {
        showToast(
          created[0].boxesGenerated
            ? `Lista ${created[0].list.list_no} creada · ${created[0].boxesGenerated} caja(s) desde la orden`
            : `Lista ${created[0].list.list_no} creada`
        );
      }
      // Open the first list so the operator lands somewhere; the rest are in the index.
      await openEditor(created[0].list.id);
    } catch (e) { showToast(e.message, true); }
    finally { setCreating(false); }
  };

  // Download the list as Excel (.xlsx / .xls) or CSV. Uses fetch (not a plain
  // link) so the auth token is sent, then saves the returned blob.
  const exportList = async (listId, listNo, format = "xlsx") => {
    try {
      const res = await fetch(`${API_URL}/api/pre-packing-lists/${listId}/export?format=${format}`, { headers: authHeaders() });
      if (!res.ok) {
        let msg = "No se pudo exportar la lista";
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const ext = format === "xls" ? "xls" : format === "csv" ? "csv" : "xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${listNo || `pre-empaque-${listId}`}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { showToast(e.message, true); }
  };

  const confirmList = async () => {
    if (boxes.length === 0) return showToast("Agregue al menos una caja", true);
    if (!window.confirm(`Confirmar la lista ${list.list_no}? Las ${boxes.length} caja(s) se sumarán al inventario y la lista quedará bloqueada.`)) return;
    setBusy(true);
    try {
      const d = await api(`/api/pre-packing-lists/${list.id}/confirm`, { method: "POST" });
      setList(d.list);
      await loadLists();
      showToast(`Confirmada · ${Math.round(d.piecesAdded).toLocaleString()} pzas al inventario`);
    } catch (e) { showToast(e.message, true); }
    finally { setBusy(false); }
  };

  // The box table lives in the export now; here we only show how much it carries.
  const totalPieces = boxes.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
  const locked = list?.status !== "draft";

  // =====================================================================
  //  INDEX VIEW
  // =====================================================================
  if (view === "index") {
    return (
      <div className="max-w-6xl mx-auto p-5 space-y-5">
        <Toast toast={toast} />

        <header className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Pre-empaque</h1>
            <p className="text-sm text-gray-500">Arme la lista de cajas por cliente y orden, luego confírmela al inventario.</p>
          </div>
        </header>

        {/* New list */}
        <section className="bg-white rounded-xl border shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-600" /> Nueva lista de pre-empaque
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label="Cliente">
              <select value={pick.customerId}
                onChange={(e) => setPick((p) => ({ ...p, customerId: e.target.value, workOrderId: "" }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Seleccione…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Orden / PO (del día)">
              <select value={pick.workOrderId} disabled={!pick.customerId}
                onChange={(e) => setPick((p) => ({ ...p, workOrderId: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-gray-50">
                <option value="">{pick.customerId ? "Seleccione…" : "Elija cliente primero"}</option>
                {workOrders.map((w) => <option key={w.id} value={w.id}>{w.po}{w.mo ? ` · MO ${w.mo}` : ""}{w.style ? ` · ${w.style}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Fecha (acumulado hasta)">
              <input type="date" value={pick.asOfDate} max={todayYMD()}
                onChange={(e) => setPick((p) => ({ ...p, asOfDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </Field>
            <div className="flex items-end">
              <button onClick={createList} disabled={!pick.customerId || creating}
                className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear lista
              </button>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-gray-500">
            Las piezas por talla son el <span className="font-medium">acumulado</span> de lo que
            las líneas han terminado <span className="font-medium">hasta la fecha elegida</span>.
          </p>
        </section>

        {/* Existing lists */}
        <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800">Listas</h2>
            <span className="text-xs text-gray-400">({lists.length})</span>
          </div>
          {loadingLists ? (
            <div className="p-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
            </div>
          ) : lists.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Aún no hay listas. Cree la primera arriba.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Lista</th>
                  <th className="text-left px-4 py-2 font-medium">Cliente</th>
                  <th className="text-left px-4 py-2 font-medium">PO</th>
                  <th className="text-left px-4 py-2 font-medium">MO</th>
                  <th className="text-right px-4 py-2 font-medium">Cajas</th>
                  <th className="text-right px-4 py-2 font-medium">Pzas</th>
                  <th className="text-left px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lists.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono font-medium text-gray-900">{l.list_no || `#${l.id}`}</td>
                    <td className="px-4 py-2 text-gray-700">{l.customer_name || "—"}</td>
                    <td className="px-4 py-2 font-mono text-gray-700">{l.po || "—"}</td>
                    <td className="px-4 py-2 font-mono text-gray-500">{l.mo || "—"}</td>
                    <td className="px-4 py-2 text-right">{l.box_count}</td>
                    <td className="px-4 py-2 text-right">{Math.round(Number(l.total_qty) || 0).toLocaleString()}</td>
                    <td className="px-4 py-2"><StatusPill status={l.status} /></td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => exportList(l.id, l.list_no)} disabled={!l.box_count}
                          className="text-gray-500 hover:text-gray-800 disabled:opacity-40 inline-flex items-center gap-1" title="Exportar CSV">
                          <Download className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEditor(l.id)} className="text-indigo-600 hover:text-indigo-800 font-medium">
                          {l.status === "draft" ? "Editar" : "Ver"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  }

  // =====================================================================
  //  EDITOR VIEW
  // =====================================================================
  return (
    <div className="max-w-6xl mx-auto p-5 space-y-4">
      <Toast toast={toast} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={() => { setView("index"); setList(null); }} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> Listas
        </button>
        <div className="flex items-center gap-2">
          {boxes.length > 0 && (
            <span className="text-xs text-gray-500 mr-1">
              {boxes.length} caja(s) · <b className="text-gray-700">{num(totalPieces)}</b> pzas por exportar
            </span>
          )}
          <StatusPill status={list?.status} />
          <ExportMenu disabled={boxes.length === 0} onExport={(fmt) => exportList(list.id, list.list_no, fmt)} />
          <button onClick={confirmList} disabled={locked || busy || boxes.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
            <Check className="w-4 h-4" /> Confirmar → Inventario
          </button>
        </div>
      </div>

      {/* List header */}
      <section className="bg-white rounded-xl border shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono font-bold text-gray-900">{list?.list_no}</span>
          {locked && <span className="text-xs text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">Confirmada · bloqueada</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <ReadOnly label="Cliente" value={list?.customer_name} />
          <ReadOnly label="Código cliente" value={list?.customer_code} />
          <ReadOnly label="PO (orden)" value={list?.po} mono />
          <ReadOnly label="MO (PO cliente)" value={list?.mo} mono />
        </div>
      </section>

      {/* Auto-generation — the list is built from the order, not typed by hand */}
      {!locked && (
        <section className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-indigo-600" /> Cajas desde la orden
              </h2>
              <p className="mt-1 text-[12px] text-gray-500">
                Las piezas por talla son el <span className="font-medium">acumulado</span> de lo
                que las líneas han terminado <span className="font-medium">hasta la fecha
                elegida</span>, tomado de los tickets impresos por la línea. Cambie la fecha y use
                «Regenerar» para reflejar la producción de ese día, luego exporte.
              </p>
              {!list?.work_order_id && (
                <p className="mt-1 text-[12px] text-amber-600">
                  Esta lista no tiene una orden asociada, así que no hay líneas para generar.
                </p>
              )}
            </div>
          </div>
          {list?.work_order_id && (
            <div className="flex items-end gap-2 flex-wrap">
              <Field label="Acumulado hasta la fecha">
                <input type="date" value={asOfDate} max={todayYMD()}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm" />
              </Field>
              <button onClick={() => regenerateBoxes(list.id, asOfDate)} disabled={busy}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {boxes.length > 0 ? "Regenerar a esta fecha" : "Generar a esta fecha"}
              </button>
              {(progress?.availableDays?.length > 0) && (
                <span className="text-[11px] text-gray-400 pb-2">
                  Días con producción: {progress.availableDays.slice(0, 6).join(", ")}
                  {progress.availableDays.length > 6 ? "…" : ""}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {/* Progreso por talla: acumulado a la fecha vs. ordenado (cuánto falta) */}
      {list?.work_order_id && (
        <SizeProgressPanel
          progress={progress}
          loading={loadingProgress}
          asOfDate={asOfDate}
          pickedSizes={pickedSizes}
          onTogglePicked={setPickedSizes}
        />
      )}
    </div>
  );
}

// ---- size progress (accumulated produced-to-date vs ordered) ----

// Per-size panel: how much each talla has ACCUMULATED up to the chosen day, its
// ordered total, and how much is left to reach it. The operator can pick which
// sizes to look at; totals reflect the picked subset.
function SizeProgressPanel({ progress, loading, asOfDate, pickedSizes, onTogglePicked }) {
  const sizes = progress?.sizes || [];
  const allCodes = [...new Set(sizes.map((s) => s.size_code))];
  const isPicked = (code) => pickedSizes === null || pickedSizes.has(code);
  const shown = sizes.filter((s) => isPicked(s.size_code));

  // Which rows are showing their captures. Keyed the same way the server groups.
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (k) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  const anyEntries = shown.some((s) => (s.entries || []).length > 0);

  // Dos códigos de talla distintos pueden compartir etiqueta (132 y 134 son
  // ambos "xs"). Cuando eso pasa se muestra el código para poder distinguirlos:
  // si el ordenado viene en uno y los tickets en otro, aquí se ve enseguida.
  const labelCount = new Map();
  for (const c of allCodes) {
    const l = sizeLabelOf(c);
    labelCount.set(l, (labelCount.get(l) || 0) + 1);
  }
  const showCode = (code) => (labelCount.get(sizeLabelOf(code)) || 0) > 1;
  const sizeText = (code) => (showCode(code) ? `${sizeLabelOf(code)} (${code})` : sizeLabelOf(code));

  const togglePick = (code) => {
    const base = pickedSizes === null ? new Set(allCodes) : new Set(pickedSizes);
    if (base.has(code)) base.delete(code); else base.add(code);
    // Back to "all" when everything is selected again (keeps the null = all invariant tidy).
    onTogglePicked(base.size === allCodes.length ? null : base);
  };

  const totals = shown.reduce(
    (t, s) => { t.ordered += s.ordered; t.produced += s.produced; t.remaining += s.remaining; return t; },
    { ordered: 0, produced: 0, remaining: 0 }
  );
  const pct = totals.ordered > 0 ? Math.min(100, Math.round((totals.produced / totals.ordered) * 100)) : 0;

  return (
    <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2 flex-wrap">
        <ClipboardList className="w-4 h-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-800">Progreso por talla</h2>
        <span className="text-xs text-gray-400">acumulado {asOfDate ? `al ${asOfDate}` : "(todo el tiempo)"}</span>
        {anyEntries && (
          <span className="text-[11px] text-gray-400">· toque una talla para ver cuándo entró cada tanto</span>
        )}
        <span className="ml-auto text-sm text-gray-600">
          <b className="text-gray-900">{num(totals.produced)}</b>
          <span className="text-gray-400"> / {num(totals.ordered)} pzas</span>
          {totals.remaining > 0 && <span className="text-amber-600"> · faltan {num(totals.remaining)}</span>}
        </span>
      </div>

      {/* Size chips: pick which tallas to view */}
      {allCodes.length > 0 && (
        <div className="px-4 pt-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-gray-400">Tallas:</span>
          {allCodes.map((code) => (
            <button
              key={code}
              onClick={() => togglePick(code)}
              className={`text-[11px] rounded-full px-2 py-0.5 font-medium border transition ${
                isPicked(code)
                  ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                  : "bg-white text-gray-400 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {sizeText(code)}
            </button>
          ))}
          {pickedSizes !== null && (
            <button onClick={() => onTogglePicked(null)} className="text-[11px] text-gray-500 hover:text-gray-800 ml-1 underline">
              todas
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : shown.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          {sizes.length === 0
            ? "Ninguna línea ha reportado producción para esta orden todavía."
            : "Ninguna talla seleccionada."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Size</th>
                <th className="text-left px-3 py-2 font-medium">Color</th>
                <th className="text-left px-3 py-2 font-medium">Estilo</th>
                <th className="text-right px-3 py-2 font-medium">Acumulado</th>
                <th className="text-right px-3 py-2 font-medium">Total (meta)</th>
                <th className="text-right px-3 py-2 font-medium">Faltan</th>
                <th className="text-left px-3 py-2 font-medium w-40">Avance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((s) => {
                const p = s.ordered > 0 ? Math.min(100, Math.round((s.produced / s.ordered) * 100)) : 0;
                const done = s.remaining <= 0 && s.ordered > 0;
                const rk = rowKeyOf(s);
                const entries = s.entries || [];
                const open = openRows.has(rk);
                return (
                  <Fragment key={rk}>
                    <tr
                      className={`hover:bg-gray-50 ${entries.length > 0 ? "cursor-pointer" : ""}`}
                      onClick={() => entries.length > 0 && toggleRow(rk)}
                    >
                      <td className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          {entries.length > 0 ? (
                            open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                 : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                          ) : (
                            <span className="w-3.5" />
                          )}
                          {sizeText(s.size_code)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{s.color || "—"}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">
                        {s.estilo || s.style_code || "—"}
                        {s.style_code && s.estilo && s.style_code !== s.estilo && (
                          <span className="block text-[10px] text-gray-400" title="Código de estilo (tipo+modelo+correlativo) que reportan las líneas">
                            {s.style_code}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-semibold text-gray-900">{num(s.produced)}</span>
                        {entries.length > 0 && (
                          <span className="block text-[10px] text-gray-400 font-normal">
                            {entries.length} captura{entries.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 align-top">{num(s.ordered)}</td>
                      <td className={`px-3 py-2 text-right font-medium align-top ${done ? "text-emerald-600" : "text-amber-600"}`}>
                        {done ? "✓" : num(s.remaining)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden min-w-[60px]">
                            <div className={`h-full ${done ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${p}%` }} />
                          </div>
                          <span className="text-[11px] text-gray-400 w-9 text-right">{p}%</span>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={7} className="px-3 pb-3 pt-1">
                          <EntriesTable entries={entries} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-medium">
                <td className="px-3 py-2" colSpan={3}>Total {pickedSizes !== null ? "(selección)" : ""}</td>
                <td className="px-3 py-2 text-right text-gray-900">{num(totals.produced)}</td>
                <td className="px-3 py-2 text-right text-gray-500">{num(totals.ordered)}</td>
                <td className="px-3 py-2 text-right text-amber-600">{totals.remaining > 0 ? num(totals.remaining) : "✓"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden min-w-[60px]">
                      <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 w-9 text-right">{pct}%</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// A size row is identified by talla × color × estilo × PO cliente — the same
// grouping the server uses, so open/closed state survives a refresh of the data.
const rowKeyOf = (s) =>
  [s.size_code, s.color, s.estilo, s.mo].map((v) => String(v ?? "").trim()).join("\u0000");

// "2026-08-10T14:32:00Z" -> "14:32" (local). Older rows may carry no timestamp.
const hourOf = (at) => {
  if (!at) return "—";
  const d = new Date(at);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// The captures behind one talla's acumulado: each time the line printed tickets,
// how many pieces went in, and what the running total was after it. Reading down
// the "acumulado" column shows how 100 was reached (50 one day + 50 another).
function EntriesTable({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="text-xs text-gray-400 px-1 py-2">Sin capturas registradas para esta talla.</div>;
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium">Fecha</th>
            <th className="text-left px-3 py-1.5 font-medium">Hora</th>
            <th className="text-left px-3 py-1.5 font-medium">Línea</th>
            <th className="text-right px-3 py-1.5 font-medium">Tickets</th>
            <th className="text-right px-3 py-1.5 font-medium">Piezas</th>
            <th className="text-right px-3 py-1.5 font-medium">Acumulado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((e, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 font-mono text-gray-700">{e.day || "—"}</td>
              <td className="px-3 py-1.5 text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-gray-300" />{hourOf(e.at)}
                </span>
              </td>
              <td className="px-3 py-1.5 text-gray-700">{e.line_no == null ? "—" : `Línea ${e.line_no}`}</td>
              <td className="px-3 py-1.5 text-right text-gray-400">{num(e.tickets)}</td>
              <td className="px-3 py-1.5 text-right font-semibold text-gray-900">+{num(e.qty)}</td>
              <td className="px-3 py-1.5 text-right text-gray-500 font-mono">{num(e.running)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- small presentational helpers ----

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function ReadOnly({ label, value, mono }) {
  return (
    <div>
      <span className="block text-xs font-medium text-gray-400 mb-0.5">{label}</span>
      <span className={`text-gray-900 ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    draft: ["Borrador", "bg-amber-50 text-amber-700"],
    confirmed: ["Confirmada", "bg-emerald-50 text-emerald-700"],
    cancelled: ["Cancelada", "bg-gray-100 text-gray-500"],
  };
  const [label, cls] = map[status] || ["—", "bg-gray-100 text-gray-500"];
  return <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${cls}`}>{label}</span>;
}

function ExportMenu({ onExport, disabled }) {
  const [open, setOpen] = useState(false);
  const options = [
    ["xlsx", "Excel (.xlsx)"],
    ["xls", "Excel 97-2003 (.xls)"],
    ["csv", "CSV (.csv)"],
  ];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={disabled}
        className="px-3 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
        <Download className="w-4 h-4" /> Exportar <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-48 bg-white border rounded-lg shadow-lg py-1 text-sm">
            {options.map(([fmt, label]) => (
              <button key={fmt} onClick={() => { setOpen(false); onExport(fmt); }}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700">{label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 ${toast.isError ? "bg-rose-600 text-white" : "bg-gray-900 text-white"}`}>
      {toast.isError ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />} {toast.msg}
    </div>
  );
}