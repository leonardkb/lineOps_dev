import { useEffect, useMemo, useState, useCallback } from "react";

/**
 * Edit Operation Planner
 * ----------------------
 * Lets a planner correct the produced (sewed) quantities a line leader entered.
 *
 * Flow: Date  ->  Line  ->  Operator  ->  Operation  ->  edit per-slot produced qty  ->  Save
 *
 * Backend endpoints (added to server.js):
 *   GET  /api/planner/dates
 *   GET  /api/planner/lines?date=YYYY-MM-DD
 *   GET  /api/planner/run/:runId/sewed
 *   POST /api/planner/update-sewed/:runId   { entries: [{ operatorNo, operationName, slotLabel, sewedQty }] }
 *
 * Auth: sends Bearer token from localStorage("token"). Adjust if your app stores it elsewhere.
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

function authHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function formatDate(d) {
  // d may be ISO string from Postgres; show YYYY-MM-DD
  if (!d) return "";
  return String(d).slice(0, 10);
}

export default function EditOperationPlanner() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");

  const [lines, setLines] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");

  const [runData, setRunData] = useState(null); // { run, slots, rows }
  const [selectedOperatorNo, setSelectedOperatorNo] = useState("");
  const [selectedOperationId, setSelectedOperationId] = useState("");

  // edits keyed by slot_label -> string value
  const [edits, setEdits] = useState({});

  const [loading, setLoading] = useState({ dates: false, lines: false, run: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null); // { type: 'success'|'error', msg }

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ---- Load dates on mount ----
  useEffect(() => {
    (async () => {
      setLoading((l) => ({ ...l, dates: true }));
      setError("");
      try {
        const data = await apiGet("/api/planner/dates");
        setDates(data.dates || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading((l) => ({ ...l, dates: false }));
      }
    })();
  }, []);

  // ---- When date changes, load lines ----
  useEffect(() => {
    setLines([]);
    setSelectedRunId("");
    setRunData(null);
    setSelectedOperatorNo("");
    setSelectedOperationId("");
    setEdits({});
    if (!selectedDate) return;

    (async () => {
      setLoading((l) => ({ ...l, lines: true }));
      setError("");
      try {
        const data = await apiGet(`/api/planner/lines?date=${encodeURIComponent(selectedDate)}`);
        setLines(data.lines || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading((l) => ({ ...l, lines: false }));
      }
    })();
  }, [selectedDate]);

  // ---- When line (run) changes, load run sewed data ----
  useEffect(() => {
    setRunData(null);
    setSelectedOperatorNo("");
    setSelectedOperationId("");
    setEdits({});
    if (!selectedRunId) return;

    (async () => {
      setLoading((l) => ({ ...l, run: true }));
      setError("");
      try {
        const data = await apiGet(`/api/planner/run/${selectedRunId}/sewed`);
        setRunData(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading((l) => ({ ...l, run: false }));
      }
    })();
  }, [selectedRunId]);

  // ---- Derived: operators ----
  const operators = useMemo(() => {
    if (!runData) return [];
    const map = new Map();
    for (const r of runData.rows) {
      if (!map.has(r.operator_no)) {
        map.set(r.operator_no, { operator_no: r.operator_no, operator_name: r.operator_name });
      }
    }
    return [...map.values()].sort((a, b) => a.operator_no - b.operator_no);
  }, [runData]);

  // ---- Derived: operations for selected operator ----
  const operations = useMemo(() => {
    if (!runData || selectedOperatorNo === "") return [];
    const map = new Map();
    for (const r of runData.rows) {
      if (String(r.operator_no) === String(selectedOperatorNo) && !map.has(r.operation_id)) {
        map.set(r.operation_id, { operation_id: r.operation_id, operation_name: r.operation_name });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.operation_name.localeCompare(b.operation_name)
    );
  }, [runData, selectedOperatorNo]);

  // ---- Derived: editable slot rows for selected operator + operation ----
  const slotRows = useMemo(() => {
    if (!runData || selectedOperationId === "") return [];
    return runData.rows
      .filter(
        (r) =>
          String(r.operator_no) === String(selectedOperatorNo) &&
          String(r.operation_id) === String(selectedOperationId)
      )
      .sort((a, b) => a.slot_order - b.slot_order);
  }, [runData, selectedOperatorNo, selectedOperationId]);

  // ---- Seed edits when operation selected ----
  useEffect(() => {
    if (slotRows.length === 0) {
      setEdits({});
      return;
    }
    const next = {};
    for (const r of slotRows) {
      next[r.slot_label] = String(Number(r.sewed_qty) || 0);
    }
    setEdits(next);
  }, [selectedOperationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const originalBySlot = useMemo(() => {
    const m = {};
    for (const r of slotRows) m[r.slot_label] = Number(r.sewed_qty) || 0;
    return m;
  }, [slotRows]);

  const dirtySlots = useMemo(() => {
    return Object.keys(edits).filter(
      (label) => Number(edits[label] || 0) !== (originalBySlot[label] ?? 0)
    );
  }, [edits, originalBySlot]);

  const editedTotal = useMemo(
    () => Object.values(edits).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [edits]
  );

  const selectedOperation = operations.find(
    (o) => String(o.operation_id) === String(selectedOperationId)
  );

  function handleEditChange(slotLabel, value) {
    // allow empty while typing; clamp negatives
    if (value === "") {
      setEdits((e) => ({ ...e, [slotLabel]: "" }));
      return;
    }
    const n = Number(value);
    if (Number.isNaN(n)) return;
    setEdits((e) => ({ ...e, [slotLabel]: String(Math.max(0, n)) }));
  }

  function resetEdits() {
    const next = {};
    for (const r of slotRows) next[r.slot_label] = String(Number(r.sewed_qty) || 0);
    setEdits(next);
  }

  async function handleSave() {
    if (!selectedRunId || !selectedOperation || dirtySlots.length === 0) return;

    const operatorNo = selectedOperatorNo;
    const operationName = selectedOperation.operation_name;
    const entries = dirtySlots.map((slotLabel) => ({
      operatorNo,
      operationName,
      slotLabel,
      sewedQty: Number(edits[slotLabel] || 0),
    }));

    setSaving(true);
    setError("");
    try {
      const res = await apiPost(`/api/planner/update-sewed/${selectedRunId}`, { entries });
      showToast("success", `Saved ${res.updatedCount} slot${res.updatedCount === 1 ? "" : "s"}.`);

      // refresh run data so originals reflect the new saved values
      const fresh = await apiGet(`/api/planner/run/${selectedRunId}/sewed`);
      setRunData(fresh);
    } catch (e) {
      setError(e.message);
      showToast("error", "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const selectedLine = lines.find((l) => String(l.run_id) === String(selectedRunId));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
            Planner
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Edit produced quantity</h1>
          <p className="mt-1 text-sm text-slate-500">
            Correct the sewed quantity a line leader entered. Pick a date, line, operator and
            operation, then adjust each hour.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Selectors */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Date */}
            <Field label="Date">
              <select
                className="select"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                disabled={loading.dates}
              >
                <option value="">
                  {loading.dates ? "Loading…" : "Select date"}
                </option>
                {dates.map((d) => (
                  <option key={formatDate(d)} value={formatDate(d)}>
                    {formatDate(d)}
                  </option>
                ))}
              </select>
            </Field>

            {/* Line */}
            <Field label="Line">
              <select
                className="select"
                value={selectedRunId}
                onChange={(e) => setSelectedRunId(e.target.value)}
                disabled={!selectedDate || loading.lines}
              >
                <option value="">
                  {loading.lines ? "Loading…" : !selectedDate ? "Pick a date first" : "Select line"}
                </option>
                {lines.map((l) => (
                  <option key={l.run_id} value={l.run_id}>
                    Line {l.line_no}
                    {l.style ? ` — ${l.style}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            {/* Operator */}
            <Field label="Operator">
              <select
                className="select"
                value={selectedOperatorNo}
                onChange={(e) => {
                  setSelectedOperatorNo(e.target.value);
                  setSelectedOperationId("");
                }}
                disabled={!runData || loading.run}
              >
                <option value="">
                  {loading.run ? "Loading…" : !runData ? "Pick a line first" : "Select operator"}
                </option>
                {operators.map((o) => (
                  <option key={o.operator_no} value={o.operator_no}>
                    #{o.operator_no}
                    {o.operator_name ? ` — ${o.operator_name}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            {/* Operation */}
            <Field label="Operation">
              <select
                className="select"
                value={selectedOperationId}
                onChange={(e) => setSelectedOperationId(e.target.value)}
                disabled={selectedOperatorNo === ""}
              >
                <option value="">
                  {selectedOperatorNo === "" ? "Pick an operator first" : "Select operation"}
                </option>
                {operations.map((op) => (
                  <option key={op.operation_id} value={op.operation_id}>
                    {op.operation_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {selectedLine && (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span>
                <span className="font-medium text-slate-700">Date:</span> {selectedDate}
              </span>
              <span>
                <span className="font-medium text-slate-700">Line:</span> {selectedLine.line_no}
              </span>
              {selectedLine.style && (
                <span>
                  <span className="font-medium text-slate-700">Style:</span> {selectedLine.style}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Editable grid */}
        <div className="mt-6">
          {selectedOperationId === "" ? (
            <EmptyState runData={runData} loading={loading.run} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {selectedOperation?.operation_name}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Operator #{selectedOperatorNo} · {slotRows.length} hour
                    {slotRows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Total produced</p>
                  <p className="text-lg font-bold text-slate-900">{editedTotal}</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 font-medium">Hour</th>
                      <th className="px-5 py-3 font-medium">Saved</th>
                      <th className="px-5 py-3 font-medium">Produced (editable)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slotRows.map((r) => {
                      const isDirty =
                        Number(edits[r.slot_label] || 0) !== (Number(r.sewed_qty) || 0);
                      return (
                        <tr
                          key={r.slot_label}
                          className="border-b border-slate-50 last:border-0"
                        >
                          <td className="px-5 py-3 font-medium text-slate-700">
                            {r.slot_label}
                          </td>
                          <td className="px-5 py-3 text-slate-400">
                            {Number(r.sewed_qty) || 0}
                          </td>
                          <td className="px-5 py-3">
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              className={`w-28 rounded-md border px-3 py-1.5 text-right outline-none focus:ring-2 ${
                                isDirty
                                  ? "border-amber-300 bg-amber-50 focus:ring-amber-200"
                                  : "border-slate-200 focus:ring-indigo-200"
                              }`}
                              value={edits[r.slot_label] ?? ""}
                              onChange={(e) => handleEditChange(r.slot_label, e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
                <p className="text-xs text-slate-500">
                  {dirtySlots.length === 0
                    ? "No changes."
                    : `${dirtySlots.length} unsaved change${
                        dirtySlots.length === 1 ? "" : "s"
                      }.`}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={resetEdits}
                    disabled={dirtySlots.length === 0 || saving}
                    className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={dirtySlots.length === 0 || saving}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* tiny styles for the selects (kept inline so the file is drop-in) */}
      <style>{`
        .select {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(30 41 59);
          outline: none;
        }
        .select:focus { box-shadow: 0 0 0 2px rgb(199 210 254); }
        .select:disabled { background: rgb(248 250 252); color: rgb(148 163 184); }
      `}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ runData, loading }) {
  let msg = "Select a date and line to begin.";
  if (loading) msg = "Loading run…";
  else if (runData) msg = "Choose an operator and operation to edit produced quantities.";
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-400">
      {msg}
    </div>
  );
}