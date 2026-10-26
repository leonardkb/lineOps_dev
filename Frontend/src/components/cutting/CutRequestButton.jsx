// components/cutting/CutRequestButton.jsx
//
// Botón "Solicitar orden" para el área de corte. Abre una ventana con dos
// pestañas:
//   • Nueva solicitud: elegir una orden + color que todavía NO tiene orden de
//     corte, cantidad (opcional), urgencia y un comentario → se le avisa al
//     planner en «Órdenes de corte».
//   • Mis solicitudes: estado de lo pedido — Pendiente, Asignada (CORTE-0012),
//     Rechazada (con el motivo del planner) — y cancelar las pendientes.
//
// Backend: cut-order-requests.js. El botón muestra un punto cuando alguna
// solicitud propia se resolvió desde la última vez que se abrió la ventana.
//
import { useState, useEffect, useMemo } from "react";
import { Send, X, Search, Clock, CheckCircle2, XCircle, Loader2, Inbox } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const fmtN = (v) => Math.round(Number(v) || 0).toLocaleString();
const fmtDT = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const cutNo = (id) => `CORTE-${String(id).padStart(4, "0")}`;

const URGENCY = {
  urgent:       { label: "Urgente",    on: "bg-red-500 text-white border-red-500",          off: "bg-white text-red-700 border-red-200 hover:bg-red-50",       pill: "bg-red-100 text-red-700" },
  intermediate: { label: "Intermedia", on: "bg-yellow-400 text-yellow-950 border-yellow-400", off: "bg-white text-yellow-700 border-yellow-200 hover:bg-yellow-50", pill: "bg-yellow-100 text-yellow-800" },
  normal:       { label: "Normal",     on: "bg-green-500 text-white border-green-500",      off: "bg-white text-green-700 border-green-200 hover:bg-green-50", pill: "bg-green-100 text-green-700" },
};
const REQ_STATUS = {
  pending:   { label: "Pendiente", pill: "bg-amber-100 text-amber-800", Icon: Clock },
  fulfilled: { label: "Asignada",  pill: "bg-green-100 text-green-700", Icon: CheckCircle2 },
  rejected:  { label: "Rechazada", pill: "bg-red-100 text-red-700",     Icon: XCircle },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500",   Icon: XCircle },
};
const SEEN_KEY = "cutting.requests.seenResolved";

