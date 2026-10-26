// DailyEfficiency.jsx — "Eficiencia Diaria" tab of Planificación Avanzada.
//
// Planner's own version of the Skyrina daily-efficiency board.
// SkyrinaDashboard.jsx is NOT touched: this file reuses its exact calculations
// (same endpoints, same RT / daily efficiency math, same per-style target
// rules) and only changes the presentation:
//   - no Skyrina nav bar / full-screen shell, compact toolbar instead
//   - sized to the space left in the window, so all lines fit without scrolling
//   - clearer line cards: line, work order, style, color chips, efficiency,
//     meta, producido and variacion
//   - Contribuciones opens as a side panel
//
// The calculation helpers below are copied from SkyrinaDashboard.jsx. If the
// efficiency formula changes there, copy the change here too.
//
// Backend: planners must be allowed on /api/supervisor/summary,
// /line-performance and /assignments (requireSupervisor + "planner").

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import axios from 'axios';



function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

// Helper function to calculate finished garments from packing operations
// Replace the calculateFinishedGarments function with this improved version
const calculateFinishedGarments = (runData) => {
  if (!runData) return 0;
  let total = 0;
  const packingKeywords = ['pack', 'emp', 'empaque', 'packing', 'finished', 'terminado'];
  
  try {
    // Check different possible data structures
    if (runData.operations && Array.isArray(runData.operations)) {
      for (const block of runData.operations) {
        // Check if block has operations array
        if (block.operations && Array.isArray(block.operations)) {
          for (const op of block.operations) {
            const opName = (op.operation_name || '').toLowerCase();
            const isPackingOp = packingKeywords.some(keyword => opName.includes(keyword));
            
            if (isPackingOp) {
              // Check different places where production data might be stored
              let sewedData = null;
              
              if (op.sewed_data) {
                sewedData = op.sewed_data;
              } else if (op.produced_quantity) {
                sewedData = op.produced_quantity;
              } else if (op.production) {
                sewedData = op.production;
              } else if (op.quantity) {
                sewedData = op.quantity;
              }
              
              // Sum all values in the sewed_data object
              if (sewedData && typeof sewedData === 'object' && !Array.isArray(sewedData)) {
                const values = Object.values(sewedData);
                for (const qty of values) {
                  if (qty !== null && qty !== undefined && qty !== '') {
                    const num = Number(qty);
                    if (!isNaN(num) && isFinite(num) && num > 0) {
                      total += num;
                    }
                  }
                }
              } else if (typeof sewedData === 'number' && sewedData > 0) {
                total += sewedData;
              } else if (typeof sewedData === 'string' && sewedData !== '') {
                const num = Number(sewedData);
                if (!isNaN(num) && isFinite(num) && num > 0) {
                  total += num;
                }
              }
            }
          }
        }
      }
    }
    
    // If no packing operations found, try to get from run level
    if (total === 0 && runData.run) {
      if (runData.run.total_produced) {
        total = Number(runData.run.total_produced) || 0;
      } else if (runData.run.finished_garments) {
        total = Number(runData.run.finished_garments) || 0;
      }
    }
    
    console.log(`calculateFinishedGarments returned: ${total} for run:`, runData.run?.id);
    return total;
    
  } catch (err) {
    console.error('Error calculating finished garments:', err);
    return 0;
  }
};

// Also improve the calculateActualDailyEfficiency function to handle NaN better
const calculateActualDailyEfficiency = (runData) => {
  if (!runData) return 0;
  
  const sewed = calculateFinishedGarments(runData);
  
  // Check if sewed is NaN or invalid
  if (isNaN(sewed) || !isFinite(sewed)) {
    console.warn('calculateFinishedGarments returned invalid value for run:', runData.run?.id);
    return 0;
  }
  
  const operatorsCount = Number(runData.run?.operators_count) || 0;
  const workingHours = Number(runData.run?.working_hours) || 0;
  const sam = Number(runData.run?.sam_minutes) || 0;
  
  console.log(`Line ${runData.run?.line_no}: sewed=${sewed}, ops=${operatorsCount}, hours=${workingHours}, sam=${sam}`);
  
  if (operatorsCount === 0 || workingHours === 0 || sam === 0) {
    console.warn('Missing data for efficiency calculation');
    return 0;
  }
  
  const availableMinutes = operatorsCount * workingHours * 60;
  const totalSAMOutput = sewed * sam;
  const actualEfficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
  
  console.log(`Calculated efficiency: ${actualEfficiency}%`);
  return Math.round(actualEfficiency * 100) / 100;
};

// Add this debug function to check the API response structure
const debugRunDataStructure = (runData) => {
  console.log('=== Debug Run Data Structure ===');
  console.log('Full runData:', runData);
  console.log('runData.run:', runData.run);
  console.log('runData.operations:', runData.operations);
  if (runData.operations && runData.operations.length > 0) {
    console.log('First operation block:', runData.operations[0]);
    if (runData.operations[0].operations && runData.operations[0].operations.length > 0) {
      console.log('First operation:', runData.operations[0].operations[0]);
      console.log('Operation name:', runData.operations[0].operations[0].operation_name);
      console.log('Sewed data:', runData.operations[0].operations[0].sewed_data);
    }
  }
  console.log('=============================');
};

