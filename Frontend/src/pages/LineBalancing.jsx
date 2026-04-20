import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function LineBalancing() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assignments, setAssignments] = useState([]);
  const [saving, setSaving] = useState(false);

  // Form for a new assignment
  const [newAssignment, setNewAssignment] = useState({
    sourceOperatorId: "",
    targetOperatorId: "",
    operationId: "",
    quantity: "",
  });

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token || !user) return navigate("/", { replace: true });
    if (user.role !== "engineer") {
      return navigate("/planner", { replace: true });
    }
    fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRuns() {
    try {
      const res = await fetch("http://localhost:5000/api/line-runs");
      const json = await res.json();
      if (json.success) setRuns(json.runs);
    } catch (err) {
      setError("Error cargando corridas");
    }
  }

  async function fetchBalancingData(runId) {
    setLoading(true);
    setError("");
    setRunData(null);
    setAssignments([]);
    try {
      const res = await fetch(`http://localhost:5000/api/engineer/line-balancing/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
        return;
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Error");
      setRunData(json);
      // After loading operators, fetch existing assignments
      await fetchAssignments(runId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAssignments(runId) {
    try {
      const res = await fetch(`http://localhost:5000/api/lineleader/assignments/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setAssignments(json.assignments);
      }
    } catch (err) {
      console.error("Error fetching assignments:", err);
    }
  }

  const handleRunChange = (e) => {
    const id = e.target.value;
    setSelectedRunId(id);
    if (id) fetchBalancingData(id);
  };

  // Add a new assignment to the local list
  const addAssignment = () => {
    if (
      !newAssignment.sourceOperatorId ||
      !newAssignment.targetOperatorId ||
      !newAssignment.operationId ||
      !newAssignment.quantity
    ) {
      return;
    }

    const sourceOp = runData.operators.find(
      (op) => String(op.operator_id) === String(newAssignment.sourceOperatorId)
    );
    const targetOp = runData.operators.find(
      (op) => String(op.operator_id) === String(newAssignment.targetOperatorId)
    );
    const operation = sourceOp?.operations.find(
      (op) => String(op.operation_id) === String(newAssignment.operationId)
    );

    if (!sourceOp || !targetOp || !operation) return;

    const newAss = {
      sourceOperatorId: sourceOp.operator_id,
      sourceOperatorNo: sourceOp.operator_no,
      sourceOperatorName: sourceOp.operator_name,
      targetOperatorId: targetOp.operator_id,
      targetOperatorNo: targetOp.operator_no,
      targetOperatorName: targetOp.operator_name,
      operationId: operation.operation_id,
      operationName: operation.operation_name,
      assignedQtyPerHour: safeNum(newAssignment.quantity),
    };

    // Check if this exact combination already exists (update quantity)
    const existingIndex = assignments.findIndex(
      (a) =>
        a.sourceOperatorId === newAss.sourceOperatorId &&
        a.targetOperatorId === newAss.targetOperatorId &&
        a.operationId === newAss.operationId
    );

    if (existingIndex >= 0) {
      const updated = [...assignments];
      updated[existingIndex].assignedQtyPerHour = newAss.assignedQtyPerHour;
      setAssignments(updated);
    } else {
      setAssignments([...assignments, newAss]);
    }

    // Clear form
    setNewAssignment({
      sourceOperatorId: "",
      targetOperatorId: "",
      operationId: "",
      quantity: "",
    });
  };

  const updateAssignmentQuantity = (index, newQty) => {
    const updated = [...assignments];
    updated[index].assignedQtyPerHour = safeNum(newQty);
    setAssignments(updated);
  };

  const removeAssignment = (index) => {
    setAssignments(assignments.filter((_, i) => i !== index));
  };

  const saveAssignments = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        assignments: assignments.map((a) => ({
          sourceOperatorId: a.sourceOperatorId,
          targetOperatorId: a.targetOperatorId,
          operationId: a.operationId,
          assignedQtyPerHour: a.assignedQtyPerHour,
        })),
      };
      const res = await fetch(
        `http://localhost:5000/api/engineer/line-balancing/${selectedRunId}/assign`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );
      if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
        return;
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Error al guardar");
      alert("Asignaciones guardadas correctamente");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Balance de Línea</h1>
        <p className="text-sm text-gray-600 mb-6">
          Selecciona una corrida y asigna manualmente ayudas de operadores rápidos a lentos.
        </p>

        <div className="mb-6 max-w-md">
          <label className="block text-sm font-medium text-gray-700 mb-1">Corrida</label>
          <select
            value={selectedRunId}
            onChange={handleRunChange}
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="">Seleccionar...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                Línea {r.line_no} – {r.run_date} – {r.style}
              </option>
            ))}
          </select>
        </div>

        {loading && <div className="text-center py-8">Cargando datos de la línea...</div>}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
            {error}
          </div>
        )}

        {runData && !loading && (
          <>
            {/* Run summary */}
            <div className="rounded-3xl border bg-white shadow-sm p-6 mb-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Línea</div>
                  <div className="text-lg font-semibold">{runData.run.line_no}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Objetivo por hora</div>
                  <div className="text-lg font-semibold">
                    {safeNum(runData.run.target_per_hour).toFixed(2)} pcs
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Horas de trabajo</div>
                  <div className="text-lg font-semibold">{runData.run.working_hours}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Operadores</div>
                  <div className="text-lg font-semibold">{runData.run.operators_count}</div>
                </div>
              </div>
            </div>

            {/* Operators table */}
            <div className="rounded-3xl border bg-white shadow-sm p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Capacidades por operador</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200 rounded-tl-xl">
                        Operador
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">
                        Operación
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">
                        Capacidad (pcs/h)
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">
                        Requerido (pcs/h)
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">
                        Brecha
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200 rounded-tr-xl">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runData.operators.map((op) => {
                      const mainOp = op.operations[0] || { capacity_per_hour: 0, operation_name: "" };
                      const capacity = safeNum(mainOp.capacity_per_hour);
                      const required = safeNum(runData.run.target_per_hour);
                      const gap = capacity - required;
                      return (
                        <tr key={op.operator_id}>
                          <td className="px-4 py-3 border-b border-gray-200">
                            {op.operator_no} {op.operator_name && `(${op.operator_name})`}
                          </td>
                          <td className="px-4 py-3 border-b border-gray-200">
                            {mainOp.operation_name || "—"}
                          </td>
                          <td className="px-4 py-3 border-b border-gray-200">{capacity.toFixed(2)}</td>
                          <td className="px-4 py-3 border-b border-gray-200">{required.toFixed(2)}</td>
                          <td className="px-4 py-3 border-b border-gray-200">{gap.toFixed(2)}</td>
                          <td className="px-4 py-3 border-b border-gray-200">
                            {gap < -0.01 && <span className="text-red-600 font-medium">Bajo</span>}
                            {gap > 0.01 && <span className="text-green-600 font-medium">Exceso</span>}
                            {Math.abs(gap) <= 0.01 && <span className="text-gray-500">Equilibrado</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Manual assignments section */}
            <div className="rounded-3xl border bg-white shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">Asignaciones manuales de balance</h2>

              {/* Add assignment form */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
                {/* Slow operator dropdown */}
                <select
                  value={newAssignment.sourceOperatorId}
                  onChange={(e) =>
                    setNewAssignment({ ...newAssignment, sourceOperatorId: e.target.value, operationId: "" })
                  }
                  className="rounded-xl border px-3 py-2 text-sm"
                >
                  <option value="">Operador lento (necesita ayuda)</option>
                  {runData.operators.map((op) => {
                    const cap = op.operations[0]?.capacity_per_hour ?? 0;
                    return (
                      <option key={op.operator_id} value={op.operator_id}>
                        {op.operator_no} {op.operator_name && `(${op.operator_name})`} – Cap: {cap.toFixed(2)}
                      </option>
                    );
                  })}
                </select>

                {/* Fast operator dropdown */}
                <select
                  value={newAssignment.targetOperatorId}
                  onChange={(e) => setNewAssignment({ ...newAssignment, targetOperatorId: e.target.value })}
                  className="rounded-xl border px-3 py-2 text-sm"
                >
                  <option value="">Operador rápido (puede ayudar)</option>
                  {runData.operators.map((op) => {
                    const cap = op.operations[0]?.capacity_per_hour ?? 0;
                    return (
                      <option key={op.operator_id} value={op.operator_id}>
                        {op.operator_no} {op.operator_name && `(${op.operator_name})`} – Cap: {cap.toFixed(2)}
                      </option>
                    );
                  })}
                </select>

                {/* Operation to help dropdown */}
                <select
                  value={newAssignment.operationId}
                  onChange={(e) => setNewAssignment({ ...newAssignment, operationId: e.target.value })}
                  className="rounded-xl border px-3 py-2 text-sm"
                  disabled={!newAssignment.sourceOperatorId}
                >
                  <option value="">Operación a ayudar</option>
                  {newAssignment.sourceOperatorId && (() => {
                    const sourceOp = runData.operators.find(
                      (op) => String(op.operator_id) === String(newAssignment.sourceOperatorId)
                    );
                    if (!sourceOp) return null;
                    if (sourceOp.operations.length === 0) {
                      return <option disabled>⚠️ Este operador no tiene operaciones</option>;
                    }
                    return sourceOp.operations.map((op) => (
                      <option key={op.operation_id} value={op.operation_id}>
                        {op.operation_name} (Cap: {op.capacity_per_hour?.toFixed(2)})
                      </option>
                    ));
                  })()}
                </select>

                {/* Quantity input */}
                <input
                  type="number"
                  value={newAssignment.quantity}
                  onChange={(e) => setNewAssignment({ ...newAssignment, quantity: e.target.value })}
                  placeholder="Cantidad por hora"
                  className="rounded-xl border px-3 py-2 text-sm"
                  step="0.1"
                  min="0"
                />

                {/* Add button */}
                <button
                  onClick={addAssignment}
                  disabled={
                    !newAssignment.sourceOperatorId ||
                    !newAssignment.targetOperatorId ||
                    !newAssignment.operationId ||
                    !newAssignment.quantity
                  }
                  className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
                >
                  Agregar
                </button>
              </div>

              {/* List of current assignments */}
              {assignments.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-medium mb-2">Asignaciones actuales</h3>
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-4 py-2 text-left border-y border-gray-200">Operador lento</th>
                        <th className="px-4 py-2 text-left border-y border-gray-200">Operador rápido</th>
                        <th className="px-4 py-2 text-left border-y border-gray-200">Operación</th>
                        <th className="px-4 py-2 text-left border-y border-gray-200">Cantidad/h</th>
                        <th className="px-4 py-2 text-left border-y border-gray-200">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 border-b border-gray-200">
                            {a.sourceOperatorNo} {a.sourceOperatorName && `(${a.sourceOperatorName})`}
                          </td>
                          <td className="px-4 py-2 border-b border-gray-200">
                            {a.targetOperatorNo} {a.targetOperatorName && `(${a.targetOperatorName})`}
                          </td>
                          <td className="px-4 py-2 border-b border-gray-200">{a.operationName}</td>
                          <td className="px-4 py-2 border-b border-gray-200">
                            <input
                              type="number"
                              value={a.assignedQtyPerHour}
                              onChange={(e) => updateAssignmentQuantity(idx, e.target.value)}
                              className="w-20 rounded border px-2 py-1 text-sm"
                              step="0.1"
                              min="0"
                            />
                          </td>
                          <td className="px-4 py-2 border-b border-gray-200">
                            <button
                              onClick={() => removeAssignment(idx)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Save button */}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={saveAssignments}
                  disabled={saving}
                  className="rounded-xl bg-green-600 text-white px-6 py-3 text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "💾 Guardar todas las asignaciones"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}