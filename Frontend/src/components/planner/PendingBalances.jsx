// components/planner/PendingBalances.jsx
//
// SALDOS POR REASIGNAR
// --------------------
// Una celda del tablero es un compromiso: "esta línea, este día, tantas piezas".
// Cuando el día cierra con menos piezas cosidas que asignadas, ese compromiso
// quedó incompleto y las piezas que faltaron NO se mueven solas al día
// siguiente: siguen contando como asignadas aunque nunca se hicieron. El
// planeador las ve aquí y decide a dónde van.
//
// Ejemplo: SKM0011-CYA-DAMBOD08, Línea 8, hoy 501 pzas asignadas y 301 cosidas
// → saldo de 200 pzas que hay que volver a poner en el tablero.
//
// De dónde salen los números:
//   GET /api/line-assignments/day-balances?onlyPending=1
//   assigned = suma de line_assignments de esa celda
//   produced = piezas de empaque/terminado que reportó esa línea ESE día
//              (mismo criterio que produced_quantity en Estado de Órdenes)
//
// Un saldo no siempre es producción faltante. Si el líder guardó la corrida sin
// seleccionar la orden, la captura existe pero no se puede sumar aquí y el saldo
// sale al 100%. Por eso las filas con `run_linked: false` se marcan aparte: ahí
// hay que revisar la captura ANTES de reasignar, o se duplica el trabajo.
//
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Factory,
  Calendar,
  ArrowRight,
  Link2Off,
  Loader2,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const n = (v) => Math.round(Number(v) || 0).toLocaleString();
const dmy = (ymd) => {
  if (!ymd) return "—";
  const [y, m, d] = String(ymd).slice(0, 10).split("-");
  return `${d}/${m}`;
};

// Clave estable de una celda (orden + línea + día).
export const cellKey = (workOrderId, lineNo, ymd) =>
  `${workOrderId}|${String(lineNo)}|${String(ymd).slice(0, 10)}`;

