
export function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Target in PIECES using SAM (minutes per piece)
 * operators: count
 * workingHours: hours (ex: 8.85)
 * sam: minutes per piece
 * efficiency: decimal (0.7 for 70%)
 */
export function calcTargetFromSAM(operators, workingHours, sam, efficiency) 
{
  const ops = safeNum(operators);
  const wh = safeNum(workingHours);
  const samMin = safeNum(sam);
  const eff = safeNum(efficiency);

  if (ops <= 0 || wh <= 0 || samMin <= 0 || eff <= 0) return 0;

  const totalMinutes = ops * wh * 60;
  const piecesAt100 = totalMinutes / samMin;
  const target = piecesAt100 * eff;

  return target;
}

/**
 * Capacity per operator per hour from time study (seconds)
 * formula: 3600 / averageSeconds
 * For single operation: average of t1-t5
 */
export function calcCapacityPerHourFromTimes(t1, t2, t3, t4, t5) {
  const arr = [t1, t2, t3, t4, t5].map((x) => safeNum(x, 0)).filter((x) => x > 0);
  if (arr.length === 0) return 0;

  const avgSec = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (avgSec <= 0) return 0;

  return 3600 / avgSec;
}

/**
 * Calculate capacity per hour for an operator with multiple operations
 * @param {Array} operations - Array of operation objects with t1, t2, t3, t4, t5 properties
 * @returns {number} - Capacity per hour
 */
export function calcCapacityPerHourForMultipleOperations(operations) {
  if (!operations || operations.length === 0) return 0;
  
  // Sum ALL time measurements from ALL operations
  let totalSum = 0;
  
  operations.forEach(op => { 
    totalSum += safeNum(op.t1, 0);
    totalSum += safeNum(op.t2, 0);
    totalSum += safeNum(op.t3, 0);
    totalSum += safeNum(op.t4, 0);
    totalSum += safeNum(op.t5, 0);
  });
  
  if (totalSum <= 0) return 0;
  
  // Divide by 5 (number of time studies)
  const timePerPiece = totalSum / 5;
  
  return 3600 / timePerPiece;
}