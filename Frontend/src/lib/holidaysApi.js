// holidaysApi.js — src/components/planner/holidaysApi.js
//
// One place for the holidays calls plus the tiny helpers the Plan Board needs
// to decide whether a cell is droppable. HolidaysManager and PlanBoard both
// import from here so they can never disagree about what "blocked" means.
//
// ⚠ Match API_BASE / authHeaders to whatever your other planner components
//   already use (PlanBoard.jsx). Only these two lines should need changing.

const API_BASE = import.meta.env?.VITE_API_URL ?? "http://localhost:5000"; // or whatever your dev server is

export function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    JSON.parse(localStorage.getItem("user") || "{}").token ||
    "";
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function call(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

// --- API -------------------------------------------------------------------

export function fetchHolidays({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const suffix = qs.toString() ? `?${qs}` : "";
  return call(`/api/holidays${suffix}`).then((d) => d.holidays || []);
}

// lineNo omitted / "" -> the whole plant is off that day.
// `to` blocks the inclusive range.
export function createHoliday({ date, to, name, lineNo }) {
  return call("/api/holidays", {
    method: "POST",
    body: JSON.stringify({ date, to: to || date, name: name || "", lineNo: lineNo || "" }),
  });
}

export function deleteHoliday(id) {
  return call(`/api/holidays?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- board helpers ---------------------------------------------------------

// Turn the flat rows into { "2026-09-16": [row, ...] } for O(1) cell lookups.
export function indexHolidays(rows = []) {
  const byDate = {};
  for (const r of rows) (byDate[r.holiday_date] ||= []).push(r);
  return byDate;
}

// Is this LINE + DAY closed? Returns the blocking row so the caller can show
// its name in a tooltip, or null when the cell is free.
// A row with line_no == null closes every line that day.
export function holidayFor(byDate, date, lineNo) {
  const rows = byDate?.[date];
  if (!rows?.length) return null;
  return (
    rows.find((r) => r.line_no == null) ||
    rows.find((r) => String(r.line_no) === String(lineNo)) ||
    null
  );
}

// Is the whole day closed (every line)? Used to grey out the column header.
export function isPlantHoliday(byDate, date) {
  return (byDate?.[date] || []).some((r) => r.line_no == null);
}

export function holidayLabel(row) {
  if (!row) return "";
  const scope = row.line_no ? `Línea ${row.line_no}` : "Toda la planta";
  return row.name ? `${row.name} · ${scope}` : scope;
}