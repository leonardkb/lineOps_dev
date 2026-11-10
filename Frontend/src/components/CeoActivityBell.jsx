// CeoActivityBell.jsx — avisos del Verificador en el panel del CEO.
//
// Cuatro capas para que el aviso NO se pase por alto:
//   1. Banner fijo bajo el navbar mientras haya avisos sin ver, en TODAS las
//      pantallas del CEO. Solo se va con "Marcar como vistos" o con
//      "Entendido" en cada aviso.
//   2. Tarjetas emergentes (abajo a la derecha) cuando llega un aviso nuevo
//      mientras el CEO está en el panel. No se cierran solas.
//   3. Contador en el título de la pestaña: "(3) Skyrina…", visible aunque
//      esté en otra pestaña.
//   4. Notificación del sistema operativo si la pestaña está en segundo plano
//      (el CEO la activa una vez desde el panel de avisos).
// La campana sigue igual: abre el historial completo.
//
// Fuentes: avisos del verificador (/api/ceo/verificador-activity) y cambios
// urgentes del Plan Board en semanas bloqueadas (/api/ceo/urgent-changes,
// ver plan-urgent-changes.js). Los ids de cambios urgentes llevan prefijo
// "u-" para no chocar con los del verificador.
//
// Uso (NavCeo.jsx):
//   const activity = useVerificadorActivity();
//   <CeoActivityBell activity={activity} />      // en la fila del navbar
//   <CeoActivityBanner activity={activity} />    // dentro del <nav>, debajo
//   <CeoActivityToasts activity={activity} />    // en cualquier parte
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/masterCodeCatalog";