export default function CutRequestButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("new"); // new | mine
  const [candidates, setCandidates] = useState([]);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [qty, setQty] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [seen, setSeen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; }
  });

  const loadMine = async () => {
    try {
      const res = await fetch(`${API_URL}/api/cut-order-requests?scope=mine`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.success) setMine(data.requests || []);
    } catch { /* se conserva lo anterior */ }
  };
  const loadCandidates = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/cut-order-requests/candidates`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.success) setCandidates(data.candidates || []);
      else setError(data.error || "No se pudieron cargar las órdenes");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Mis solicitudes: al montar y cada 60 s con la pestaña visible.
  useEffect(() => {
    loadMine();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") loadMine(); }, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    loadCandidates();
    loadMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Resueltas que el usuario aún no ha visto → punto en el botón.
  const unseenResolved = useMemo(
    () => mine.filter((r) => (r.status === "fulfilled" || r.status === "rejected") && !seen[r.id]),
    [mine, seen]
  );
  const pendingMine = mine.filter((r) => r.status === "pending").length;

  const markSeen = () => {
    if (!unseenResolved.length) return;
    const next = { ...seen };
    unseenResolved.forEach((r) => { next[r.id] = true; });
    setSeen(next);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return candidates;
    return candidates.filter((c) =>
      `${c.work_order_no} ${c.customer_name || ""} ${c.customer_po || ""} ${c.color || ""} ${c.style_code || ""} ${c.estilo || ""}`
        .toLowerCase().includes(t));
  }, [candidates, q]);

  const resetForm = () => { setPicked(null); setQty(""); setUrgency("normal"); setNote(""); };

  const pick = (c) => {
    if (c.pending_request_id) return;
    setPicked(c);
    setQty(String(Math.round(Number(c.remaining) || 0)));
    setError("");
    setOkMsg("");
  };

  const send = async () => {
    if (!picked || sending) return;
    const n = Number(qty);
    if (qty !== "" && !(n > 0)) return setError("La cantidad debe ser mayor a 0");
    if (n > Number(picked.remaining)) return setError(`Solo quedan ${fmtN(picked.remaining)} pzas sin orden de corte`);
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/cut-order-requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          workOrderId: picked.work_order_id,
          color: picked.color,
          quantity: qty === "" ? null : n,
          urgency,
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setOkMsg(`✅ Solicitud enviada: ${picked.work_order_no}${picked.color ? ` · ${picked.color}` : ""}. Planeación ya la ve en «Órdenes de corte».`);
        resetForm();
        await Promise.all([loadCandidates(), loadMine()]);
      } else {
        setError(data.error || "No se pudo enviar la solicitud");
        if (res.status === 409) loadCandidates();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const cancelReq = async (r) => {
    if (!window.confirm(`¿Cancelar la solicitud de ${r.work_order_no}${r.color ? ` · ${r.color}` : ""}?`)) return;
    try {
      const res = await fetch(`${API_URL}/api/cut-order-requests/${r.id}/cancel`, { method: "PATCH", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!data.success) setError(data.error || "No se pudo cancelar");
      await loadMine();
    } catch (err) {
      setError(err.message);
    }
  };

  const openModal = (startTab) => { setTab(startTab || (unseenResolved.length ? "mine" : "new")); setOpen(true); setError(""); setOkMsg(""); };
  useEffect(() => { if (open && tab === "mine") markSeen(); /* eslint-disable-next-line */ }, [open, tab, mine]);

  return (
    <>
      <button
        onClick={() => openModal()}
        className="relative inline-flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 px-3 py-1.5 rounded-lg"
        title="Pedir a planeación que asigne una orden a corte"
      >
        <Send className="w-4 h-4" /> Solicitar orden
        {pendingMine > 0 && (
          <span className="rounded-full bg-white/25 text-[10px] font-bold px-1.5 leading-4">{pendingMine}</span>
        )}
        {unseenResolved.length > 0 && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white" title="Hay respuestas nuevas" />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* encabezado */}
            <div className="px-5 py-3 border-b flex items-center gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Solicitar orden a planeación</h3>
                <p className="text-xs text-gray-500">Planeación recibe el aviso en «Órdenes de corte» y la asigna</p>
              </div>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
                <button onClick={() => setTab("new")} className={`px-3 py-1 rounded-md ${tab === "new" ? "bg-white shadow-sm font-semibold" : "text-gray-600"}`}>Nueva</button>
                <button onClick={() => setTab("mine")} className={`px-3 py-1 rounded-md inline-flex items-center gap-1.5 ${tab === "mine" ? "bg-white shadow-sm font-semibold" : "text-gray-600"}`}>
                  Mis solicitudes
                  {unseenResolved.length > 0 && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                </button>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Cerrar"><X className="w-4 h-4" /></button>
            </div>

            {(error || okMsg) && (
              <div className={`mx-5 mt-3 rounded-lg px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{error || okMsg}</div>
            )}

            {tab === "new" ? (
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-5 gap-0">
                {/* lista de órdenes */}
                <div className="md:col-span-3 flex flex-col min-h-0 border-r">
                  <div className="p-3 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar orden, cliente, PO, color, estilo…"
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-violet-500/20" />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">Solo aparecen órdenes que todavía no tienen orden de corte.</p>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
                    {loading && candidates.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">Cargando…</div>
                    ) : filtered.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">
                        <Inbox className="w-6 h-6 mx-auto mb-1 text-gray-300" />
                        {candidates.length === 0 ? "Todas las órdenes ya tienen orden de corte." : "Ninguna orden coincide."}
                      </div>
                    ) : filtered.map((c) => {
                      const sel = picked && picked.work_order_id === c.work_order_id && picked.color === c.color;
                      const requested = !!c.pending_request_id;
                      return (
                        <button key={`${c.work_order_id}:${c.color}`} onClick={() => pick(c)} disabled={requested}
                          className={`w-full text-left rounded-lg border px-3 py-2 transition ${sel ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200" : requested ? "border-gray-100 bg-gray-50 cursor-not-allowed" : "border-gray-200 bg-white hover:border-violet-300"}`}>
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-sm font-bold flex-1 truncate ${requested ? "text-gray-400" : "text-gray-900"}`}>{c.work_order_no}</span>
                            {c.color && <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-1.5 py-0.5">{c.color}</span>}
                            {requested && <span className="text-[10px] font-semibold rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5">Ya solicitada</span>}
                          </div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {c.customer_name}{c.customer_po ? ` · PO ${c.customer_po}` : ""}{c.estilo ? ` · ${c.estilo}` : c.style_code ? ` · ${c.style_code}` : ""}
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-violet-700">{fmtN(c.remaining)} pzas sin corte{Number(c.assigned) > 0 ? <span className="font-normal text-gray-400"> de {fmtN(c.color_qty)}</span> : null}</span>
                            {c.commitment_date && <span className="text-gray-400">Entrega {c.commitment_date.slice(8, 10)}/{c.commitment_date.slice(5, 7)}</span>}
                          </div>
                          {requested && c.pending_requested_by && <div className="text-[10px] text-gray-400 mt-0.5">Pedida por {c.pending_requested_by}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* detalle de la solicitud */}
                <div className="md:col-span-2 flex flex-col min-h-0">
                  {!picked ? (
                    <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-gray-500">
                      Elija la orden que necesita cortar.
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                        <div className="rounded-xl bg-violet-50 border border-violet-100 p-3">
                          <div className="font-mono text-sm font-bold text-gray-900">{picked.work_order_no}{picked.color ? ` · ${picked.color}` : ""}</div>
                          <div className="text-xs text-gray-600">{picked.customer_name}{picked.customer_po ? ` · PO ${picked.customer_po}` : ""}</div>
                          <div className="text-xs text-violet-700 mt-0.5">{fmtN(picked.remaining)} pzas sin orden de corte</div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad que necesita</label>
                          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/20" />
                          <p className="text-[11px] text-gray-400 mt-1">Vacío = todo lo que falta</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Urgencia</label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {Object.entries(URGENCY).map(([k, u]) => (
                              <button key={k} type="button" onClick={() => setUrgency(k)}
                                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${urgency === k ? u.on : u.off}`}>{u.label}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Comentario para planeación</label>
                          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500}
                            placeholder="Ej. Ya llegó la tela, la mesa 2 está libre…"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/20 resize-none" />
                        </div>
                      </div>
                      <div className="border-t p-3 flex gap-2">
                        <button onClick={resetForm} className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Cancelar</button>
                        <button onClick={send} disabled={sending}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar solicitud
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                {mine.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-500">Aún no ha hecho solicitudes.</div>
                ) : mine.map((r) => {
                  const st = REQ_STATUS[r.status] || REQ_STATUS.pending;
                  const u = URGENCY[r.urgency] || URGENCY.normal;
                  return (
                    <div key={r.id} className={`rounded-xl border p-3 ${r.status === "pending" ? "border-amber-200 bg-amber-50/40" : "border-gray-200"}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-gray-900">{r.work_order_no}</span>
                        {r.color && <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-1.5 py-0.5">{r.color}</span>}
                        <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${st.pill}`}><st.Icon className="w-3 h-3" />{st.label}</span>
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${u.pill}`}>{u.label}</span>
                        <span className="ml-auto text-[11px] text-gray-400">{fmtDT(r.created_at)}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {r.customer_name}{r.quantity ? ` · ${fmtN(r.quantity)} pzas` : " · todo lo pendiente"}
                        {r.note ? ` · “${r.note}”` : ""}
                      </div>
                      {r.status === "fulfilled" && (
                        <div className="mt-1.5 text-xs text-green-700 font-medium">
                          Asignada → {r.cut_order_id ? cutNo(r.cut_order_id) : "orden de corte"}{r.resolved_by_name ? ` por ${r.resolved_by_name}` : ""} · {fmtDT(r.resolved_at)}
                        </div>
                      )}
                      {r.status === "rejected" && (
                        <div className="mt-1.5 text-xs text-red-700">
                          <b>Rechazada{r.resolved_by_name ? ` por ${r.resolved_by_name}` : ""}:</b> {r.response_note || "—"}
                        </div>
                      )}
                      {r.status === "pending" && (
                        <div className="mt-1.5 flex justify-end">
                          <button onClick={() => cancelReq(r)} className="text-xs text-gray-500 hover:text-red-600">Cancelar solicitud</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}