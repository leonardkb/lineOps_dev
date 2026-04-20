// utils/calculateProductionDays.js - Enhanced Version

/**
 * Calculate production days using the improved formula:
 * Days = (Quantity × SAM) / (Operators × WorkingHours × 60 × Efficiency)
 */
export function calculateProductionDays(quantity, targetPerDay, workingHours, operators, samMinutes = null, efficiency = null) {
  if (!quantity || quantity <= 0) {
    return null;
  }

  let daysNeeded, workingDaysNeeded, hourlyRate, minutesPerPiece, totalMinutesNeeded, minutesPerDay, utilization;

  // If we have SAM and efficiency, use the more accurate minute-based calculation
  if (samMinutes && efficiency && operators && workingHours) {
    // Total minutes needed to produce the order
    const totalMinutesNeededCalc = quantity * samMinutes;
    
    // Total available minutes per day (AUTO)
    const dailyAvailableMinutes = operators * workingHours * 60;
    
    // Effective minutes available (accounting for efficiency)
    const effectiveDailyMinutes = dailyAvailableMinutes * efficiency;
    
    // Days needed (AUTO)
    daysNeeded = totalMinutesNeededCalc / effectiveDailyMinutes;
    workingDaysNeeded = Math.ceil(daysNeeded);
    
    // Calculate rates
    const piecesPerDay = effectiveDailyMinutes / samMinutes;
    hourlyRate = piecesPerDay / workingHours;
    minutesPerPiece = samMinutes / efficiency;
    totalMinutesNeeded = totalMinutesNeededCalc;
    minutesPerDay = effectiveDailyMinutes;
    utilization = (totalMinutesNeededCalc / (effectiveDailyMinutes * workingDaysNeeded)) * 100;
    
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + workingDaysNeeded);
    
    return {
      daysNeeded: Math.round(daysNeeded * 10) / 10,
      workingDaysNeeded,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
      totalMinutesNeeded: Math.round(totalMinutesNeeded),
      minutesPerDay: Math.round(minutesPerDay),
      targetPerDay: Math.round(piecesPerDay),
      quantity: quantity,
      utilization: Math.round(utilization),
      // Additional metrics for better planning
      totalMinutesAvailable: Math.round(dailyAvailableMinutes),
      effectiveMinutesAvailable: Math.round(effectiveDailyMinutes),
      efficiency: Math.round(efficiency * 100),
      samMinutes: samMinutes,
      operators: operators,
      workingHours: workingHours
    };
  } 
  // Fallback to simple target-based calculation
  else if (targetPerDay && targetPerDay > 0) {
    daysNeeded = quantity / targetPerDay;
    workingDaysNeeded = Math.ceil(daysNeeded);
    
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + workingDaysNeeded);
    
    hourlyRate = workingHours ? targetPerDay / workingHours : 0;
    minutesPerPiece = workingHours ? (workingHours * 60) / targetPerDay : 0;
    totalMinutesNeeded = quantity * minutesPerPiece;
    minutesPerDay = workingHours ? workingHours * 60 * (operators || 1) : 0;
    utilization = minutesPerDay ? (totalMinutesNeeded / (minutesPerDay * workingDaysNeeded)) * 100 : 0;
    
    return {
      daysNeeded: Math.round(daysNeeded * 10) / 10,
      workingDaysNeeded,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
      totalMinutesNeeded: Math.round(totalMinutesNeeded),
      minutesPerDay: Math.round(minutesPerDay),
      targetPerDay: Math.round(targetPerDay),
      quantity: quantity,
      utilization: Math.round(utilization)
    };
  }
  
  return null;
}

/**
 * Calculate line capacity using minute-based formula
 * Capacity = (Operators × WorkingHours × 60 × Efficiency) / SAM
 */
export function calculateLineCapacity(lineRun) {
  if (!lineRun) return null;
  
  const operators = lineRun.operators_count || 0;
  const workingHours = lineRun.working_hours || 0;
  const samMinutes = lineRun.sam_minutes || 0;
  const efficiency = lineRun.efficiency || 0.85;
  
  // Total minutes available per day
  const totalDailyMinutes = workingHours * 60 * operators;
  
  // Effective minutes after efficiency
  const effectiveDailyMinutes = totalDailyMinutes * efficiency;
  
  // Actual pieces per day
  const actualCapacity = effectiveDailyMinutes / samMinutes;
  
  // Minutes per piece (including efficiency)
  const minutesPerPiece = samMinutes / efficiency;
  
  // Theoretical capacity (100% efficiency)
  const theoreticalCapacity = totalDailyMinutes / samMinutes;
  
  return {
    totalDailyMinutes: Math.round(totalDailyMinutes),
    effectiveDailyMinutes: Math.round(effectiveDailyMinutes),
    minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
    theoreticalCapacity: Math.floor(theoreticalCapacity),
    actualCapacity: Math.floor(actualCapacity),
    efficiency: Math.round(efficiency * 100),
    utilizationRate: Math.round((actualCapacity / theoreticalCapacity) * 100),
    operators,
    workingHours,
    samMinutes
  };
}