const POLL_MS = 30000;
const MAX_TOASTS = 3;

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} día${d === 1 ? "" : "s"}`;
  return new Date(t).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

const ICON = { correction: "✏️", report_download: "📥", urgent_change: "⚡" };
const LABEL = {
  correction: "Corrección de producción",
  report_download: "Descarga de reporte",
  urgent_change: "Cambio urgente · semana bloqueada",
};
const ACCENT = { correction: "border-l-amber-500", report_download: "border-l-blue-500", urgent_change: "border-l-orange-600" };
// Avisos con detalle desplegable.
const hasDetail = (it) =>
  (it.action === "correction" && (it.details?.changes || []).length > 0) || it.action === "urgent_change";
const isUrgent = (id) => String(id).startsWith("u-");

const notifSupported = () => typeof window !== "undefined" && "Notification" in window;

// ======================================================================
// Estado compartido
// ======================================================================
export function useVerificadorActivity() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [toasts, setToasts] = useState([]); // avisos llegados en esta sesión
  const [wiggle, setWiggle] = useState(false);
  const [notifPerm, setNotifPerm] = useState(notifSupported() ? Notification.permission : "unsupported");

  const knownIds = useRef(null); // null = aún no hay primera carga
  const itemsRef = useRef([]);    // ultima lista, para conservar una fuente que falle
  const baseTitle = useRef(typeof document !== "undefined" ? document.title : "");

  const load = useCallback(async () => {
    try {
      const get = (path) =>
        fetch(`${API_URL}${path}`, { headers: authHeaders() })
          .then((r) => r.json().catch(() => null))
          .catch(() => null);
      const [data, urgent] = await Promise.all([
        get("/api/ceo/verificador-activity?limit=30"),
        get("/api/ceo/urgent-changes?limit=30"),
      ]);
      const okV = !!data?.success;
      const okU = !!urgent?.success;
      if (!okV && !okU) {
        if (data?.error) setError(data.error);
        return;
      }
      setError("");
      // Si una fuente falla, se conserva lo que ya habia de ella.
      const prevOf = (pred) => itemsRef.current.filter(pred);
      const vList = okV ? data.items || [] : prevOf((i) => !isUrgent(i.id));
      const uList = okU ? urgent.items || [] : prevOf((i) => isUrgent(i.id));
      const list = [...vList, ...uList]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
      itemsRef.current = list;
      setItems(list);
      const vUnread = okV ? Number(data.unread) || 0 : vList.filter((i) => i.unread).length;
      const uUnread = okU ? Number(urgent.unread) || 0 : uList.filter((i) => i.unread).length;
      setUnread(vUnread + uUnread);

      // Avisos nuevos desde la última consulta -> tarjeta + campana + SO.
      if (knownIds.current) {
        const fresh = list.filter((i) => i.unread && !knownIds.current.has(i.id));
        if (fresh.length) {
          setToasts((prev) => [...fresh, ...prev.filter((t) => !fresh.some((f) => f.id === t.id))]);
          setWiggle(true);
          setTimeout(() => setWiggle(false), 4000);
          if (notifSupported() && Notification.permission === "granted" && document.hidden) {
            const first = fresh[0];
            const n = new Notification(
              fresh.length > 1
                ? `${fresh.length} avisos nuevos`
                : first.action === "urgent_change"
                ? `⚡ ${LABEL.urgent_change}`
                : `Verificador: ${LABEL[first.action] || "aviso"}`,
              { body: `${first.summary}\n${first.user_name || ""}`, tag: "ceo-activity", requireInteraction: first.action === "urgent_change" }
            );
            n.onclick = () => {
              window.focus();
              if (fresh.length === 1 && hasDetail(first)) setExpandedId(first.id);
              setPanelOpen(true);
              n.close();
            };
          }
        }
      }
      knownIds.current = new Set(list.map((i) => i.id));
    } catch {
      /* sin red: se queda lo último */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onVisible = () => !document.hidden && load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Contador en el título de la pestaña.
  useEffect(() => {
    const base = baseTitle.current.replace(/^\(\d+\+?\)\s*/, "");
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [unread]);

  const markLocal = (pred) => setItems((prev) => prev.map((i) => (pred(i) ? { ...i, unread: false } : i)));

  const ack = useCallback(async (id) => {
    const wasUnread = items.find((i) => i.id === id)?.unread;
    markLocal((i) => i.id === id);
    if (wasUnread) setUnread((u) => Math.max(u - 1, 0));
    setToasts((prev) => prev.filter((t) => t.id !== id));
    try {
      const url = isUrgent(id)
        ? `${API_URL}/api/ceo/urgent-changes/${String(id).slice(2)}/seen`
        : `${API_URL}/api/ceo/verificador-activity/${id}/seen`;
      await fetch(url, { method: "POST", headers: authHeaders() });
    } catch {
      load(); // si falló, volver a la verdad del servidor
    }
  }, [items, load]);

  const ackAll = useCallback(async () => {
    markLocal(() => true);
    setUnread(0);
    setToasts([]);
    try {
      await Promise.all([
        fetch(`${API_URL}/api/ceo/verificador-activity/seen`, { method: "POST", headers: authHeaders() }),
        fetch(`${API_URL}/api/ceo/urgent-changes/seen`, { method: "POST", headers: authHeaders() }),
      ]);
    } catch {
      load();
    }
  }, [load]);

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const openItem = (id) => {
    setExpandedId(id);
    setPanelOpen(true);
  };

  const enableDesktop = async () => {
    if (!notifSupported()) return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  };

  return {
    items, unread, error, toasts, wiggle, notifPerm,
    panelOpen, setPanelOpen, expandedId, setExpandedId,
    ack, ackAll, dismissToast, openItem, enableDesktop, reload: load,
  };
}

// ======================================================================
// Detalle de una corrección
// ======================================================================
function ChangeList({ changes = [] }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, 6);
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="text-gray-500 text-left">
          <tr>
            <th className="px-2 py-1 font-medium">Operación</th>
            <th className="px-2 py-1 font-medium">Hora</th>
            <th className="px-2 py-1 font-medium text-right">Antes → Ahora</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c, i) => {
            const diff = c.to - c.from;
            return (
              <tr key={i} className="border-t border-gray-200">
                <td className="px-2 py-1 text-gray-800">
                  {c.packing && <span title="Cuenta como producido">📦 </span>}
                  Op. {c.operator} · {c.operation}
                </td>
                <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{c.slot}</td>
                <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                  <span className="text-gray-500">{c.from}</span>
                  {" → "}
                  <span className="font-semibold text-gray-900">{c.to}</span>
                  <span className={`ml-1 ${diff > 0 ? "text-green-700" : "text-red-700"}`}>
                    ({diff > 0 ? `+${diff}` : diff})
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {changes.length > 6 && (
        <button
          onClick={() => setAll(!all)}
          className="w-full text-xs py-1 text-blue-700 hover:bg-gray-100 cursor-pointer border-t border-gray-200"
        >
          {all ? "Ver menos" : `Ver ${changes.length - 6} más`}
        </button>
      )}
    </div>
  );
}

// ======================================================================
// Detalle de un cambio urgente (Plan Board, semana bloqueada)
// ======================================================================
function UrgentDetail({ d = {} }) {
  const side = (x) => `${x?.workOrderNo || "—"}${x?.color ? ` · ${x.color}` : ""}${x?.style ? ` (${x.style})` : ""}`;
  return (
    <dl className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-gray-500">Casilla</dt>
      <dd className="text-gray-900">Línea {d.lineNo} · {d.day}</dd>
      <dt className="text-gray-500">Antes</dt>
      <dd className="text-gray-900">{side(d.from)}</dd>
      <dt className="text-gray-500">Ahora</dt>
      <dd className="font-semibold text-gray-900">{side(d.to)} · {Math.round(d.movedQty || 0).toLocaleString()} pzas</dd>
      {d.sourceLeft > 0 && (
        <>
          <dt className="text-gray-500">Se quedan</dt>
          <dd className="text-gray-900">{Math.round(d.sourceLeft).toLocaleString()} pzas de {d.from?.workOrderNo}</dd>
        </>
      )}
      {(d.settledBalances || []).length > 0 && (
        <>
          <dt className="text-gray-500">Saldos usados</dt>
          <dd className="text-gray-900">
            {d.settledBalances.map((b) => `L${b.lineNo} ${String(b.date).slice(8)}/${String(b.date).slice(5, 7)}: ${Math.round(b.balance)} pzas`).join(" · ")}
          </dd>
        </>
      )}
      <dt className="text-gray-500">Motivo</dt>
      <dd className="text-gray-900">{d.reason || "—"}</dd>
      {(d.warnings || []).length > 0 && (
        <>
          <dt className="text-gray-500">Aviso</dt>
          <dd className="text-orange-800">{d.warnings.join(" ")}</dd>
        </>
      )}
    </dl>
  );
}

// ======================================================================
// 1. Campana + historial
// ======================================================================
export default function CeoActivityBell({ activity }) {
  const {
    items, unread, error, wiggle, notifPerm,
    panelOpen, setPanelOpen, expandedId, setExpandedId,
    ack, ackAll, enableDesktop,
  } = activity;
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target) && !e.target.closest?.("[data-activity-trigger]")) {
        setPanelOpen(false);
      }
    };
    const onKey = (e) => e.key === "Escape" && setPanelOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelOpen, setPanelOpen]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label={`Avisos${unread ? `: ${unread} sin ver` : ""}`}
        aria-expanded={panelOpen}
        title="Avisos"
        className={`relative text-xl leading-none cursor-pointer p-1.5 rounded-md hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
          unread > 0 ? "bg-white/10" : ""
        } ${wiggle ? "motion-safe:animate-bounce" : ""}`}
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          </span>
        )}
      </button>

      {panelOpen && (
        <div
          role="dialog"
          aria-label="Avisos"
          className="absolute right-0 mt-2 w-[min(28rem,calc(100vw-2rem))] max-h-[75vh] overflow-y-auto rounded-lg bg-white text-gray-900 shadow-xl border border-gray-200 z-50"
        >
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Avisos</h3>
              <p className="text-xs text-gray-500">
                {unread > 0 ? `${unread} sin ver` : "Todo visto"} · verificador y cambios urgentes del Plan Board
              </p>
            </div>
            {unread > 0 && (
              <button
                onClick={ackAll}
                className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-700 cursor-pointer"
              >
                Marcar todo como visto
              </button>
            )}
          </div>

          {notifPerm === "default" && (
            <div className="px-4 py-2 bg-blue-50 text-xs text-blue-900 flex items-center justify-between gap-2 border-b border-blue-100">
              <span>Recibe el aviso aunque estés en otra pestaña.</span>
              <button onClick={enableDesktop} className="font-semibold underline cursor-pointer shrink-0">
                Activar
              </button>
            </div>
          )}

          {error && <p className="px-4 py-3 text-sm text-red-700">{error}</p>}
          {!error && items.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Sin actividad todavía.</p>
          )}

          <ul className="divide-y divide-gray-100">
            {items.map((it) => {
              const changes = it.details?.changes || [];
              const isOpen = expandedId === it.id;
              return (
                <li key={it.id} className={`px-4 py-3 border-l-4 ${it.unread ? `${ACCENT[it.action] || "border-l-gray-400"} bg-amber-50/60` : "border-l-transparent"}`}>
                  <div className="flex gap-3">
                    <span aria-hidden className="text-lg leading-6">{ICON[it.action] || "•"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">
                        {LABEL[it.action] || it.action}
                        {it.unread && <span className="ml-2 text-red-600 font-semibold">Nuevo</span>}
                      </p>
                      <p className={`text-sm ${it.unread ? "font-semibold text-gray-900" : "text-gray-800"}`}>{it.summary}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {it.user_name || "Usuario desconocido"} · {timeAgo(it.created_at)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {hasDetail(it) && (
                          <button
                            onClick={() => setExpandedId(isOpen ? null : it.id)}
                            className="text-xs text-blue-700 hover:underline cursor-pointer"
                          >
                            {it.action === "urgent_change"
                              ? (isOpen ? "Ocultar detalle" : "Ver detalle")
                              : (isOpen ? "Ocultar cambios" : `Ver cambios (${changes.length})`)}
                          </button>
                        )}
                        {it.unread && (
                          <button onClick={() => ack(it.id)} className="text-xs text-gray-700 font-medium hover:underline cursor-pointer">
                            Entendido
                          </button>
                        )}
                      </div>
                      {isOpen && (it.action === "urgent_change"
                        ? <UrgentDetail d={it.details} />
                        : <ChangeList changes={changes} />)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ======================================================================
// 2. Banner fijo (va dentro del <nav>, debajo de la fila principal)
// ======================================================================
export function CeoActivityBanner({ activity }) {
  const { items, unread, setPanelOpen, setExpandedId, ackAll } = activity;
  if (unread <= 0) return null;
  const latest = items.find((i) => i.unread) || items[0];
  return (
    <div role="status" aria-live="polite" className="bg-amber-400 text-gray-900 border-t border-amber-500">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex-1 min-w-[14rem] text-sm">
          <span className="font-bold">
            🔔 {unread} aviso{unread === 1 ? "" : "s"} nuevo{unread === 1 ? "" : "s"}
          </span>
          {latest && (
            <span className="hidden sm:inline">
              {" "}· {latest.summary} <span className="text-gray-700">({latest.user_name || "—"}, {timeAgo(latest.created_at)})</span>
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            data-activity-trigger
            onClick={() => {
              setExpandedId(latest && hasDetail(latest) ? latest.id : null);
              setPanelOpen(true);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="text-sm font-semibold px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-700 cursor-pointer"
          >
            Ver avisos
          </button>
          <button
            onClick={ackAll}
            className="text-sm font-medium px-3 py-1.5 rounded-md border border-gray-900/40 hover:bg-amber-300 cursor-pointer"
          >
            Marcar como vistos
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// 3. Tarjetas emergentes para avisos que llegan en vivo
// ======================================================================
export function CeoActivityToasts({ activity }) {
  const { toasts, ack, dismissToast, openItem, setPanelOpen } = activity;
  if (!toasts.length) return null;
  const shown = toasts.slice(0, MAX_TOASTS);
  const extra = toasts.length - shown.length;
  return (
    <div
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-3 w-[min(24rem,calc(100vw-2rem))]"
    >
      {shown.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`bg-white text-gray-900 rounded-lg shadow-2xl border border-gray-200 border-l-4 ${ACCENT[t.action] || "border-l-gray-400"} p-4`}
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-xl leading-6">{ICON[t.action] || "🔔"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-red-600">
                {t.action === "urgent_change" ? "⚡ Cambio urgente en semana bloqueada" : "Nuevo aviso del verificador"}
              </p>
              <p className="text-sm font-semibold mt-0.5">{t.summary}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t.user_name || "Usuario desconocido"} · {timeAgo(t.created_at)}
              </p>
              <div className="mt-3 flex gap-2">
                {hasDetail(t) && (
                  <button
                    data-activity-trigger
                    onClick={() => openItem(t.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-700 cursor-pointer"
                  >
                    {t.action === "urgent_change" ? "Ver detalle" : "Ver cambios"}
                  </button>
                )}
                <button
                  onClick={() => ack(t.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 cursor-pointer"
                >
                  Entendido
                </button>
              </div>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Ocultar (sigue en avisos sin ver)"
              title="Ocultar (sigue en avisos sin ver)"
              className="text-gray-400 hover:text-gray-700 cursor-pointer leading-none text-lg"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      {extra > 0 && (
        <button
          data-activity-trigger
          onClick={() => setPanelOpen(true)}
          className="self-end text-xs font-semibold px-3 py-1.5 rounded-full bg-gray-900 text-white shadow-lg cursor-pointer"
        >
          +{extra} aviso{extra === 1 ? "" : "s"} más
        </button>
      )}
    </div>
  );
}