// Trae los saldos y los deja listos para consultar por celda.
// Lo usan tanto este panel como el tablero (para el distintivo en la celda).
export function useDayBalances({ from, to, autoRefreshMs = 60_000 } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(
        `${API_URL}/api/line-assignments/day-balances?${qs.toString()}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudieron cargar los saldos");
      setRows(data.rows || []);
      setResolved(data.resolved !== false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefreshMs) return;
    const id = setInterval(() => load({ silent: true }), autoRefreshMs);
    return () => clearInterval(id);
  }, [load, autoRefreshMs]);

  const byCell = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(cellKey(r.work_order_id, r.line_no, r.assigned_date), r));
    return m;
  }, [rows]);

  return { rows, byCell, loading, error, resolved, reload: load };
}

export default function PendingBalances({ rows = [], loading, error, resolved, onReassign, onReload, busy }) {
  const [open, setOpen] = useState(true);
  const [hideUnlinked, setHideUnlinked] = useState(false);

  // Sólo días cerrados: el día en curso todavía puede alcanzar su meta y
  // reasignarlo a media jornada le quita piezas a una línea que sí las va a hacer.
  const pending = useMemo(
    () => rows.filter((r) => r.is_past && r.balance > 0),
    [rows]
  );
  const unlinked = useMemo(
    () => pending.filter((r) => !r.run_linked && r.runs_on_day > 0),
    [pending]
  );
  const visible = hideUnlinked ? pending.filter((r) => !unlinked.includes(r)) : pending;

  const totalPieces = pending.reduce((s, r) => s + r.balance, 0);

  // Agrupado por orden: el planeador reasigna una orden completa, no celdas sueltas.
  const groups = useMemo(() => {
    const m = new Map();
    visible.forEach((r) => {
      const g = m.get(r.work_order_id) || {
        work_order_id: r.work_order_id,
        work_order_no: r.work_order_no,
        style_description: r.style_description,
        customer_name: r.customer_name,
        cells: [],
        total: 0,
      };
      g.cells.push(r);
      g.total += r.balance;
      m.set(r.work_order_id, g);
    });
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [visible]);

  if (!resolved) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">El saldo por día no está disponible.</p>
        <p className="text-[13px] mt-0.5">
          La captura de piso no está ligada a las órdenes, así que no se puede saber
          cuánto se cosió cada día. Revise que las corridas se guarden seleccionando
          la orden.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition"
      >
        <span className="flex items-center gap-2 min-w-0">
          {pending.length > 0 ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span className="font-semibold text-gray-900 text-sm">Saldos por reasignar</span>
          {pending.length > 0 && (
            <span className="text-[11px] rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-medium shrink-0">
              {n(totalPieces)} pzas · {pending.length} día(s)
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onReload?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onReload?.(); } }}
            className="text-gray-400 hover:text-gray-700 p-1 rounded"
            title="Actualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t">
          {error && (
            <div className="px-4 py-3 text-xs text-red-700 bg-red-50">{error}</div>
          )}

          {loading && pending.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Comparando lo asignado con lo cosido…
            </div>
          )}

          {!loading && pending.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">
              Cada día cerrado alcanzó las piezas que tenía asignadas. No hay nada que reasignar.
            </p>
          )}

          {unlinked.length > 0 && (
            <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="flex items-start gap-2 text-[12px] text-amber-900">
                <Link2Off className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>{unlinked.length} día(s)</strong> tienen corrida capturada pero sin
                  ligar a la orden. Ahí el saldo aparece completo aunque la línea sí haya
                  cosido. Corrija la captura antes de reasignar, o duplicará el trabajo.
                </span>
              </p>
              <button
                onClick={() => setHideUnlinked((v) => !v)}
                className="mt-1.5 text-[11px] text-amber-800 underline hover:no-underline"
              >
                {hideUnlinked ? "Mostrarlos de todas formas" : "Ocultarlos por ahora"}
              </button>
            </div>
          )}

          <div className="divide-y">
            {groups.map((g) => (
              <div key={g.work_order_id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-gray-900 truncate">
                      {g.work_order_no}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {g.customer_name} · {g.style_description || "—"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-amber-700 tabular-nums shrink-0">
                    {n(g.total)} pzas
                  </span>
                </div>

                <div className="space-y-1.5">
                  {g.cells.map((r) => (
                    <div
                      key={cellKey(r.work_order_id, r.line_no, r.assigned_date)}
                      className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs"
                    >
                      <span className="inline-flex items-center gap-1 text-gray-600 w-16 shrink-0">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        {dmy(r.assigned_date)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-gray-600 w-14 shrink-0">
                        <Factory className="w-3 h-3 text-gray-400" />
                        L{r.line_no}
                      </span>

                      <span className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="tabular-nums text-gray-500 whitespace-nowrap">
                          {n(r.produced)} / {n(r.assigned)}
                        </span>
                        <span className="h-1.5 flex-1 min-w-[40px] bg-gray-200 rounded-full overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-emerald-500"
                            style={{ width: `${r.pct}%` }}
                          />
                        </span>
                      </span>

                      {!r.run_linked && r.runs_on_day > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-amber-700 shrink-0"
                          title="La línea capturó producción ese día, pero la corrida no quedó ligada a esta orden."
                        >
                          <Link2Off className="w-3 h-3" />
                          sin ligar
                        </span>
                      )}
                      {r.shared_day && (
                        <span
                          className="text-[10px] text-gray-500 shrink-0"
                          title="Esa línea corrió más de una orden ese día; la captura por hora sólo se puede sumar a una."
                        >
                          día compartido
                        </span>
                      )}

                      <span className="font-semibold text-amber-700 tabular-nums w-16 text-right shrink-0">
                        −{n(r.balance)}
                      </span>

                      <button
                        disabled={busy}
                        onClick={() => onReassign?.(r)}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 text-white px-2.5 py-1 hover:bg-blue-700 disabled:opacity-50 shrink-0"
                        title={`Poner ${n(r.balance)} pzas en el siguiente día con capacidad de la Línea ${r.line_no}`}
                      >
                        Reasignar
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}