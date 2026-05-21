// SkyrinaDashboard.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import NavSkyrina from '../components/NavSkyrina';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

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

export default function SkyrinaDashboard() {
  const navigate = useNavigate();
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

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/', { replace: true });
      return;
    }

    axios.get(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        const user = res.data.user;
        if (user.role !== 'supervisor' && user.role !== 'skyrina') {
          if (user.role === 'line_leader') {
            navigate('/lineleader', { replace: true });
          } else {
            navigate('/planner', { replace: true });
          }
          return;
        }
        setUser(user);
        fetchDashboardData(date);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
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

// Replace the fetchAllRunDetails useEffect in SkyrinaDashboard.jsx
useEffect(() => {
  const fetchAllRunDetails = async () => {
    if (!lineData.length || !date) return;
    
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    
    try {
      // Use batch endpoint instead of individual requests
      const lines = lineData.map(line => line.lineNo);
      const batchRes = await axios.post(`${API_BASE}/api/batch/line-runs-data`, 
        { lines, date },
        { headers }
      );
      
      if (batchRes.data.success) {
        const batchData = batchRes.data.data;
        const newRunDataMap = {};
        const lineTargets = {};
        
        let totalWeightedRealtimeEff = 0;
        let totalWeightedRealtimeTarget = 0;
        
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
            
            // ... rest of your processing logic remains the same
            if (rtTarget > 0 && rtEff !== null) {
              totalWeightedRealtimeEff += rtEff * rtTarget;
              totalWeightedRealtimeTarget += rtTarget;
            }
            
            lineRuns.push({
              runId: run.id,
              style: run.style,
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
            const firstRun = lineRuns[0];
            const lineRealtimeTarget = computeRealtimeTarget(firstRun.runData, date);
            lineTargets[lineNo] = lineRealtimeTarget;
          }
        }
        
        setRunDataMap(newRunDataMap);
        setGlobalRealtimeTarget(Object.values(lineTargets).reduce((a, b) => a + b, 0));
        
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
        axios.get(`${API_BASE}/api/supervisor/summary?date=${selectedDate}`, { headers }),
        axios.get(`${API_BASE}/api/supervisor/line-performance?date=${selectedDate}`, { headers }),
        axios.get(`${API_BASE}/api/supervisor/assignments?date=${selectedDate}`, { headers })
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

  // Calculate total target for a line (daily or realtime based on production status)
  const calculateLineTotalTarget = (runs) => {
    if (!runs || runs.length === 0) return 0;
    
    let totalTarget = 0;
    let hasValidTarget = false;
    
    for (const run of runs) {
      if (!run.hasProductionData) continue;
      
      // If production has ended, always use daily target
      if (productionEnded) {
        if (run.targetPcs > 0 && !isNaN(run.targetPcs) && isFinite(run.targetPcs)) {
          totalTarget += run.targetPcs;
          hasValidTarget = true;
        }
      } 
      // During production, use realtime target if available
      else {
        if (run.realtimeTarget > 0 && !isNaN(run.realtimeTarget) && isFinite(run.realtimeTarget)) {
          totalTarget += run.realtimeTarget;
          hasValidTarget = true;
        } 
        // Fall back to daily target if realtime target is 0
        else if (run.targetPcs > 0 && !isNaN(run.targetPcs) && isFinite(run.targetPcs)) {
          totalTarget += run.targetPcs;
          hasValidTarget = true;
        }
      }
    }
    
    return hasValidTarget ? totalTarget : 0;
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

// Update the line card rendering section to use the new item properties
// In the line cards section, make sure you're using item.totalTarget and item.totalFinished

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-20 w-20 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
          <p className="mt-6 text-xl text-gray-600 font-medium">Cargando panel Skyrina...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col h-screen overflow-hidden">
      <NavSkyrina 
        userName={user?.full_name || user?.username}
        date={date}
        onDateChange={handleDateChange}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
        onManualRefresh={manualRefresh}
        loading={loading}
        lastRefreshed={lastRefreshed}
        countdown={countdown}
        formatCountdown={formatCountdown}
        formatTime={formatTime}
      />

      <main className="flex-1 max-w-[1920px] mx-auto px-4 py-2 w-full overflow-y-auto">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-lg mb-2 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Summary Cards */}
        {!loading && summary && (
          <div className="grid grid-cols-6 gap-3 mb-4">
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">META</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(summary.totalTarget)}</div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">META RT</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(globalRealtimeTarget)}</div>
                <div className="text-xs text-gray-500">
                  {summary.totalTarget > 0 ? ((globalRealtimeTarget / summary.totalTarget) * 100).toFixed(1) : 0}%
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">TOT PROD</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(summary.totalSewed)}</div>
              </div>
            </div>

            {!productionEnded ? (
              <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
                <div className="text-center">
                  <div className="text-blue-900 text-xs font-bold mb-1">EFF RT</div>
                  <div className={`text-2xl font-bold ${getEfficiencyColor(globalRealtimeEfficiency)}`}>
                    {formatDecimal(globalRealtimeEfficiency)}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
                <div className="text-center">
                  <div className="text-blue-900 text-xs font-bold mb-1">EFF RT</div>
                  <div className="text-2xl font-bold text-gray-400">FIN</div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">DIARIO</div>
                <div className={`text-2xl font-bold ${getEfficiencyColor(globalDailyEfficiency)}`}>
                  {formatDecimal(globalDailyEfficiency)}%
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">CUMP</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(summary.targetAchievement)}%</div>
              </div>
            </div>
          </div>
        )}

        {/* Line Cards */}
        {!loading && Object.keys(runDataMap).length > 0 && (
          <div className="grid grid-cols-7 gap-3">
            {prepareSortedLines().map((item) => {
              const { lineNo, runs, efficiency, displayLabel } = item;
              const lineTotalFinished = calculateLineTotalFinished(runs);
              const lineTotalTarget = calculateLineTotalTarget(runs);
              
              const displayEfficiency = efficiency;
              const status = getLineStatus(displayEfficiency);
              const cardId = `L${lineNo}`;
              
              const variance = lineTotalFinished - lineTotalTarget;
              const variancePercent = lineTotalTarget > 0 
                ? Math.abs((variance / lineTotalTarget) * 100) 
                : 0;

              return (
                <div
                  key={`${lineNo}`}
                  onMouseEnter={() => setHoveredCard(cardId)}
                  onMouseLeave={() => setHoveredCard(null)}
                  className={`bg-white rounded-lg shadow-md 
                    hover:shadow-lg transition-all duration-200
                    border-l-4 ${getStatusColor(status.color)} 
                    border-t border-r border-b border-gray-200
                    ${hoveredCard === cardId ? 'shadow-lg scale-[1.01]' : ''}`}
                >
                  <div className="px-2 py-1.5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-base text-gray-900">L{lineNo}</span>
                      <div className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${getStatusBgColor(status.color)}`}>
                        {status.icon}
                      </div>
                    </div>
                    
                    <div className="text-xs font-medium text-gray-600 truncate" title={runs.map(r => r.style).join(', ')}>
                      {runs.map(r => r.style).join(' / ')}
                    </div>
                  </div>

                  <div className="p-2">
                    <div className="mb-2">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] text-gray-500">{displayLabel}</span>
                        <span className={`text-sm font-bold ${getEfficiencyColor(displayEfficiency)}`}>
                          {displayEfficiency.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(displayEfficiency)}`}
                          style={{ width: `${Math.min(displayEfficiency, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1 mb-2">
                      <div className="bg-gray-50 rounded p-1.5">
                        <div className="text-[9px] text-gray-500 mb-0.5">Obj RT</div>
                        <div className="text-sm font-bold text-gray-900">{formatNumber(lineTotalTarget)}</div>
                      </div>
                      <div className="bg-gray-50 rounded p-1.5">
                        <div className="text-[9px] text-gray-500 mb-0.5">Cosido</div>
                        <div className="text-sm font-bold text-gray-900">{formatNumber(lineTotalFinished)}</div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-1.5 border-t border-gray-100">
                      <span className="text-[10px] text-gray-500">Var</span>
                      <span className={`font-mono font-bold flex items-center gap-0.5 text-xs ${
                        lineTotalFinished > lineTotalTarget ? 'text-green-600' : 
                        lineTotalFinished < lineTotalTarget ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {lineTotalFinished > lineTotalTarget ? '↑' : lineTotalFinished < lineTotalTarget ? '↓' : '→'}
                        {lineTotalFinished > lineTotalTarget ? '+' : ''}{formatNumber(Math.abs(variance))}
                        <span className="text-[8px] opacity-75">
                          ({variancePercent.toFixed(0)}%)
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-xl shadow p-6">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
              <div className="h-48 bg-gray-100 rounded"></div>
            </div>
          </div>
        )}

        {!loading && Object.keys(runDataMap).length === 0 && (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <p className="text-gray-500 text-xl font-medium">
              No se encontraron datos para esta fecha
            </p>
          </div>
        )}

        {/* Assignments Section */}
        {!loading && assignments.length > 0 && (
          <div className="mt-4">
            <h2 className="text-gray-900 text-base font-bold mb-2">Contribuciones</h2>
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="px-3 py-2 text-left">Línea</th>
                      <th className="px-3 py-2 text-left">Operador lento</th>
                      <th className="px-3 py-2 text-left">Ayudado por</th>
                      <th className="px-3 py-2 text-left">Piezas</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-900">
                    {assignments.map((a, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="px-3 py-2">{a.line_no}</td>
                        <td className="px-3 py-2">
                          {a.source_operator_no} {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {a.target_operator_no} {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                        </td>
                        <td className="px-3 py-2 font-bold">{Math.round(a.total_helped_pieces)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="py-2 bg-white border-t border-gray-200">
        <div className="max-w-[1920px] mx-auto px-4 text-center">
          <p className="text-gray-500 text-xs">
            Skyrina Dashboard • {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </footer>
    </div>
  );
}