// In the fetchAllRunDetails useEffect, add the debug call temporarily
// Inside the loop where you fetch run details, add:
// debugRunDataStructure(detailRes.data);


// Objetivo total is per STYLE, not per run. Same-style/different-color runs share
// one capacity (identical operators/hours/SAM/efficiency), so their target counts
// ONCE; different styles each contribute their own target. Production (finished/
// Cosido) still sums across every run, since each color actually sews pieces.
const sumTargetByStyle = (runs, getTarget) => {
  const byStyle = new Map();
  for (const run of runs || []) {
    const t = Number(getTarget(run)) || 0;
    if (!(t > 0) || !isFinite(t)) continue;
    const key = String(run.style ?? "");
    // Runs of the same style should have equal targets; MAX guards against a
    // stray 0/partial while still counting the style only once.
    byStyle.set(key, Math.max(byStyle.get(key) || 0, t));
  }
  let total = 0;
  for (const v of byStyle.values()) total += v;
  return total;
};

// Also update the calculateLineTotalFinished function to ensure proper number handling
const calculateLineTotalFinished = (runs) => {
  if (!runs || runs.length === 0) return 0;
  const total = runs.reduce((sum, run) => {
    let val = run.finishedGarments || 0;
    if (isNaN(val) || !isFinite(val)) val = 0;
    console.log(`Run ${run.style}: finishedGarments = ${val}`);
    return sum + val;
  }, 0);
  console.log(`Line total finished: ${total}`);
  return total;
};

// Update the calculateLineTotalTarget function to handle numbers properly
const calculateLineTotalTarget = (runs) => {
  if (!runs || runs.length === 0) return 0;
  
  let totalTarget = 0;
  
  for (const run of runs) {
    if (!run.hasProductionData) continue;
    
    // Use the appropriate target based on production status
    if (productionEnded) {
      const target = Number(run.targetPcs) || 0;
      if (target > 0 && !isNaN(target) && isFinite(target)) {
        totalTarget += target;
      }
    } else {
      // During production, use realtime target if available
      let target = 0;
      if (run.realtimeTarget > 0 && !isNaN(run.realtimeTarget) && isFinite(run.realtimeTarget)) {
        target = Number(run.realtimeTarget);
      } else {
        target = Number(run.targetPcs) || 0;
      }
      
      if (target > 0 && !isNaN(target) && isFinite(target)) {
        totalTarget += target;
      }
    }
  }
  
  console.log(`Line total target: ${totalTarget}`);
  return totalTarget;
};

// Helper function to calculate actual achieved daily efficiency based on SAM
;

// Helper function to check if production has ended for the day
const isProductionEnded = (selectedDate) => {
  if (!selectedDate) return false;
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_END = new Date(`${todayStr}T17:36:00`);
  return now >= PRODUCTION_END;
};

// Helper function to calculate real-time efficiency
// Helper function to calculate real-time efficiency
const calculateRealtimeEfficiency = (runData, selectedDate) => {
  if (!runData || !selectedDate) return null;
  
  // If production has ended, return null to indicate we should show daily efficiency instead
  if (isProductionEnded(selectedDate)) {
    return null;
  }
  
  const now = new Date();
  const todayStr = selectedDate;
  
  // Production timeline: 8:00 AM start
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  // Get the last slot end time
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  // Find the latest end time from slots
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  // If production hasn't started yet
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  // If production has ended for the day
  if (now >= PRODUCTION_END) {
    return null;
  }
  
  // Calculate elapsed time in minutes
  const elapsedMilliseconds = now - PRODUCTION_START;
  const elapsedMinutes = elapsedMilliseconds / (1000 * 60);
  
  // Get actual working hours so far (in minutes)
  const actualWorkingMinutes = Math.min(
    elapsedMinutes,
    (PRODUCTION_END - PRODUCTION_START) / (1000 * 60)
  );
  
  // Calculate SAM produced so far (only from packing operations)
  const sewedSoFar = calculateFinishedGarments(runData);
  const samProducedSoFar = sewedSoFar * (runData.run?.sam_minutes || 0);
  
  // Calculate available minutes so far (operators * actual time elapsed)
  const operatorsCount = runData.run?.operators_count || 0;
  const availableMinutesSoFar = operatorsCount * actualWorkingMinutes;
  
  // Calculate real-time efficiency
  const realtimeEfficiency = availableMinutesSoFar > 0 
    ? (samProducedSoFar / availableMinutesSoFar) * 100 
    : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

// Helper function to calculate real-time target
const computeRealtimeTarget = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  if (isProductionEnded(selectedDate)) {
    return runData.run?.target_pcs || 0;
  }
  
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  const totalTarget = runData.run?.target_pcs || 0;
  
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  if (now >= PRODUCTION_END) {
    return totalTarget;
  }
  
  const elapsedMilliseconds = now - PRODUCTION_START;
  const totalProductionMilliseconds = PRODUCTION_END - PRODUCTION_START;
  
  if (totalProductionMilliseconds > 0) {
    const progressRatio = elapsedMilliseconds / totalProductionMilliseconds;
    const realTimeTarget = totalTarget * progressRatio;
    return Math.min(Math.round(realTimeTarget * 100) / 100, totalTarget);
  }
  
  return 0;
};

