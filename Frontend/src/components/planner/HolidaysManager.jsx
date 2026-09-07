// HolidaysManager.jsx — src/components/planner/HolidaysManager.jsx
//
// "Días Festivos" tab: block days so the Plan Board won't plan on them.
// A blocked day can cover the whole plant (Navidad, 16 de septiembre) or a
// single line (mantenimiento, paro de línea).
//
// Optional prop: lines={["L1","L2",...]} — pass the same list the Plan Board
// renders. Without it the component asks /api/lines and, if that isn't there,
// just offers "Todas las líneas".

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authHeaders,
  createHoliday,
  deleteHoliday,
  fetchHolidays,
} from "../../lib/holidaysApi.js";
import { API_URL } from "../../lib/masterCodeCatalog";

const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const WEEKDAYS = ["dom","lun","mar","mié","jue","vie","sáb"];

// "2026-09-16" -> local Date (never let the string go through UTC parsing).
const toDate = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const todayYmd = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
const monthKey = (ymd) => ymd.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

const EMPTY = { date: "", to: "", name: "", lineNo: "" };

export default function HolidaysManager({ lines: linesProp }) {
  const [holidays, setHolidays] = useState([]);
  const [lines, setLines] = useState(linesProp || []);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: "ok" | "error", text }
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHolidays(await fetchHolidays());
      setNotice(null);
    } catch (err) {
      setNotice({ kind: "error", text: `No se pudieron cargar los días bloqueados: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Line list: the `lines` prop wins (pass the Plan Board's own list for a single
  // source of truth). Without it we derive the SAME lines the Plan Board shows:
  // a line is "on the board" when it carries an assignment, an engineering run,
  // or was added by the planner. We union those three endpoints so the "Alcance"
  // dropdown offers exactly the lines a planner sees on the grid — and stay quiet
  // if any of them is absent.
  useEffect(() => {
    if (linesProp?.length) { setLines(linesProp); return; }
    let alive = true;
    (async () => {
      const pull = async (path, pick) => {
        try {
          const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
          const data = await res.json();
          return (pick(data) || []).map((v) => (v == null ? null : String(v))).filter(Boolean);
        } catch { return []; }
      };
      const [fromAssign, fromRuns, fromPlanner] = await Promise.all([
        pull("/api/line-assignments", (d) => (d.assignments || []).map((a) => a.line_no)),
        pull("/api/line-runs", (d) => (d.runs || []).map((r) => r.line_no)),
        pull("/api/planning/lines", (d) => (d.lines || []).map((l) => l.line_no)),
      ]);
      if (!alive) return;
      const present = [...new Set([...fromAssign, ...fromRuns, ...fromPlanner])]
        .sort((a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b)));
      setLines(present);
    })();
    return () => { alive = false; };
  }, [linesProp]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async () => {
    if (!form.date) {
      setNotice({ kind: "error", text: "Elija la fecha que desea bloquear." });
      return;
    }
    if (form.to && form.to < form.date) {
      setNotice({ kind: "error", text: "La fecha final no puede ser anterior a la inicial." });
      return;
    }
    setSaving(true);
    try {
      const { blocked, conflicts } = await createHoliday(form);
      const scope = form.lineNo ? `la Línea ${form.lineNo}` : "toda la planta";
      const busy = (conflicts?.assignments || 0) + (conflicts?.preOrderHolds || 0);
      setNotice({
        kind: "ok",
        text:
          `${blocked} ${blocked === 1 ? "día bloqueado" : "días bloqueados"} para ${scope}.` +
          (busy ? ` Atención: ya hay ${busy} ${busy === 1 ? "asignación" : "asignaciones"} en esas fechas; muévalas desde el Plan Board.` : ""),
      });
      setForm(EMPTY);
      await load();
    } catch (err) {
      setNotice({ kind: "error", text: `No se pudo bloquear: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    try {
      await deleteHoliday(row.id);
      setHolidays((prev) => prev.filter((h) => h.id !== row.id));
      setNotice({ kind: "ok", text: `${row.holiday_date} vuelve a estar disponible.` });
    } catch (err) {
      setNotice({ kind: "error", text: `No se pudo liberar la fecha: ${err.message}` });
    }
  };

  const visible = useMemo(() => {
    const today = todayYmd();
    return showPast ? holidays : holidays.filter((h) => h.holiday_date >= today);
  }, [holidays, showPast]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const h of visible) {
      const k = monthKey(h.holiday_date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(h);
    }
    return [...map.entries()];
  }, [visible]);

  const pastCount = holidays.length - visible.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Días festivos y paros</h2>
        <p className="text-sm text-gray-600">
          Las fechas bloqueadas se marcan en el Plan Board y no aceptan órdenes ni reservas PRE.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-lg p-4 text-sm ${
            notice.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* --- Nuevo bloqueo --- */}
      <div className="rounded-lg border bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Fecha</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setField("date", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Hasta <span className="font-normal text-gray-400">(opcional)</span>
            </span>
            <input
              type="date"
              value={form.to}
              min={form.date || undefined}
              onChange={(e) => setField("to", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Motivo</span>
            <input
              type="text"
              value={form.name}
              maxLength={150}
              placeholder="Día de la Independencia"
              onChange={(e) => setField("name", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Alcance</span>
            <select
              value={form.lineNo}
              onChange={(e) => setField("lineNo", e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            >
              <option value="">Todas las líneas</option>
              {lines.map((l) => (
                <option key={l} value={l}>Sólo Línea {l}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={saving || !form.date}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? "Bloqueando…" : "Bloquear fecha"}
          </button>
          <p className="text-xs text-gray-500">
            Use <span className="font-medium">Hasta</span> para bloquear una semana completa de vacaciones.
          </p>
        </div>
      </div>

      {/* --- Fechas bloqueadas --- */}
      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Fechas bloqueadas
            {!loading && <span className="ml-2 font-normal text-gray-500">{visible.length}</span>}
          </h3>
          {pastCount > 0 && (
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              {showPast ? "Ocultar fechas pasadas" : `Ver ${pastCount} fechas pasadas`}
            </button>
          )}
        </div>

        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500 sm:px-6">Cargando calendario…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500 sm:px-6">
            No hay fechas bloqueadas. Agregue la primera arriba.
          </p>
        ) : (
          grouped.map(([key, rows]) => (
            <div key={key} className="border-b last:border-b-0">
              <p className="bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:px-6">
                {monthLabel(key)}
              </p>
              <ul>
                {rows.map((h) => {
                  const d = toDate(h.holiday_date);
                  return (
                    <li
                      key={h.id}
                      className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 sm:px-6"
                    >
                      <div className="w-14 shrink-0 text-center">
                        <p className="text-xs uppercase text-gray-400">{WEEKDAYS[d.getDay()]}</p>
                        <p className="text-lg font-semibold leading-tight text-gray-900">{d.getDate()}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {h.name || "Día no laborable"}
                        </p>
                        <p className="text-xs text-gray-500">{h.holiday_date}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          h.line_no ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {h.line_no ? `Línea ${h.line_no}` : "Toda la planta"}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(h)}
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-red-50 hover:text-red-600"
                      >
                        Liberar
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}