import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import MetaSummary from "../components/MetaSummary";
import NavBarline from "../components/NavBarline";

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRole(role) {
  return String(role || "").toLowerCase().trim().replace(/[\s_-]/g, "");
}

/**
 * Alarm Notification Component (without pause button)
 */
function AlarmNotification({ visible, onDismiss, onSnooze, lastSavedTime }) {
  if (!visible) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-lg max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <span className="text-lg">⏰</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-red-800">¡Hora de actualizar datos!</div>
              <div className="mt-1 text-xs text-red-600">
                Por favor actualiza tu producción por hora.
                {lastSavedTime && (
                  <span className="block mt-1">
                    Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onDismiss} className="text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Alarm Status Indicator
 */
function AlarmStatusIndicator({ isActive, isPaused, nextAlarmTime }) {
  const getStatusColor = () => {
    if (isPaused) return "bg-gray-500";
    if (isActive) return "bg-green-500 animate-pulse";
    return "bg-yellow-500";
  };

  const getStatusText = () => {
    if (isPaused) return "Alarma en pausa";
    if (isActive) return "Alarma activa";
    return "En espera";
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${getStatusColor()}`} />
      <span className="text-xs text-gray-600">{getStatusText()}</span>
      {nextAlarmTime && !isPaused && (
        <span className="text-xs text-gray-500">
          Próxima: {nextAlarmTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}

/**
 * Hourly Plan UI
 */
function HourlyPlanCard({
  slots,
  slotTargetsMap,
  sewedBySlot,
  onChangeSewed,
  operationName = "",
  lockedSlots = {},
}) {
  const totalSewed = useMemo(() => {
    let sum = 0;
    for (const s of slots) sum += safeNum(sewedBySlot?.[s.slot_label]);
    return sum;
  }, [slots, sewedBySlot]);

  const cumSewed = useMemo(() => {
    let running = 0;
    const out = {};
    for (const s of slots) {
      running += safeNum(sewedBySlot?.[s.slot_label]);
      out[s.slot_label] = running;
    }
    return out;
  }, [slots, sewedBySlot]);

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Plan por hora</div>
          <div className="mt-1 text-xs text-gray-600">
            {operationName && (
              <span className="font-medium text-gray-900">Operación: {operationName}</span>
            )}
            <br />
            Objetivo por bloque = (Objetivo / Horas de trabajo) × Horas del bloque.
            <br />
            El objetivo acumulado se detiene en el último meta.
          </div>
        </div>
      </div>

      <div className="mt-4 border-t pt-4 overflow-x-auto">
        <table className="min-w-[620px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 border-y border-gray-200 border-r border-gray-200 rounded-tl-xl after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Fila
              </th>
              {slots.map((s, i) => (
                <th
                  key={s.slot_label}
                  className={`
                    bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 
                    border-y border-gray-200 border-r border-gray-200 whitespace-nowrap
                    ${i === slots.length - 1 ? "border-r-0 rounded-tr-xl" : ""}
                  `}
                >
                  {s.slot_label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <HourlyRow
              label="Objetivo del bloque"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.slot_target).toFixed(2)
              }
            />

            <HourlyRow
              label="Objetivo acumulado"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.cumulative_target).toFixed(2)
              }
            />

            <tr>
              <td className="sticky left-0 z-10 px-3 py-3 text-sm
               font-semibold text-gray-900 border-b border-gray-200
                border-r border-gray-200 bg-white after:absolute 
                after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Cosido (entrada)
              </td>
              {slots.map((slot, idx) => {
                const label = slot.slot_label;
                const v = sewedBySlot?.[label] ?? "";
                const isLocked = lockedSlots[label];
                
                return (
                  <td
                    key={label}
                    className={`
                      px-3 py-3 border-b border-gray-200 border-r border-gray-200 bg-white
                      ${idx === slots.length - 1 ? "border-r-0" : ""}
                    `}
                  >
                    <div className="relative">
                      <input
                        value={v}
                        onChange={(e) => onChangeSewed(label, e.target.value)}
                        placeholder="0"
                        inputMode="numeric"
                        disabled={isLocked}
                        className={`
                          w-28 rounded-xl border px-3 py-2 text-sm outline-none
                          ${isLocked 
                            ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed' 
                            : 'bg-white border-gray-200 focus:ring-2 focus:ring-gray-900/10'
                          }
                        `}
                      />
                      {isLocked && (
                        <span className="absolute -top-2 -right-2 text-xs bg-gray-800 text-white px-1.5 py-0.5 rounded-full">
                          🔒
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>

            <HourlyRow
              label="Cosido acumulado"
              slots={slots}
              renderCell={(slot) => String(safeNum(cumSewed?.[slot.slot_label] ?? 0))}
              strong
              last
            />
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Tip: Esta tabla se desliza horizontalmente en móvil. Es responsiva.
      </div>
    </div>
  );
}

function HourlyRow({ label, slots, renderCell, strong = false, last = false }) {
  return (
    <tr>
      <td
        className={`
          sticky left-0 z-10 px-3 py-3 text-sm font-semibold text-gray-900 bg-white 
          border-b border-gray-200 border-r border-gray-200
          after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
          ${last ? "rounded-bl-xl" : ""}
        `}
      >
        {label}
      </td>
      {slots.map((slot, idx) => (
        <td
          key={slot.slot_label}
          className={`
            px-3 py-3 text-sm bg-white border-b border-gray-200 border-r border-gray-200 whitespace-nowrap
            ${strong ? "font-semibold text-gray-900" : "text-gray-800"}
            ${last && idx === slots.length - 1 ? "rounded-br-xl" : ""}
            ${idx === slots.length - 1 ? "border-r-0" : ""}
          `}
        >
          {renderCell(slot)}
        </td>
      ))}
    </tr>
  );
}

// Helper function to calculate real-time efficiency
const calculateRealtimeEfficiency = (finishedGarments, operatorsCount, workingHours, sam, elapsedMinutes) => {
  if (!operatorsCount || !workingHours || !sam || !elapsedMinutes) return 0;
  
  const samProduced = finishedGarments * sam;
  const availableMinutes = operatorsCount * elapsedMinutes;
  const realtimeEfficiency = availableMinutes > 0 ? (samProduced / availableMinutes) * 100 : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

export default function LineLeaderPage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Multi-style state
  const [styles, setStyles] = useState([]);
  const [selectedStyleIndex, setSelectedStyleIndex] = useState(0);
  const [sewedInputs, setSewedInputs] = useState({}); // { styleIndex: { opId: { slotLabel: value } } }
  const [lockedSlots, setLockedSlots] = useState({}); // { styleIndex: { opId-slotLabel: true } }

  // Alarm System State
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmPaused, setAlarmPaused] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [nextAlarmTime, setNextAlarmTime] = useState(null);
  const [alarmInterval, setAlarmInterval] = useState(20);
  const [snoozeUntil, setSnoozeUntil] = useState(null);
  const alarmSoundRef = useRef(null);
  const alarmTimerRef = useRef(null);

  // State for line balancing assignments
  const [assignments, setAssignments] = useState([]);

  // State for time-based view
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // Summary Banner States
  const [realTimeTarget, setRealTimeTarget] = useState(0);
  const [realTimeProgress, setRealTimeProgress] = useState(0);
  const [overallEfficiency, setOverallEfficiency] = useState(0);
  const [targetAchievement, setTargetAchievement] = useState(0);
  const [realTimeEfficiency, setRealTimeEfficiency] = useState(0);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);

  const getToken = () => localStorage.getItem("token");

  // Get current style data
  const currentStyle = useMemo(() => {
    if (!styles.length || selectedStyleIndex >= styles.length) return null;
    return styles[selectedStyleIndex];
  }, [styles, selectedStyleIndex]);

  // Get current style's slots
  const slots = useMemo(() => currentStyle?.slots || [], [currentStyle]);

  // Get current style's slot targets map
  const slotTargetsMap = useMemo(() => {
    const map = {};
    if (currentStyle?.slotTargets) {
      for (const row of currentStyle.slotTargets) {
        map[row.slot_label] = {
          slot_target: safeNum(row.slot_target),
          cumulative_target: safeNum(row.cumulative_target),
        };
      }
    }
    return map;
  }, [currentStyle]);

  // Get current style's operators list
  const operatorsList = useMemo(() => currentStyle?.operators || [], [currentStyle]);

  // Get current style's target
  const target = useMemo(() => Number(currentStyle?.run?.target_pcs || 0), [currentStyle]);

  // Get current style's header info
  const header = useMemo(() => {
    if (!currentStyle?.run) return {
      line: "",
      date: "",
      style: "",
      operators: "0",
      sam: "0",
      workingHours: "0",
      efficiency: 0.7,
    };
    
    const run = currentStyle.run;
    return {
      line: String(run.line_no ?? ""),
      date: String(run.run_date ?? ""),
      style: String(run.style ?? ""),
      operators: String(run.operators_count ?? ""),
      sam: String(run.sam_minutes ?? ""),
      workingHours: String(run.working_hours ?? ""),
      efficiency: Number(run.efficiency ?? 0.7),
    };
  }, [currentStyle]);

  // Helper: get operation to operator mapping for current style
  const operationToOperatorMap = useMemo(() => {
    const map = new Map();
    if (currentStyle?.operations) {
      currentStyle.operations.forEach(block => {
        const operatorId = block.operator?.id;
        if (operatorId) {
          block.operations?.forEach(op => map.set(op.id, operatorId));
        }
      });
    }
    return map;
  }, [currentStyle]);

  // Helper: get operator to operation ids mapping for current style
  const operatorToOperationIds = useMemo(() => {
    const map = new Map();
    if (currentStyle?.operations) {
      currentStyle.operations.forEach(block => {
        const operatorId = block.operator?.id;
        if (operatorId) {
          const opIds = block.operations?.map(op => op.id) || [];
          map.set(operatorId, opIds);
        }
      });
    }
    return map;
  }, [currentStyle]);

  // ========== ALARM SYSTEM ==========
  useEffect(() => {
    alarmSoundRef.current = new Audio(
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
    );
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);

    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      audioContext.close();
    };
  }, []);

  useEffect(() => {
    const setupAlarm = () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      if (alarmPaused || snoozeUntil > Date.now()) return;

      const intervalMs = alarmInterval * 60 * 1000;
      const nextTime = new Date(Date.now() + intervalMs);
      setNextAlarmTime(nextTime);

      alarmTimerRef.current = setTimeout(() => {
        if (!alarmPaused && snoozeUntil < Date.now()) {
          setAlarmVisible(true);
          try {
            alarmSoundRef.current.play();
          } catch (e) {
            console.log("Alarm sound failed:", e);
          }
        }
        setupAlarm();
      }, intervalMs);
    };

    setupAlarm();

    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    };
  }, [alarmInterval, alarmPaused, snoozeUntil]);

  useEffect(() => {
    const snoozeCheck = setInterval(() => {
      if (snoozeUntil && Date.now() > snoozeUntil) setSnoozeUntil(null);
    }, 60000);
    return () => clearInterval(snoozeCheck);
  }, [snoozeUntil]);

  const handleDismissAlarm = () => {
    setAlarmVisible(false);
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    const intervalMs = alarmInterval * 60 * 1000;
    alarmTimerRef.current = setTimeout(() => {
      setAlarmVisible(true);
    }, intervalMs);
  };

  const handleSnoozeAlarm = () => {
    setAlarmVisible(false);
    setSnoozeUntil(Date.now() + 10 * 60 * 1000);
  };

  const handleTogglePauseAlarm = () => {
    setAlarmPaused(!alarmPaused);
    if (!alarmPaused) setAlarmVisible(false);
  };

  const updateLastSavedTime = () => {
    setLastSavedTime(new Date());
    localStorage.setItem("lineLeader_lastSaved", new Date().toISOString());
  };

  useEffect(() => {
    const saved = localStorage.getItem("lineLeader_lastSaved");
    if (saved) setLastSavedTime(new Date(saved));
  }, []);

  // ========== FETCH DATA ==========
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return navigate("/", { replace: true });

    if (normalizeRole(user.role) !== "lineleader") {
      return navigate("/planner", { replace: true });
    }

    const lineNo = user.line_number;
    if (!lineNo) {
      setErrMsg("No hay una línea asignada a este usuario. Por favor contacte al administrador.");
      setLoading(false);
      return;
    }

    fetchLatestStyleGroup(lineNo);
  }, [user]);

  async function fetchLatestStyleGroup(lineNo) {
    setLoading(true);
    setErrMsg("");
    setSaveMsg("");

    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      setLoading(false);
      return;
    }

    try {
      // First, try to get runs grouped by style_group_id
      const res = await fetch(
        `http://localhost:5000/api/multi-style/latest-group?line=${encodeURIComponent(lineNo)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();

      if (json.success && json.styles && json.styles.length > 0) {
        // Load complete data for each style
        const stylesData = [];
        for (const style of json.styles) {
          const runDataRes = await fetch(
            `http://localhost:5000/api/get-run-data/${style.run.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const runDataJson = await runDataRes.json();
          
          if (runDataJson.success) {
            stylesData.push({
              run: runDataJson.run,
              slots: runDataJson.slots,
              operators: runDataJson.operators,
              operations: runDataJson.operations,
              slotTargets: runDataJson.slotTargets,
            });
          }
        }

        if (stylesData.length > 0) {
          setStyles(stylesData);
          initializeStylesData(stylesData);
          
          // Fetch assignments for the first style
          if (stylesData[0].run.id) {
            await fetchAssignments(stylesData[0].run.id);
          }
          
          setLoading(false);
          return;
        }
      }

      // Fallback: try single style runs
      await fetchSingleStyleRuns(lineNo);
    } catch (e) {
      console.error("Error fetching style group:", e);
      await fetchSingleStyleRuns(lineNo);
    }
  }

  async function fetchSingleStyleRuns(lineNo) {
    const token = getToken();
    try {
      const res = await fetch(
        `http://localhost:5000/api/lineleader/latest-run?line=${encodeURIComponent(lineNo)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      
      if (!json.success) {
        setErrMsg(json.error || "No se encontraron corridas para esta línea");
        setLoading(false);
        return;
      }
      
      const runDataRes = await fetch(
        `http://localhost:5000/api/get-run-data/${json.run.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const runDataJson = await runDataRes.json();
      
      if (runDataJson.success) {
        const stylesData = [{
          run: runDataJson.run,
          slots: runDataJson.slots,
          operators: runDataJson.operators,
          operations: runDataJson.operations,
          slotTargets: runDataJson.slotTargets,
        }];
        setStyles(stylesData);
        initializeStylesData(stylesData);
        
        if (runDataJson.run.id) {
          await fetchAssignments(runDataJson.run.id);
        }
      }
    } catch (e) {
      setErrMsg(e.message || "Error de red");
    } finally {
      setLoading(false);
    }
  }

  function initializeStylesData(stylesData) {
    const initialInputs = {};
    const initialLocks = {};
    
    for (let i = 0; i < stylesData.length; i++) {
      const style = stylesData[i];
      initialInputs[i] = {};
      initialLocks[i] = {};
      
      for (const block of style.operations || []) {
        for (const op of block.operations || []) {
          initialInputs[i][op.id] = {};
          const sewed = op.sewed_data || {};
          
          for (const slot of style.slots || []) {
            const value = sewed[slot.slot_label] ?? "";
            initialInputs[i][op.id][slot.slot_label] = value;
            
            if (value && Number(value) > 0) {
              initialLocks[i][`${op.id}-${slot.slot_label}`] = true;
            }
          }
        }
      }
    }
    
    setSewedInputs(initialInputs);
    setLockedSlots(initialLocks);
    
    if (stylesData.length > 0 && stylesData[0].slots?.length > 0) {
      setSelectedTimeSlot(stylesData[0].slots[0].slot_label);
    }
  }

  async function fetchAssignments(runId) {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`http://localhost:5000/api/lineleader/assignments/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) setAssignments(json.assignments);
    } catch (e) {
      console.error("Error fetching assignments:", e);
    }
  }

  // ========== CAPACITY CALCULATIONS ==========
  const getOperatorTotalCapacity = (operatorId) => {
    const operatorBlock = currentStyle?.operations?.find(b => b.operator?.id === operatorId);
    if (!operatorBlock?.operations?.length) return 0;
    
    let totalSecondsSum = 0;
    operatorBlock.operations.forEach(operation => {
      const t1 = Number(operation.t1_sec);
      const t2 = Number(operation.t2_sec);
      const t3 = Number(operation.t3_sec);
      const t4 = Number(operation.t4_sec);
      const t5 = Number(operation.t5_sec);
      
      if (t1 > 0) totalSecondsSum += t1;
      if (t2 > 0) totalSecondsSum += t2;
      if (t3 > 0) totalSecondsSum += t3;
      if (t4 > 0) totalSecondsSum += t4;
      if (t5 > 0) totalSecondsSum += t5;
    });
    
    if (totalSecondsSum <= 0) return 0;
    const averageSecondsPerPiece = totalSecondsSum / 5;
    return 3600 / averageSecondsPerPiece;
  };

  // ========== HANDLE SEWED CHANGES ==========
  const handleSewedChange = useCallback((styleIndex, opId, slotLabel, value) => {
    const lockKey = `${opId}-${slotLabel}`;
    if (lockedSlots[styleIndex]?.[lockKey]) {
      setSaveMsg("⚠️ Este valor ya está guardado y no puede modificarse");
      setTimeout(() => setSaveMsg(""), 3000);
      return;
    }

    setSewedInputs(prev => {
      const operatorId = operationToOperatorMap.get(opId);
      if (!operatorId) {
        return {
          ...prev,
          [styleIndex]: {
            ...prev[styleIndex],
            [opId]: {
              ...(prev[styleIndex]?.[opId] || {}),
              [slotLabel]: value,
            },
          },
        };
      }

      const affectedOpIds = operatorToOperationIds.get(operatorId) || [];
      const newState = { ...prev };
      
      if (!newState[styleIndex]) newState[styleIndex] = {};
      
      affectedOpIds.forEach(id => {
        newState[styleIndex][id] = {
          ...(newState[styleIndex][id] || {}),
          [slotLabel]: value,
        };
      });
      
      return newState;
    });
  }, [operationToOperatorMap, operatorToOperationIds, lockedSlots]);

  const handleTimeSlotChange = (styleIndex, operatorId, slotLabel, value) => {
    if (styleIndex === undefined || !operatorId || !slotLabel) return;
    
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return;
    
    const primaryOpId = opIds[0];
    handleSewedChange(styleIndex, primaryOpId, slotLabel, value);
  };

  const getOperatorValueForSlot = (styleIndex, operatorId, slotLabel) => {
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return '';
    
    const primaryOpId = opIds[0];
    const value = sewedInputs[styleIndex]?.[primaryOpId]?.[slotLabel];
    
    if (!value && opIds.length > 1) {
      for (const opId of opIds) {
        const val = sewedInputs[styleIndex]?.[opId]?.[slotLabel];
        if (val) return val;
      }
    }
    
    return value || '';
  };

  const isSlotLocked = (styleIndex, operatorId, slotLabel) => {
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return false;
    const primaryOpId = opIds[0];
    return lockedSlots[styleIndex]?.[`${primaryOpId}-${slotLabel}`] || false;
  };

  const getOperatorTotalCumulative = (styleIndex, operatorId) => {
    let cumulative = 0;
    const slotsList = slots;
    if (!slotsList.length) return cumulative;
    
    for (const slot of slotsList) {
      const slotValue = getOperatorValueForSlot(styleIndex, operatorId, slot.slot_label);
      cumulative += Number(slotValue) || 0;
    }
    return cumulative;
  };

  const getOperationTotal = useCallback((styleIndex, opId) => {
    if (!opId) return 0;
    let sum = 0;
    const data = sewedInputs[styleIndex]?.[opId] || {};
    for (const slotLabel of Object.keys(data)) sum += safeNum(data[slotLabel]);
    return sum;
  }, [sewedInputs]);

  // ========== FINISHED GARMENTS TOTAL ==========
  const finishedGarmentsTotal = useMemo(() => {
    let total = 0;
    const packingKeywords = ['pack', 'emp', 'empaque', 'packing', 'finished', 'terminado'];
    
    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      for (const block of style.operations || []) {
        for (const op of block.operations || []) {
          const opName = (op.operation_name || '').toLowerCase();
          if (packingKeywords.some(keyword => opName.includes(keyword))) {
            const sewedData = sewedInputs[i]?.[op.id] || {};
            for (const qty of Object.values(sewedData)) {
              total += safeNum(qty);
            }
          }
        }
      }
    }
    return total;
  }, [styles, sewedInputs]);

  // ========== SAVE FUNCTION ==========
  async function handleSave() {
    if (!currentStyle || !currentStyle.run?.id) return;

    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      return;
    }

    setSaving(true);
    setSaveMsg("");
    setErrMsg("");

    try {
      const runId = currentStyle.run.id;
      const entries = [];
      
      for (const block of currentStyle.operations || []) {
        const operatorNo = block.operator?.operator_no;
        for (const op of block.operations || []) {
          const opId = op.id;
          const opName = op.operation_name;
          
          for (const s of slots) {
            const slotLabel = s.slot_label;
            const raw = sewedInputs[selectedStyleIndex]?.[opId]?.[slotLabel];
            const qty = raw === "" ? 0 : safeNum(raw);
            
            entries.push({ operatorNo, operationName: opName, slotLabel, sewedQty: qty });
          }
        }
      }

      const res = await fetch(`http://localhost:5000/api/lineleader/update-sewed/${runId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ entries }),
      });

      const json = await res.json();
      if (!json.success) {
        setErrMsg(json.error || "No se pudieron guardar los datos cosidos.");
        return;
      }

      // Lock saved values
      const newLockedState = { ...lockedSlots };
      for (const block of currentStyle.operations || []) {
        for (const op of block.operations || []) {
          const opId = op.id;
          for (const s of slots) {
            const slotLabel = s.slot_label;
            const value = sewedInputs[selectedStyleIndex]?.[opId]?.[slotLabel];
            const lockKey = `${opId}-${slotLabel}`;
            if (value && Number(value) > 0) {
              if (!newLockedState[selectedStyleIndex]) newLockedState[selectedStyleIndex] = {};
              newLockedState[selectedStyleIndex][lockKey] = true;
            }
          }
        }
      }
      setLockedSlots(newLockedState);

      updateLastSavedTime();
      setAlarmVisible(false);
      setSaveMsg(`✅ Actualizaciones por hora guardadas para ${currentStyle.run.style}`);

      // Refresh data
      await fetchLatestStyleGroup(user.line_number);
    } catch (e) {
      setErrMsg(e.message || "Error de red al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ========== REAL-TIME CALCULATIONS ==========
  useEffect(() => {
    if (!currentStyle || !slots.length || !slotTargetsMap || !target) return;

    const calculateRealtime = () => {
      const now = new Date();
      const dateStr = header.date ? header.date.split('T')[0] : new Date().toISOString().split('T')[0];
      
      const PRODUCTION_START = new Date(`${dateStr}T08:00:00`);
      
      const slotsWithTime = slots
        .map(slot => {
          if (!slot.slot_start || !slot.slot_end) return null;
          const start = new Date(`${dateStr}T${slot.slot_start}`);
          const end = new Date(`${dateStr}T${slot.slot_end}`);
          return { ...slot, start, end };
        })
        .filter(s => s !== null);
      
      const PRODUCTION_END = slotsWithTime.length > 0 
        ? new Date(Math.max(...slotsWithTime.map(s => s.end.getTime())))
        : new Date(`${dateStr}T17:36:00`);

      const elapsedMs = now - PRODUCTION_START;
      const elapsedMins = Math.max(0, elapsedMs / (1000 * 60));
      setElapsedMinutes(elapsedMins);

      if (now < PRODUCTION_START) {
        setRealTimeTarget(0);
        setRealTimeProgress(0);
        return;
      }
      
      if (now >= PRODUCTION_END) {
        setRealTimeTarget(target);
        setRealTimeProgress(100);
        return;
      }
      
      const elapsedMilliseconds = now - PRODUCTION_START;
      const totalProductionMilliseconds = PRODUCTION_END - PRODUCTION_START;
      
      if (totalProductionMilliseconds > 0) {
        const progressRatio = elapsedMilliseconds / totalProductionMilliseconds;
        const cumulative = target * progressRatio;
        setRealTimeTarget(Math.min(Math.round(cumulative * 100) / 100, target));
        setRealTimeProgress(target > 0 ? (cumulative / target) * 100 : 0);
      }
    };

    calculateRealtime();
    const interval = setInterval(calculateRealtime, 60000);
    return () => clearInterval(interval);
  }, [currentStyle, slots, slotTargetsMap, target, header.date]);

  useEffect(() => {
    if (!currentStyle || target === 0 || finishedGarmentsTotal === undefined) return;

    const operatorsCount = Number(header.operators) || 0;
    const workingHours = Number(header.workingHours) || 0;
    const sam = Number(header.sam) || 0;

    const availableMinutes = operatorsCount * workingHours * 60;
    const totalSAMOutput = finishedGarmentsTotal * sam;
    const eff = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
    setOverallEfficiency(Math.round(eff * 100) / 100);

    const ach = target > 0 ? (finishedGarmentsTotal / target) * 100 : 0;
    setTargetAchievement(Math.round(ach * 100) / 100);

    const rtEff = calculateRealtimeEfficiency(
      finishedGarmentsTotal,
      operatorsCount,
      workingHours,
      sam,
      elapsedMinutes
    );
    setRealTimeEfficiency(rtEff);
  }, [currentStyle, target, finishedGarmentsTotal, header.operators, header.workingHours, header.sam, elapsedMinutes]);

  const getStatusDot = (value, type) => {
    if (value === undefined || value === null) return 'bg-gray-400';
    if (type === 'efficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'cumplimiento') {
      if (value < 70) return 'bg-red-500';
      if (value < 90) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'realtimeEfficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    return 'bg-gray-400';
  };

  const slotsForSummary = useMemo(() => {
    if (!currentStyle?.slots) return [];
    return currentStyle.slots.map((s) => ({
      id: s.slot_label,
      label: s.slot_label,
      hours: Number(s.planned_hours || 0),
      startTime: s.slot_start,
      endTime: s.slot_end,
    }));
  }, [currentStyle]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBarline />
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">Cargando…</div>
        </div>
      </div>
    );
  }

  if (errMsg) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBarline />
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm text-red-600">{errMsg}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBarline />

      <AlarmNotification
        visible={alarmVisible}
        onDismiss={handleDismissAlarm}
        onSnooze={handleSnoozeAlarm}
        lastSavedTime={lastSavedTime}
      />

      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="rounded-3xl border bg-white shadow-sm p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold text-gray-900">
                Línea {user?.line_number} • {header.date || ""}
                <span className="ml-3 inline-flex items-center rounded-full border bg-gray-50 px-3 py-1 text-sm text-gray-700">
                  {header.style || "Corrida"}
                </span>
              </div>

              <div className="mt-2 text-sm text-gray-700">
                Operadores: {header.operators} &nbsp;&nbsp; Horas de trabajo: {header.workingHours}
                &nbsp;&nbsp; SAM: {header.sam} min
              </div>
              <div className="mt-1 text-sm text-gray-700">
                Eficiencia: {Math.round(safeNum(header.efficiency) * 100)}%
              </div>
              <div className="mt-1 text-sm text-gray-700">Total cosido: {finishedGarmentsTotal}</div>

              <div className="mt-2">
                <AlarmStatusIndicator
                  isActive={!alarmPaused && !snoozeUntil}
                  isPaused={alarmPaused}
                  nextAlarmTime={nextAlarmTime}
                />
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              <div className="flex gap-3">
                <button
                  onClick={() => setTab("summary")}
                  className={
                    tab === "summary"
                      ? "rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-semibold"
                      : "rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-gray-900"
                  }
                >
                  Resumen
                </button>
                <button
                  onClick={() => setTab("operations")}
                  className={
                    tab === "operations"
                      ? "rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-semibold"
                      : "rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-gray-900"
                  }
                >
                  Operaciones
                </button>
              </div>

              {lastSavedTime && (
                <div className="text-xs text-gray-500">
                  Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>

          {/* Style Selection Tabs */}
          {styles.length > 1 && (
            <div className="mt-4">
              <div className="flex gap-2 border-b">
                {styles.map((style, idx) => (
                  <button
                    key={style.run.id}
                    onClick={() => {
                      setSelectedStyleIndex(idx);
                      if (style.slots?.length > 0) {
                        setSelectedTimeSlot(style.slots[0].slot_label);
                      }
                      if (style.run.id) {
                        fetchAssignments(style.run.id);
                      }
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-all ${
                      selectedStyleIndex === idx
                        ? "border-b-2 border-gray-900 text-gray-900"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {style.run.style}
                    <span className="ml-1 text-xs text-gray-400">
                      ({Math.round(style.run.target_pcs || 0)} pcs)
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {saveMsg ? (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {saveMsg}
          </div>
        ) : null}

        <div className="mt-4">
          {tab === "summary" ? (
            <>
              {/* Summary Cards Banner */}
              {currentStyle && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5 mb-6">
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Objetivo Total</p>
                    <p className="text-3xl font-bold text-gray-900">{Math.round(target).toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-2">piezas</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Meta en tiempo real</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {realTimeTarget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">piezas esperadas hasta ahora</p>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(realTimeProgress, 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{realTimeProgress.toFixed(1)}% del objetivo</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Total Cosido</p>
                    <p className="text-3xl font-bold text-gray-900">{Math.round(finishedGarmentsTotal).toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-2">piezas terminadas</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${getStatusDot(realTimeEfficiency, 'realtimeEfficiency')}`}></span>
                      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Real‑time Efficiency</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{realTimeEfficiency.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500 mt-2">basada en tiempo real</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${getStatusDot(overallEfficiency, 'efficiency')}`}></span>
                      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Diario Eficiencia</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{overallEfficiency.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500 mt-2">basada en SAM</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${getStatusDot(targetAchievement, 'cumplimiento')}`}></span>
                      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Cumplimiento</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{targetAchievement.toFixed(1)}%</p>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                      <div
                        className="bg-gray-900 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(targetAchievement, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}

              <MetaSummary header={header} target={target} slots={slotsForSummary} />
              
              {assignments.length > 0 && (
                <div className="mt-6 rounded-3xl border bg-white shadow-sm p-6">
                  <h2 className="text-lg font-semibold mb-4">Asignaciones de ayuda</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left">Operador lento</th>
                          <th className="px-4 py-2 text-left">Operación</th>
                          <th className="px-4 py-2 text-left">Ayudado por</th>
                          <th className="px-4 py-2 text-left">Cantidad por hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map((a) => (
                          <tr key={a.id} className="border-t">
                            <td className="px-4 py-2">
                              Op. {a.source_operator_no}{" "}
                              {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                            </td>
                            <td className="px-4 py-2">{a.operation_name}</td>
                            <td className="px-4 py-2">
                              Op. {a.target_operator_no}{" "}
                              {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                            </td>
                            <td className="px-4 py-2">{a.assigned_quantity_per_hour} pcs/h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Time-based Operations Section
            currentStyle && (
              <div className="space-y-4">
                {/* Time Slot Selection Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                  {slots.map((slot) => {
                    const isSelected = selectedTimeSlot === slot.slot_label;
                    const slotTarget = slotTargetsMap[slot.slot_label]?.slot_target || 0;
                    const cumulativeTarget = slotTargetsMap[slot.slot_label]?.cumulative_target || 0;
                    
                    return (
                      <button
                        key={slot.slot_label}
                        onClick={() => setSelectedTimeSlot(slot.slot_label)}
                        className={`
                          rounded-2xl border p-4 text-center transition-all
                          ${isSelected 
                            ? 'bg-gray-900 text-white border-gray-900 shadow-lg ring-2 ring-gray-900 ring-offset-2' 
                            : 'bg-white hover:border-gray-300 hover:shadow-md'
                          }
                        `}
                      >
                        <div className="font-bold text-xl">{slot.slot_label}</div>
                        <div className={`text-xs mt-1 ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                          Meta: {Math.round(slotTarget)}
                        </div>
                        <div className={`text-xs font-semibold mt-1 ${isSelected ? 'text-gray-300' : 'text-gray-700'}`}>
                          Acum: {Math.round(cumulativeTarget)}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected Time Slot Data Entry Section */}
                {selectedTimeSlot && (
                  <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
                    <div className="p-6">
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Ingresar producción por hora - Estilo {header.style}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Ingresa las piezas cosidas en cada bloque horario
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          🔒 Los valores guardados no pueden modificarse
                        </p>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                        {operatorsList.map((op) => {
                          const operatorId = op.id;
                          const currentValue = getOperatorValueForSlot(selectedStyleIndex, operatorId, selectedTimeSlot);
                          const isLocked = isSlotLocked(selectedStyleIndex, operatorId, selectedTimeSlot);
                          const totalCapacity = getOperatorTotalCapacity(operatorId);
                          const cumulativeTotal = getOperatorTotalCumulative(selectedStyleIndex, operatorId);
                          
                          return (
                            <div key={op.id} className="flex flex-col items-center relative">
                              <div className="text-xl font-semibold text-gray-900">
                                Op. {op.operator_no}
                              </div>
                              <div className="text-sm text-gray-600 mb-1 text-center">
                                {op.operator_name || 'Sin nombre'}
                              </div>
                              <div className="text-xs font-medium text-blue-600 mb-2">
                                Cap: {totalCapacity.toFixed(3)} pcs/h
                              </div>
                              <div className="relative">
                                <input
                                  type="number"
                                  value={currentValue}
                                  onChange={(e) => handleTimeSlotChange(
                                    selectedStyleIndex,
                                    operatorId,
                                    selectedTimeSlot,
                                    e.target.value
                                  )}
                                  placeholder="0"
                                  disabled={isLocked}
                                  className={`
                                    w-24 h-24 rounded-2xl border-2 text-center
                                    text-3xl font-bold outline-none transition-all
                                    ${isLocked 
                                      ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed' 
                                      : 'border-gray-200 focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400'
                                    }
                                  `}
                                  min="0"
                                />
                                {isLocked && (
                                  <span className="absolute -top-2 -right-2 text-xs bg-gray-800 text-white px-1.5 py-0.5 rounded-full">
                                    🔒
                                  </span>
                                )}
                              </div>
                              <div className="text-sm font-semibold text-gray-700 mt-2">
                                Total acumulado: {cumulativeTotal}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Collapsible operations details */}
                      <details className="mt-8">
                        <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                          ► Ver todas las operaciones de este operador
                        </summary>
                        <div className="mt-4 space-y-4 border-t pt-4">
                          {operatorsList.map((op) => {
                            const block = currentStyle?.operations?.find(b => b.operator?.id === op.id);
                            const operatorTotalCapacity = getOperatorTotalCapacity(op.id);
                            const operatorCumulativeTotal = getOperatorTotalCumulative(selectedStyleIndex, op.id);
                            
                            return (
                              <div key={op.id} className="bg-gray-50 rounded-xl p-4">
                                <div className="flex justify-between items-center mb-2">
                                  <div className="font-semibold text-gray-900">
                                    Operador {op.operator_no} - {op.operator_name}
                                  </div>
                                  <div className="text-sm bg-gray-200 px-3 py-1 rounded-full">
                                    Capacidad total: {operatorTotalCapacity.toFixed(3)} pcs/h
                                  </div>
                                </div>
                                <div className="flex justify-between items-center mb-3">
                                  <div className="text-sm text-gray-500">Total acumulado:</div>
                                  <div className="text-sm font-semibold bg-gray-200 px-3 py-1 rounded-full">
                                    {operatorCumulativeTotal} pcs
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  {block?.operations?.map((operation) => {
                                    const opTotal = getOperationTotal(selectedStyleIndex, operation.id);
                                    let opCapacity = 0;
                                    const t1 = Number(operation.t1_sec);
                                    const t2 = Number(operation.t2_sec);
                                    const t3 = Number(operation.t3_sec);
                                    const t4 = Number(operation.t4_sec);
                                    const t5 = Number(operation.t5_sec);
                                    
                                    const times = [t1, t2, t3, t4, t5].filter(t => t > 0);
                                    if (times.length > 0) {
                                      const avgSeconds = times.reduce((a, b) => a + b, 0) / times.length;
                                      opCapacity = 3600 / avgSeconds;
                                    }
                                    
                                    return (
                                      <div key={operation.id} className="flex justify-between items-center text-sm">
                                        <span className="text-gray-600">{operation.operation_name}</span>
                                        <div className="flex items-center gap-4">
                                          <span className="text-xs text-gray-500">
                                            Cap: {opCapacity.toFixed(3)} pcs/h
                                          </span>
                                          <span className="font-medium text-gray-900">{opTotal} pcs</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </div>
                  </div>
                )}

                {/* Global Save Button */}
                <div className="sticky bottom-4 bg-white rounded-2xl border shadow-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {alarmVisible && (
                        <button
                          onClick={handleDismissAlarm}
                          className="rounded-xl bg-red-100 text-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-200"
                        >
                          ⏰ Cerrar alarma
                        </button>
                      )}
                      <div className="text-sm text-gray-600">
                        {lastSavedTime && (
                          <>Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}</>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={saving || !currentStyle}
                      className="rounded-xl bg-green-600 text-white px-8 py-3 text-base font-semibold
                               hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                               shadow-lg hover:shadow-xl transition-all"
                    >
                      {saving ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Guardando...
                        </span>
                      ) : (
                        '💾 Guardar producción'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}