// Helper function to get elapsed minutes since production start
const getElapsedMinutes = (selectedDate) => {
  if (!selectedDate) return 0;
  
  const now = new Date();
  const todayStr = selectedDate;
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  // Get slots end time from run data (or use default 17:36)
  // This function should be called with runData context
  return 0; // Will be replaced with proper implementation
};

// Helper function to get total production minutes in a day
const getTotalProductionMinutes = (selectedDate) => {
  if (!selectedDate) return 0;
  
  const todayStr = selectedDate;
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  const PRODUCTION_END = new Date(`${todayStr}T17:36:00`);
  
  return (PRODUCTION_END - PRODUCTION_START) / (1000 * 60);
};

const getLineStatus = (efficiency) => {
  if (efficiency === 0) return { color: 'gray', icon: '⏸️', text: 'Sin Datos' };
  if (efficiency < 40) return { color: 'red', icon: '🔴', text: 'Crítico' };
  if (efficiency < 60) return { color: 'orange', icon: '🟠', text: 'Bajo' };
  if (efficiency < 70) return { color: 'yellow', icon: '🟡', text: 'Medio' };
  if (efficiency < 80) return { color: 'lime', icon: '🟢', text: 'Bueno' };
  if (efficiency < 90) return { color: 'green', icon: '🟢', text: 'Muy Bueno' };
  return { color: 'emerald', icon: '👑', text: 'Excelente' };
};

const getEfficiencyColor = (eff) => {
  if (eff >= 90) return 'text-green-800';
  if (eff >= 80) return 'text-green-600';
  if (eff >= 70) return 'text-lime-600';
  if (eff >= 60) return 'text-yellow-600';
  if (eff >= 40) return 'text-orange-600';
  return 'text-red-600';
};

const getProgressBarColor = (eff) => {
  if (eff >= 90) return 'bg-green-800';
  if (eff >= 80) return 'bg-green-600';
  if (eff >= 70) return 'bg-lime-600';
  if (eff >= 60) return 'bg-yellow-600';
  if (eff >= 40) return 'bg-orange-600';
  return 'bg-red-600';
};

const getStatusColor = (color) => {
  const colorMap = {
    gray: 'border-gray-500',
    red: 'border-red-500',
    orange: 'border-orange-500',
    yellow: 'border-yellow-500',
    lime: 'border-lime-500',
    green: 'border-green-500',
    emerald: 'border-emerald-500'
  };
  return colorMap[color] || 'border-gray-500';
};

const getStatusBgColor = (color) => {
  const colorMap = {
    gray: 'bg-gray-50',
    red: 'bg-red-50',
    orange: 'bg-orange-50',
    yellow: 'bg-yellow-50',
    lime: 'bg-lime-50',
    green: 'bg-green-50',
    emerald: 'bg-emerald-50'
  };
  return colorMap[color] || 'bg-gray-50';
};


// Embedded card: thin status stripe on top + Spanish label for the mode.
const STATUS_ACCENT = {
  gray: 'bg-gray-400',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  lime: 'bg-lime-500',
  green: 'bg-green-500',
  emerald: 'bg-emerald-600',
};
const MODE_LABEL = { RT: 'tiempo real', Daily: 'diaria', Final: 'final' };


