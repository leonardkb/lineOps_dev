import { useMemo, useState } from "react";
import HeaderForm from "../components/HeaderForm";
import MetaSummary from "../components/MetaSummary";
import OperationPlanner from "../components/OperationPlanner";
import SavedRunsViewer from "../components/SavedRunsViewer";
import { calcTargetFromSAM } from "../utils/calc";
import { buildShiftSlots } from "../utils/timeslots";
import Navbar from "../components/Navbar";

const initialHeader = {
  line: "",
  date: "",
  sam: "",
  workingHours: "",
  style: "",
  operators: "",
  efficiency: 0.7,
};

export default function PlannerPage() {
  const [header, setHeader] = useState(initialHeader);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [mode, setMode] = useState("planner");

  const [activePanel, setActivePanel] = useState("inputs"); // inputs | summary | operations
  const [selectedOperatorNo, setSelectedOperatorNo] = useState("ALL");
  const [operatorNos, setOperatorNos] = useState([]);

  const target = useMemo(
    () =>
      calcTargetFromSAM(
        header.operators,
        header.workingHours,
        header.sam,
        header.efficiency
      ),
    [header.operators, header.workingHours, header.sam, header.efficiency]
  );

  const slots = useMemo(
    () =>
      buildShiftSlots({
        workingHours: header.workingHours,
        startHour: 9,
        endHour: 17,
        lunchHour: 13,
        lastSlotLabelMinutes: 36,
      }),
    [header.workingHours]
  );

  const operatorButtons = useMemo(() => {
    const uniq = Array.from(
      new Set((operatorNos || []).map((x) => String(x || "").trim()).filter(Boolean))
    );
    return uniq.sort((a, b) => Number(a) - Number(b));
  }, [operatorNos]);

  const handleSaveSuccess = (runId) => {
    setCurrentRunId(runId);
    console.log(`✅ Paso 1 guardado. ID de corrida actual: ${runId}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
                Planificador de Línea
              </h1>
              <p className="text-sm text-gray-600">
                Ingresa detalles de la línea → obtén metas → planifica operaciones → da seguimiento horario.
              </p>
            </div>

            <div className="hidden sm:block rounded-2xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-xs text-gray-500">Estado</div>
              <div className="text-sm font-medium text-gray-900">
                {target > 0 ? "Listo para seguimiento" : "Esperando datos"}
                {currentRunId && ` • ID Corrida: ${currentRunId}`}
              </div>
            </div>
          </div>

          {/* MODE BUTTONS */}
          <div className="flex gap-3">
            <button
              onClick={() => setMode("planner")}
              className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                mode === "planner"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
              }`}
            >
              Crear Nuevo
            </button>

            <button
              onClick={() => setMode("view")}
              className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                mode === "view"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
              }`}
            >
              Ver Guardados
            </button>
          </div>

          {/* QUICK NAV */}
          {mode === "planner" && (
            <div className="flex flex-wrap gap-2">
              <QuickBtn active={activePanel === "inputs"} onClick={() => setActivePanel("inputs")}>
                Entradas de Línea
              </QuickBtn>

              <QuickBtn active={activePanel === "summary"} onClick={() => setActivePanel("summary")}>
                Resumen de Metas
              </QuickBtn>

              <QuickBtn active={activePanel === "operations"} onClick={() => setActivePanel("operations")}>
                Operaciones
              </QuickBtn>
            </div>
          )}

          {/* OPERATOR FILTER */}
          {mode === "planner" && (
            <div className="rounded-2xl border bg-white shadow-sm p-3">
              <div className="text-xs font-medium text-gray-700 mb-2">
                Filtro Rápido de Operador (por Numero)
              </div>

              <div className="flex flex-wrap gap-2">
                <Pill
                  active={selectedOperatorNo === "ALL"}
                  onClick={() => setSelectedOperatorNo("ALL")}
                >
                  Todos
                </Pill>

                {operatorButtons.length ? (
                  operatorButtons.map((no) => (
                    <Pill
                      key={no}
                      active={selectedOperatorNo === no}
                      onClick={() => setSelectedOperatorNo(no)}
                      title={`Operador ${no}`}
                    >
                      Operador {no}
                    </Pill>
                  ))
                ) : (
                  <div className="text-xs text-gray-500">
                    Agregue el numero de operador en el Paso 2 para activar el filtro rápido.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* MAIN */}
        {mode === "planner" ? (
          <>
            {activePanel === "inputs" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <HeaderForm
                    value={header}
                    onChange={setHeader}
                    slots={slots}
                    onSaveSuccess={handleSaveSuccess}
                  />
                </div>

                <div className="lg:col-span-1">
                  <MetaSummary header={header} target={target} slots={slots} />
                </div>
              </div>
            )}

            {activePanel === "summary" && (
              <MetaSummary header={header} target={target} slots={slots} />
            )}

            {activePanel === "operations" && (
              <div className="mt-2">
                <OperationPlanner
                  target={target}
                  slots={slots}
                  selectedOperatorNo={selectedOperatorNo}
                  onOperatorNosChange={setOperatorNos}
                  currentRunId={currentRunId}
                />
              </div>
            )}

            <div className="mt-10 text-xs text-gray-500">
              Notas: El objetivo usa SAM (min/pieza) y la eficiencia seleccionada.
              La capacidad/hora usa 3600 / promedio(t1..t5).
            </div>
          </>
        ) : (
          <SavedRunsViewer onBack={() => setMode("planner")} />
        )}
      </div>
    </div>
  );
}

function QuickBtn({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl px-4 py-2 text-sm font-medium border transition",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-800 border-gray-200 hover:border-gray-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Pill({ children, active, onClick, title }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1.5 text-xs font-medium border transition max-w-[220px] truncate",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-800 border-gray-200 hover:border-gray-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
