// components/warehouse/PrePacking.jsx
// Almacén de Producto Terminado — Pre-empaque.
// Create a pre-packing list for a client + work order (PO), add boxes (mostly
// auto-filled from the order), then confirm the list to push its boxes into
// finished inventory.
import { useState, useEffect, useCallback } from "react";
import {
  Package, Plus, Trash2, Check, ChevronLeft, Loader2, AlertCircle,
  Boxes, ClipboardList, RefreshCw, Download, ChevronDown,
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
  "130": "xxs", "132": "xs", "134": "xs", "136": "(S)", "138": "(M)",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const sizeLabelOf = (code) => {
  const k = String(code ?? "").trim();
  return SIZE_LABELS[k] ?? k;
};

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
  const [pick, setPick] = useState({ customerId: "", workOrderId: "" });
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

  // Pull all order lines into boxes (one box per size×color, every field from the DB).
  const regenerateBoxes = async (listId) => {
    setBusy(true);
    try {
      const d = await api(`/api/pre-packing-lists/${listId}/generate-boxes`, { method: "POST" });
      setBoxes(d.boxes || []);
      showToast(`${d.boxesGenerated || 0} caja(s) generadas desde la orden`);
    } catch (e) { showToast(e.message, true); }
    finally { setBusy(false); }
  };

  const openEditor = async (listId) => {
    try {
      const d = await api(`/api/pre-packing-lists/${listId}`);
      setList(d.list);
      setBoxes(d.boxes || []);
      setView("editor");
      // Seed older/empty draft lists straight from their order so the user can
      // just export. Lists created after this change already arrive populated.
      if (d.list.status === "draft" && d.list.work_order_id && (d.boxes || []).length === 0) {
        regenerateBoxes(listId);
      }
    } catch (e) { showToast(e.message, true); }
  };

  const createList = async () => {
    if (!pick.customerId) return showToast("Seleccione un cliente", true);
    setCreating(true);
    try {
      const d = await api("/api/pre-packing-lists", {
        method: "POST",
        body: JSON.stringify({ customerId: Number(pick.customerId), workOrderId: pick.workOrderId ? Number(pick.workOrderId) : null }),
      });
      setPick({ customerId: "", workOrderId: "" });
      await loadLists();
      await openEditor(d.list.id);
      showToast(
        d.boxesGenerated
          ? `Lista ${d.list.list_no} creada · ${d.boxesGenerated} caja(s) desde la orden`
          : `Lista ${d.list.list_no} creada`
      );
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

  const deleteBox = async (id) => {
    try {
      await api(`/api/pre-packing-boxes/${id}`, { method: "DELETE" });
      setBoxes((prev) => prev.filter((b) => b.id !== id));
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

  const totalBoxes = boxes.length;
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Cliente">
              <select value={pick.customerId}
                onChange={(e) => setPick({ customerId: e.target.value, workOrderId: "" })}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Seleccione…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Orden / PO">
              <select value={pick.workOrderId} disabled={!pick.customerId}
                onChange={(e) => setPick((p) => ({ ...p, workOrderId: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-gray-50">
                <option value="">{pick.customerId ? "Seleccione…" : "Elija cliente primero"}</option>
                {workOrders.map((w) => <option key={w.id} value={w.id}>{w.po}{w.mo ? ` · MO ${w.mo}` : ""}{w.style ? ` · ${w.style}` : ""}</option>)}
              </select>
            </Field>
            <div className="flex items-end">
              <button onClick={createList} disabled={!pick.customerId || creating}
                className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear lista
              </button>
            </div>
          </div>
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
        <section className="bg-white rounded-xl border shadow-sm p-4 flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Boxes className="w-4 h-4 text-indigo-600" /> Cajas desde la orden
            </h2>
            <p className="mt-1 text-[12px] text-gray-500">
              Las cajas se generan automáticamente desde la orden: una por talla y color, con
              estilo, tela y color tomados de la base de datos. Las <span className="font-medium">piezas
              son lo producido</span> (repartido entre las tallas según lo ordenado). El código de
              color es <span className="font-medium">color + talla</span>; el BoxRegistry es
              <span className="font-medium"> NCA</span> para C&amp;A. Use «Regenerar» para reflejar
              la producción más reciente, luego exporte.
            </p>
            {!list?.work_order_id && (
              <p className="mt-1 text-[12px] text-amber-600">
                Esta lista no tiene una orden asociada, así que no hay líneas para generar.
              </p>
            )}
          </div>
          {list?.work_order_id && (
            <button onClick={() => regenerateBoxes(list.id)} disabled={busy}
              className="px-4 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2 shrink-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {boxes.length > 0 ? "Regenerar desde la orden" : "Generar desde la orden"}
            </button>
          )}
        </section>
      )}

      {/* Boxes */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Boxes className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">Cajas</h2>
          <span className="text-xs text-gray-400">({totalBoxes})</span>
          <span className="ml-auto text-sm text-gray-600">Total: <b>{Math.round(totalPieces).toLocaleString()}</b> pzas</span>
        </div>
        {boxes.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin cajas todavía.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">Estilo</th>
                  <th className="text-left px-3 py-2 font-medium">Size</th>
                  <th className="text-left px-3 py-2 font-medium">Color</th>
                  <th className="text-left px-3 py-2 font-medium">C.code</th>
                  <th className="text-right px-3 py-2 font-medium">Piezas</th>
                  <th className="text-left px-3 py-2 font-medium">Registry</th>
                  {!locked && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {boxes.map((b, i) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-gray-700">{b.style || "—"}</td>
                    <td className="px-3 py-2">{sizeLabelOf(b.size_code) || "—"}</td>
                    <td className="px-3 py-2">{b.color_name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{b.color_code || "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">{Math.round(Number(b.quantity) || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500">{b.box_registry || "—"}</td>
                    {!locked && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => deleteBox(b.id)} className="text-rose-500 hover:text-rose-700" title="Eliminar caja">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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