export default function DailyEfficiency() {
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [lineData, setLineData] = useState([]);
  const [runDataMap, setRunDataMap] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [globalRealtimeTarget, setGlobalRealtimeTarget] = useState(0);
  const [globalRealtimeEfficiency, setGlobalRealtimeEfficiency] = useState(0);
  const [globalDailyEfficiency, setGlobalDailyEfficiency] = useState(0);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [productionEnded, setProductionEnded] = useState(false);
  
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(300);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());


  // --- layout: fill the rest of the window, never scroll the page ---------
  const embedRef = useRef(null);
  const [embedHeight, setEmbedHeight] = useState(640);
  const [showContrib, setShowContrib] = useState(false);
  useLayoutEffect(() => {
    const fit = () => {
      const el = embedRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setEmbedHeight(Math.max(460, window.innerHeight - top - 12));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  // Session check only. The planner page already guards the route, so this
  // tab never redirects; problems are shown inside the tab.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Sesión no encontrada. Vuelva a iniciar sesión.');
      setLoading(false);
      return;
    }
    axios.get(`http://localhost:5000/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        setUser(res.data.user);
        fetchDashboardData(date);
      })
      .catch(() => {
        setError('No se pudo validar la sesión.');
        setLoading(false);
      });
  }, []);


  useEffect(() => {
    const checkProductionEnded = () => {
      const ended = isProductionEnded(date);
      setProductionEnded(ended);
    };
    
    checkProductionEnded();
    const interval = setInterval(checkProductionEnded, 60000);
    return () => clearInterval(interval);
  }, [date]);

  useEffect(() => {
    let timer;
    if (autoRefresh && date) {
      timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            refreshData();
            return 300;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [autoRefresh, date]);

  // Fetch all run details for each line - grouped by line
// Fetch all run details for each line - grouped by line
useEffect(() => {
  const fetchAllRunDetails = async () => {
    if (!lineData.length || !date) return;
    
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    
    try {
      // Use batch endpoint instead of individual requests
      const lines = lineData.map(line => line.lineNo);
      const batchRes = await axios.post(`http://localhost:5000/api/batch/line-runs-data`, 
        { lines, date },
        { headers }
      );
      
      if (batchRes.data.success) {
        const batchData = batchRes.data.data;
        const newRunDataMap = {};
        const lineTargets = {};
        
        let totalWeightedRealtimeEff = 0;
        let totalWeightedRealtimeTarget = 0;
        // Denominator for global RT efficiency, deduped by (line, style): a color
        // split shares one crew, so its realtime target is counted once, not per
        // color. The numerator (rtEff × rtTarget = production) stays per-run.
        const rtWeightTargetByLineStyle = new Map();
        
        for (const lineNo in batchData) {
          const runs = batchData[lineNo];
          
          if (runs.length === 0) {
            newRunDataMap[lineNo] = [];
            lineTargets[lineNo] = 0;
            continue;
          }
          
          const lineRuns = [];
          
          for (const run of runs) {
            const runData = {
              run: run,
              slots: run.runData.slots,
              operators: run.runData.operators,
              operations: run.runData.operations,
              slotTargets: run.runData.slotTargets
            };
            
            const finishedGarments = calculateFinishedGarments(runData);
            const rtEff = calculateRealtimeEfficiency(runData, date);
            const rtTarget = computeRealtimeTarget(runData, date);
            const dailyEff = calculateActualDailyEfficiency(runData);
            
            if (rtTarget > 0 && rtEff !== null) {
              totalWeightedRealtimeEff += rtEff * rtTarget;
              const rtKey = `${lineNo}||${run.style ?? ""}`;
              rtWeightTargetByLineStyle.set(
                rtKey,
                Math.max(rtWeightTargetByLineStyle.get(rtKey) || 0, rtTarget)
              );
            }
            
            lineRuns.push({
              runId: run.id,
              style: run.style,
              color: run.color,
              workOrderId: run.work_order_id ?? null,
              workOrderNo: run.work_order_no ?? null,
              workOrderStyle: run.work_order_style ?? null,
              targetPcs: run.target_pcs,
              finishedGarments: finishedGarments,
              realtimeTarget: rtTarget,
              realtimeEff: rtEff,
              dailyEff: dailyEff,
              operatorsCount: run.operators_count,
              workingHours: run.working_hours,
              sam: run.sam_minutes,
              runData: runData,
              hasProductionData: finishedGarments > 0 || (runData.operations && runData.operations.length > 0)
            });
          }
          
          newRunDataMap[lineNo] = lineRuns;
          if (lineRuns.length > 0) {
            // One realtime objetivo per style (was: first run only, which
            // under-counted multi-style lines and double-counted color splits).
            lineTargets[lineNo] = sumTargetByStyle(lineRuns, (r) => r.realtimeTarget);
          }
        }
        
        setRunDataMap(newRunDataMap);
        setGlobalRealtimeTarget(Object.values(lineTargets).reduce((a, b) => a + b, 0));

        // Sum one realtime target per (line, style) for the global RT efficiency.
        totalWeightedRealtimeTarget = [...rtWeightTargetByLineStyle.values()].reduce(
          (a, b) => a + b,
          0
        );

        if (!productionEnded && totalWeightedRealtimeTarget > 0) {
          const correctGlobalRealtimeEfficiency = totalWeightedRealtimeEff / totalWeightedRealtimeTarget;
          setGlobalRealtimeEfficiency(Math.round(correctGlobalRealtimeEfficiency * 100) / 100);
        }
        
        if (summary && summary.overallEfficiency !== undefined) {
          setGlobalDailyEfficiency(summary.overallEfficiency);
        }
      }
    } catch (err) {
      console.error('Error fetching batch data:', err);
    }
  };
  
  fetchAllRunDetails();
}, [lineData, date, productionEnded, summary]);

  const fetchDashboardData = async (selectedDate, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [summaryRes, lineRes, assignmentsRes] = await Promise.all([
        axios.get(`http://localhost:5000/api/supervisor/summary?date=${selectedDate}`, { headers }),
        axios.get(`http://localhost:5000/api/supervisor/line-performance?date=${selectedDate}`, { headers }),
        axios.get(`http://localhost:5000/api/supervisor/assignments?date=${selectedDate}`, { headers })
      ]);
      if (summaryRes.data.success) setSummary(summaryRes.data.summary);
      if (lineRes.data.success) setLineData(lineRes.data.lines);
      if (assignmentsRes.data.success) setAssignments(assignmentsRes.data.assignments);
      else setAssignments([]);
      
      setLastRefreshed(new Date());
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos del panel.');
    } finally {
      if (!isRefresh) setLoading(false);
    }
  };

  const refreshData = () => {
    fetchDashboardData(date, true);
  };

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    fetchDashboardData(newDate, false);
    setRunDataMap({});
    setCountdown(300);
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
    if (!autoRefresh) {
      setCountdown(300);
    }
  };

  const manualRefresh = () => {
    setCountdown(300);
    refreshData();
  };

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatNumber = (value) => {
    if (value == null) return '0';
    const num = Number(value);
    if (isNaN(num)) return '0';
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  };

  const formatDecimal = (value) => {
    if (value == null) return '0';
    const num = Number(value);
    if (isNaN(num)) return '0';
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  };

  // Calculate weighted efficiency for a line with multiple styles
  const calculateLineWeightedEfficiency = (runs, useRealtime = false) => {
    if (!runs || runs.length === 0) return 0;
    
    let totalWeightedEff = 0;
    let totalTarget = 0;
    
    for (const run of runs) {
      if (!run.hasProductionData) continue;
      
      let eff, target;
      
      if (useRealtime && !productionEnded) {
        // For realtime during production, only use if we have valid realtime data
        if (run.realtimeEff !== null && run.realtimeEff > 0 && !isNaN(run.realtimeEff) && isFinite(run.realtimeEff)) {
          eff = run.realtimeEff;
          target = run.realtimeTarget;
        } else {
          // Skip this run for realtime calculation if no realtime data
          continue;
        }
      } else {
        // For daily (or when production ended), always use daily values
        eff = run.dailyEff;
        target = run.targetPcs;
      }
      
      // Validate values
      const safeEff = (isNaN(eff) || !isFinite(eff)) ? 0 : eff;
      const safeTarget = (isNaN(target) || !isFinite(target)) ? 0 : target;
      
      if (safeTarget > 0) {
        totalWeightedEff += safeEff * safeTarget;
        totalTarget += safeTarget;
      }
    }
    
    return totalTarget > 0 ? totalWeightedEff / totalTarget : 0;
  };

  // Calculate total finished garments for a line
  const calculateLineTotalFinished = (runs) => {
    if (!runs || runs.length === 0) return 0;
    const total = runs.reduce((sum, run) => {
      const val = run.finishedGarments || 0;
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    return total;
  };

  // Calculate total target for a line (daily or realtime based on production status).
  // Counted once per style (same style/different color is one objetivo).
  const calculateLineTotalTarget = (runs) => {
    if (!runs || runs.length === 0) return 0;

    const effectiveTarget = (run) => {
      if (!run.hasProductionData) return 0;
      if (productionEnded) return Number(run.targetPcs) || 0;
      if (run.realtimeTarget > 0 && !isNaN(run.realtimeTarget) && isFinite(run.realtimeTarget)) {
        return Number(run.realtimeTarget);
      }
      return Number(run.targetPcs) || 0;
    };

    return sumTargetByStyle(runs, effectiveTarget);
  };

  // Prepare line data with calculated efficiency for sorting
  // Replace the prepareSortedLines function with this corrected version
const prepareSortedLines = () => {
  const linesWithEfficiency = [];
  
  for (const [lineNo, runs] of Object.entries(runDataMap)) {
    if (!runs || runs.length === 0) continue;
    
    // Filter runs that have actual production data
    const validRuns = runs.filter(run => {
      const hasProduction = run.finishedGarments > 0 || 
                          (run.runData && run.runData.operations && run.runData.operations.length > 0);
      return hasProduction;
    });
    
    if (validRuns.length === 0) continue;
    
    // For daily efficiency: weight by available minutes (operators × hours × 60)
    let totalSAMOutputDaily = 0;
    let totalAvailableMinutesDaily = 0;
    
    // For real-time efficiency: weight by target pieces
    let totalWeightedRealtimeEff = 0;
    let totalRealtimeTargetForWeighting = 0;
    
    let totalFinishedGarments = 0;
    let totalDailyTarget = 0;
    let totalRealtimeTarget = 0;
    
    for (const run of validRuns) {
      // Get values with proper defaults
      const sewed = run.finishedGarments || 0;
      const operators = run.operatorsCount || 0;
      const hours = run.workingHours || 0;
      const sam = run.sam || 0;
      const targetPcs = run.targetPcs || 0;
      const realtimeTarget = run.realtimeTarget || 0;
      const realtimeEff = run.realtimeEff || 0;
      
      // Calculate daily efficiency contribution (using total SAM output)
      if (operators > 0 && hours > 0 && sam > 0) {
        const availableMinutes = operators * hours * 60;
        const samOutput = sewed * sam;
        
        totalSAMOutputDaily += samOutput;
        totalAvailableMinutesDaily += availableMinutes;
      }
      
      // Accumulate totals for display
      totalFinishedGarments += sewed;
      totalDailyTarget += targetPcs;
      
      // For real-time, use target-based weighting if available
      if (!productionEnded && realtimeEff > 0 && realtimeTarget > 0) {
        totalWeightedRealtimeEff += realtimeEff * realtimeTarget;
        totalRealtimeTargetForWeighting += realtimeTarget;
        totalRealtimeTarget += realtimeTarget;
      } else {
        totalRealtimeTarget += targetPcs; // Fallback to daily target
      }
    }
    
    // Objetivo total per style: same style/different color counts once, different
    // styles sum. Capacity is per style too — a color split shares ONE crew, so
    // available minutes and the RT-weighting target are counted once per style
    // (12 operators for BLA + 12 for NEG of the same style = 12, not 24). The
    // numerators (SAM output, weighted efficiency) stay per-run, so production
    // still sums across every color.
    totalDailyTarget = sumTargetByStyle(validRuns, (r) => r.targetPcs);
    totalRealtimeTarget = sumTargetByStyle(validRuns, (r) =>
      r.realtimeTarget > 0 && isFinite(r.realtimeTarget) ? r.realtimeTarget : r.targetPcs
    );
    totalAvailableMinutesDaily = sumTargetByStyle(validRuns, (r) =>
      r.operatorsCount > 0 && r.workingHours > 0 && r.sam > 0
        ? r.operatorsCount * r.workingHours * 60
        : 0
    );
    totalRealtimeTargetForWeighting = sumTargetByStyle(
      validRuns.filter(
        (r) => !productionEnded && (r.realtimeEff || 0) > 0 && (r.realtimeTarget || 0) > 0
      ),
      (r) => r.realtimeTarget
    );
    
    // Calculate daily efficiency (weighted by available minutes)
    const lineDailyEfficiency = totalAvailableMinutesDaily > 0 
      ? (totalSAMOutputDaily / totalAvailableMinutesDaily) * 100 
      : 0;
    
    // Calculate real-time efficiency (weighted by target pieces)
    let lineRealtimeEfficiency = 0;
    if (!productionEnded && totalRealtimeTargetForWeighting > 0) {
      lineRealtimeEfficiency = totalWeightedRealtimeEff / totalRealtimeTargetForWeighting;
    }
    
    // Determine which efficiency to display and which target to show
    let displayEfficiency;
    let displayLabel;
    let displayTarget;
    
    if (productionEnded) {
      // After production ends, always show daily efficiency and daily target
      displayEfficiency = lineDailyEfficiency;
      displayLabel = 'Final';
      displayTarget = totalDailyTarget;
    } else {
      // During production, check if we have valid real-time data
      if (lineRealtimeEfficiency > 0 && totalRealtimeTargetForWeighting > 0) {
        // Use real-time efficiency and target
        displayEfficiency = lineRealtimeEfficiency;
        displayLabel = 'RT';
        displayTarget = totalRealtimeTarget;
      } else {
        // Fallback to daily efficiency and target
        displayEfficiency = lineDailyEfficiency;
        displayLabel = 'Daily';
        displayTarget = totalDailyTarget;
      }
    }
    
    // Debug log for Line 8 to verify calculations
    if (lineNo === 8) {
      console.log(`\n=== Line ${lineNo} Detailed Calculation ===`);
      console.log(`Runs on line: ${validRuns.length}`);
      console.log(`Total finished garments: ${totalFinishedGarments}`);
      console.log(`Total daily target: ${totalDailyTarget}`);
      console.log(`Total realtime target: ${totalRealtimeTarget}`);
      console.log(`Total SAM Output (daily): ${totalSAMOutputDaily}`);
      console.log(`Total Available Minutes (daily): ${totalAvailableMinutesDaily}`);
      console.log(`Daily Efficiency: ${lineDailyEfficiency.toFixed(2)}%`);
      console.log(`Realtime Efficiency: ${lineRealtimeEfficiency.toFixed(2)}%`);
      console.log(`Display Efficiency: ${displayEfficiency.toFixed(2)}%`);
      console.log(`Display Target: ${displayTarget}`);
      console.log(`Production Ended: ${productionEnded}`);
      console.log(`=====================================\n`);
    }
    
    linesWithEfficiency.push({
      lineNo,
      runs: validRuns,
      allRuns: runs,
      efficiency: displayEfficiency,
      displayLabel,
      totalFinished: totalFinishedGarments,
      totalTarget: displayTarget
    });
  }
  
  // Sort by efficiency (highest first)
  linesWithEfficiency.sort((a, b) => b.efficiency - a.efficiency);
  
  return linesWithEfficiency;
};

// Also update the calculateLineTotalFinished and calculateLineTotalTarget functions to use the new totals
// You can remove these old functions since we're calculating totals in prepareSortedLines now

// Make sure the productionEnded check is working correctly
const isProductionEnded = (selectedDate) => {
  if (!selectedDate) return false;
  const now = new Date();
  const todayStr = selectedDate;
  
  // Check if selected date is today
  const today = new Date().toISOString().slice(0, 10);
  if (selectedDate !== today) {
    // If viewing a past or future date, treat it as ended to show daily data
    return true;
  }
  
  const PRODUCTION_END = new Date(`${todayStr}T17:36:00`);
  return now >= PRODUCTION_END;
};


  // ---------------------------------------------------------------------------
  // Embedded (planner tab) layout — same data, cards and colors as the Skyrina
  // page, packed to fit the visible area: KPIs on one slim row, the line grid
  // stretches to fill what's left, and Contribuciones opens as a side panel
  // instead of sitting below the grid.
  // ---------------------------------------------------------------------------
  function renderEmbedded() {
    const sorted = Object.keys(runDataMap).length > 0 ? prepareSortedLines() : [];
    const n = sorted.length;
    const cols = Math.min(7, Math.max(4, Math.ceil(n / 4)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const fitsWithoutScroll = rows <= 5;
    const gridHeight = embedHeight - 44 - 64 - 16; // toolbar + KPI row + gaps
    const rowHeight = (gridHeight - (rows - 1) * 8) / rows;
    const roomy = rowHeight >= 165;

    const kpis = summary ? [
      { label: 'Meta', value: formatNumber(summary.totalTarget) },
      {
        label: 'Meta RT',
        value: formatNumber(globalRealtimeTarget),
        sub: `${summary.totalTarget > 0 ? ((globalRealtimeTarget / summary.totalTarget) * 100).toFixed(1) : 0}%`,
      },
      { label: 'Tot prod', value: formatNumber(summary.totalSewed) },
      productionEnded
        ? { label: 'Eff RT', value: 'FIN', cls: 'text-gray-400' }
        : { label: 'Eff RT', value: `${formatDecimal(globalRealtimeEfficiency)}%`, cls: getEfficiencyColor(globalRealtimeEfficiency) },
      { label: 'Diario', value: `${formatDecimal(globalDailyEfficiency)}%`, cls: getEfficiencyColor(globalDailyEfficiency) },
      { label: 'Cump', value: `${formatNumber(summary.targetAchievement)}%` },
    ] : [];

    return (
      <div
        ref={embedRef}
        style={{ height: embedHeight }}
        className="relative flex flex-col gap-2 overflow-hidden"
      >
        {/* Toolbar */}
        <div className="flex h-10 shrink-0 items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">Eficiencia diaria</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              productionEnded ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'
            }`}
          >
            {productionEnded ? 'Final del día' : '● En vivo'}
          </span>

          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <span className="hidden lg:inline">Act. {formatTime(lastRefreshed)}</span>
            <input
              type="date"
              value={date}
              onChange={handleDateChange}
              className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none"
              aria-label="Fecha"
            />
            <button
              type="button"
              onClick={toggleAutoRefresh}
              className={`h-8 rounded-md border px-2.5 font-medium ${
                autoRefresh ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-300 bg-white text-gray-600'
              }`}
              title="Actualizar automáticamente cada 5 minutos"
            >
              {autoRefresh ? `Auto ${formatCountdown(countdown)}` : 'Auto apagado'}
            </button>
            <button
              type="button"
              onClick={manualRefresh}
              disabled={loading}
              className="h-8 rounded-md border border-gray-300 bg-white px-2.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Cargando…' : 'Actualizar'}
            </button>
            <button
              type="button"
              onClick={() => setShowContrib((v) => !v)}
              disabled={assignments.length === 0}
              className={`h-8 rounded-md border px-2.5 font-medium disabled:opacity-40 ${
                showContrib ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Contribuciones ({assignments.length})
            </button>
          </div>
        </div>

        {error && (
          <div className="shrink-0 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700">⚠️ {error}</div>
        )}

        {/* KPI row */}
        {!loading && summary && (
          <div className="grid h-16 shrink-0 grid-cols-6 gap-2">
            {kpis.map((k) => (
              <div key={k.label} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 shadow-sm">
                <span className="text-[11px] font-bold uppercase text-blue-900">{k.label}</span>
                <span className="text-right">
                  <span className={`block text-xl font-bold leading-tight ${k.cls || 'text-gray-900'}`}>{k.value}</span>
                  {k.sub && <span className="block text-[10px] leading-none text-gray-500">{k.sub}</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Line grid — stretches to the remaining height */}
        <div className={`min-h-0 flex-1 ${fitsWithoutScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {loading && (
            <div className="h-full animate-pulse rounded-lg bg-white p-4">
              <div className="mb-3 h-5 w-1/4 rounded bg-gray-200" />
              <div className="h-[80%] rounded bg-gray-100" />
            </div>
          )}

          {!loading && n === 0 && (
            <div className="flex h-full items-center justify-center rounded-lg border border-gray-200 bg-white text-base font-medium text-gray-500">
              No se encontraron datos para esta fecha
            </div>
          )}

          {!loading && n > 0 && (
            <div
              className="grid h-full gap-2.5 p-0.5"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: fitsWithoutScroll
                  ? `repeat(${rows}, minmax(0, 1fr))`
                  : undefined,
                gridAutoRows: fitsWithoutScroll ? undefined : '150px',
              }}
            >
              {sorted.map((item) => {
                const { lineNo, runs, efficiency, displayLabel } = item;
                const lineTotalFinished = calculateLineTotalFinished(runs);
                const lineTotalTarget = calculateLineTotalTarget(runs);
                const uniqueStyles = [...new Set(runs.map((r) => r.style).filter(Boolean))];
                const uniqueColors = [...new Set(runs.map((r) => r.color).filter(Boolean))];
                const workOrderNos = [...new Set(runs.map((r) => r.workOrderNo).filter(Boolean))];
                const status = getLineStatus(efficiency);
                const variance = lineTotalFinished - lineTotalTarget;
                const variancePct = lineTotalTarget > 0 ? (variance / lineTotalTarget) * 100 : 0;
                const varTone = variance > 0 ? 'text-green-700 bg-green-50' : variance < 0 ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50';
                const accent = STATUS_ACCENT[status.color] || STATUS_ACCENT.gray;
                const modeLabel = MODE_LABEL[displayLabel] || displayLabel;

                return (
                  <article
                    key={lineNo}
                    className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                    title={[`Línea ${lineNo}`, ...uniqueStyles, ...uniqueColors, ...workOrderNos].join(' · ')}
                  >
                    {/* Status accent along the top edge */}
                    <span className={`absolute inset-x-0 top-0 h-1 ${accent}`} aria-hidden="true" />

                    <div className={`flex min-h-0 flex-1 flex-col ${roomy ? 'gap-2 px-3 pb-3 pt-3.5' : 'gap-1.5 px-2.5 pb-2 pt-2.5'}`}>
                      {/* Row 1: line · order / style / color · efficiency */}
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`flex shrink-0 items-center justify-center rounded-lg bg-gray-900 font-bold text-white ${
                            roomy ? 'h-11 w-11 text-lg' : 'h-9 w-9 text-base'
                          }`}
                        >
                          L{lineNo}
                        </div>

                        <div className="min-w-0 flex-1">
                          {workOrderNos.length > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-mono text-[12px] font-semibold text-gray-800">
                                {workOrderNos[0]}
                              </span>
                              {workOrderNos.length > 1 && (
                                <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600">
                                  +{workOrderNos.length - 1}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[12px] italic text-gray-400">Sin orden de trabajo</div>
                          )}
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                            <span className={`truncate font-bold text-gray-900 ${roomy ? 'text-[15px]' : 'text-[13px]'}`}>
                              {uniqueStyles.join(' / ') || '—'}
                            </span>
                            {uniqueColors.map((c) => (
                              <span
                                key={c}
                                className="shrink-0 rounded-md border border-gray-300 bg-gray-50 px-1.5 py-px text-[11px] font-semibold text-gray-700"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div className={`font-extrabold leading-none tabular-nums ${roomy ? 'text-[28px]' : 'text-[22px]'} ${getEfficiencyColor(efficiency)}`}>
                            {efficiency.toFixed(1)}%
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500">
                            Eficiencia {modeLabel}
                          </div>
                        </div>
                      </div>

                      {/* Efficiency bar with status */}
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${getProgressBarColor(efficiency)}`}
                            style={{ width: `${Math.min(Math.max(efficiency, 0), 100)}%` }}
                          />
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-px text-[10px] font-semibold ${getStatusBgColor(status.color)} ${getEfficiencyColor(efficiency)}`}>
                          {status.text}
                        </span>
                      </div>

                      {/* Row 3: meta / producido / variación */}
                      <div className="mt-auto grid grid-cols-3 gap-1.5">
                        <div className="rounded-lg bg-gray-50 px-2 py-1">
                          <div className="text-[11px] text-gray-500">Meta</div>
                          <div className={`font-bold tabular-nums text-gray-900 ${roomy ? 'text-lg' : 'text-base'} leading-tight`}>
                            {formatNumber(lineTotalTarget)}
                          </div>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-2 py-1">
                          <div className="text-[11px] text-gray-500">Producido</div>
                          <div className={`font-bold tabular-nums text-gray-900 ${roomy ? 'text-lg' : 'text-base'} leading-tight`}>
                            {formatNumber(lineTotalFinished)}
                          </div>
                        </div>
                        <div className={`rounded-lg px-2 py-1 ${varTone}`}>
                          <div className="text-[11px] opacity-80">Variación</div>
                          <div className={`font-bold tabular-nums ${roomy ? 'text-lg' : 'text-base'} leading-tight`}>
                            {variance > 0 ? '+' : variance < 0 ? '−' : ''}{formatNumber(Math.abs(variance))}
                            <span className="ml-1 text-[11px] font-semibold opacity-80">
                              {variance > 0 ? '+' : variance < 0 ? '−' : ''}{Math.abs(variancePct).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Contribuciones — side panel over the grid */}
        {showContrib && assignments.length > 0 && (
          <div className="absolute bottom-0 right-0 top-12 z-20 flex w-[380px] max-w-full flex-col rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className="text-sm font-bold text-gray-900">Contribuciones</span>
              <button
                type="button"
                onClick={() => setShowContrib(false)}
                className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-200 text-gray-500">
                    <th className="px-3 py-2 text-left">Línea</th>
                    <th className="px-3 py-2 text-left">Operador lento</th>
                    <th className="px-3 py-2 text-left">Ayudado por</th>
                    <th className="px-3 py-2 text-right">Piezas</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {assignments.map((a, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      <td className="px-3 py-1.5">{a.line_no}</td>
                      <td className="px-3 py-1.5">
                        {a.source_operator_no} {a.source_operator_name ? `(${a.source_operator_name})` : ''}
                      </td>
                      <td className="px-3 py-1.5">
                        {a.target_operator_no} {a.target_operator_name ? `(${a.target_operator_name})` : ''}
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold">{Math.round(a.total_helped_pieces)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }


  if (!user) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        {error ? <span className="text-red-600">⚠️ {error}</span> : 'Cargando eficiencia diaria…'}
      </div>
    );
  }

  return renderEmbedded();
}