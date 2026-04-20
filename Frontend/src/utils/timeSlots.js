// utils/timeSlots.js (fixed)
import { safeNum } from "./calc";

export function buildShiftSlots({
  workingHours,
  startHour = 9,
  endHour = 17,
  lunchHour = 13,
  firstSlotHours = 0.75,
  lunchSlotHours = 0.5,
  lastSlotHours = 0.6,
  lastSlotLabelMinutes = 36,
}) {
  const wh = safeNum(workingHours);
  if (wh <= 0) return [];

  // Helper to pad numbers to two digits
  const pad = (n) => String(n).padStart(2, "0");

  // Generate labels and compute base hours (same as before)
  const labels = [];
  for (let h = startHour; h <= endHour; h++) labels.push(`${h}`);
  labels.push(`${endHour}:${pad(lastSlotLabelMinutes)}`);

  const base = labels.map((lab) => {
    const hourOnly = Number(lab.split(":")[0]);
    if (lab === `${endHour}:${pad(lastSlotLabelMinutes)}`) return lastSlotHours;
    if (hourOnly === startHour) return firstSlotHours;
    if (hourOnly === lunchHour) return lunchSlotHours;
    return 1;
  });

  const baseSum = base.reduce((a, b) => a + b, 0) || 1;
  const scale = wh / baseSum;

  // Build slots with start/end times
  const slots = [];
  let currentTime = new Date();
  currentTime.setHours(startHour, 0, 0, 0); // start at 09:00:00

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const hours = Number((base[i] * scale).toFixed(2));

    // Calculate end time by adding hours (as decimal) to currentTime
    const endTime = new Date(currentTime.getTime() + hours * 60 * 60 * 1000);

    // Format as HH:MM:SS (always two digits)
    const startStr = `${pad(currentTime.getHours())}:${pad(currentTime.getMinutes())}:${pad(currentTime.getSeconds())}`;
    const endStr = `${pad(endTime.getHours())}:${pad(endTime.getMinutes())}:${pad(endTime.getSeconds())}`;

    slots.push({
      id: `slot-${i}`,
      label,
      hours,
      startTime: startStr,
      endTime: endStr,
    });

    // Move current time forward
    currentTime = endTime;
  }

  // Fix tiny rounding drift: adjust last slot to match exact total
  const sum = slots.reduce((a, s) => a + s.hours, 0);
  const diff = Number((wh - sum).toFixed(2));
  if (Math.abs(diff) >= 0.01) {
    const last = slots[slots.length - 1];
    last.hours = Number((last.hours + diff).toFixed(2));

    // Recalculate end time for the last slot
    const prevEnd = new Date();
    if (slots.length > 1) {
      const prev = slots[slots.length - 2];
      const [ph, pm, ps] = prev.endTime.split(":").map(Number);
      prevEnd.setHours(ph, pm, ps);
    } else {
      prevEnd.setHours(startHour, 0, 0);
    }
    const newEnd = new Date(prevEnd.getTime() + last.hours * 60 * 60 * 1000);
    last.endTime = `${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}:${pad(newEnd.getSeconds())}`;
  }

  return slots;
}

export function cumulative(arr, pick) {
  let run = 0;
  return arr.map((x) => {
    run += pick(x);
    return run;
  });
}