/**
 * Calculate days needed for a work order with full details
 */
export function calculateWorkOrderDays(workOrder, lineRun) {
  if (!workOrder || !lineRun) return null;
  
  const quantity = parseFloat(workOrder.quantity);
  const samMinutes = parseFloat(lineRun.sam_minutes);
  const operators = parseInt(lineRun.operators_count);
  const workingHours = parseFloat(lineRun.working_hours);
  const efficiency = parseFloat(lineRun.efficiency) || 0.85;
  
  // Total minutes needed (AUTO)
  const totalMinutesNeeded = quantity * samMinutes;
  
  // Daily available minutes (AUTO)
  const dailyAvailableMinutes = operators * workingHours * 60;
  
  // Effective daily minutes after efficiency
  const effectiveDailyMinutes = dailyAvailableMinutes * efficiency;
  
  // Days needed (AUTO)
  const daysNeeded = totalMinutesNeeded / effectiveDailyMinutes;
  const fullDaysNeeded = Math.ceil(daysNeeded);
  
  // Production schedule by day
  const piecesPerDay = effectiveDailyMinutes / samMinutes;
  const schedule = [];
  let remainingPieces = quantity;
  let currentDate = new Date();
  let totalMinutesUsed = 0;
  
  for (let day = 1; day <= fullDaysNeeded && remainingPieces > 0; day++) {
    const piecesThisDay = Math.min(Math.floor(piecesPerDay), remainingPieces);
    const minutesThisDay = piecesThisDay * samMinutes;
    
    schedule.push({
      day,
      date: formatDate(currentDate),
      pieces: piecesThisDay,
      minutes: Math.round(minutesThisDay),
      cumulativePieces: quantity - remainingPieces + piecesThisDay,
      cumulativeMinutes: Math.round(totalMinutesUsed + minutesThisDay)
    });
    
    remainingPieces -= piecesThisDay;
    totalMinutesUsed += minutesThisDay;
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + fullDaysNeeded);
  
  return {
    daysNeeded: Math.round(daysNeeded * 10) / 10,
    fullDaysNeeded,
    totalMinutesNeeded: Math.round(totalMinutesNeeded),
    dailyAvailableMinutes: Math.round(dailyAvailableMinutes),
    effectiveDailyMinutes: Math.round(effectiveDailyMinutes),
    piecesPerDay: Math.floor(piecesPerDay),
    piecesPerHour: Math.floor(piecesPerDay / workingHours),
    minutesPerPiece: Math.round((samMinutes / efficiency) * 100) / 100,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    schedule,
    efficiency: Math.round(efficiency * 100),
    utilization: Math.round((effectiveDailyMinutes / dailyAvailableMinutes) * 100),
    // Formula breakdown for transparency
    formula: {
      totalMinutesNeeded: `${quantity} × ${samMinutes} = ${Math.round(totalMinutesNeeded)} min`,
      dailyAvailableMinutes: `${operators} × ${workingHours} × 60 = ${dailyAvailableMinutes} min`,
      effectiveDailyMinutes: `${dailyAvailableMinutes} × ${efficiency} = ${Math.round(effectiveDailyMinutes)} min`,
      daysNeeded: `${Math.round(totalMinutesNeeded)} / ${Math.round(effectiveDailyMinutes)} = ${Math.round(daysNeeded * 10) / 10} días`
    }
  };
}

/**
 * Suggest optimal line based on quantity and available lines
 */
export function suggestOptimalLine(quantity, availableLines) {
  if (!quantity || !availableLines || availableLines.length === 0) return null;
  
  return availableLines
    .map(line => {
      const capacity = line.actualCapacity || line.target_pcs || 0;
      const daysNeeded = capacity > 0 ? quantity / capacity : Infinity;
      return {
        ...line,
        daysNeeded: Math.round(daysNeeded * 10) / 10,
        willFinishInDays: Math.ceil(daysNeeded),
        capacity: capacity
      };
    })
    .filter(line => line.daysNeeded < Infinity)
    .sort((a, b) => a.daysNeeded - b.daysNeeded);
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default {
  calculateProductionDays,
  calculateLineCapacity,
  calculateWorkOrderDays,
  suggestOptimalLine
};