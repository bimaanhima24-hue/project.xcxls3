import { format, parse, differenceInMinutes, isAfter, isBefore, addMinutes, startOfDay, startOfHour, eachHourOfInterval, min as minDate, max as maxDate } from 'date-fns';

export interface Order {
  id: string;
  arrival: Date;
  completion: Date;
  obatRacik?: number;
  obatNonRacik?: number;
}

export interface ReconstructedOrder extends Order {
  estimatedStart: Date;
  waitTime: number; // in minutes
  serviceTime: number; // in minutes
  leadTime: number; // in minutes
  staffId: number;
}

export interface WorkloadMetrics {
  totalOrders: number;
  avgWaitTime: number;
  avgServiceTime: number;
  avgLeadTime: number; // in minutes
  utilizationRate: number;
  peakHour: string;
  hourlyData: {
    hour: string;
    arrivals: number;
    completions: number;
    occupancy: number; // 0 to 1
    avgLeadTime: number; // in minutes
  }[];
}

/**
 * Reconstructs wait times and service times based on a two-stage queueing simulation.
 * - Stage 1 (Profiling): Estimate baseline service time per recipe from historical data assuming baseline staff (e.g., 2).
 * - Stage 2 (Simulation): Run a discrete-event FIFO simulation using target staff count and profiled service times.
 *
 * @param orders List of orders.
 * @param numStaff Number of active compounding staff in Stage 2.
 * @param handoverOffset Minutes subtracted from completion to get actual compounding finish (delivery/KIE offset).
 * @param baselineStaff Number of staff in Stage 1 baseline profiling (usually 2).
 * @param serviceType 'empirical' (per-order profiled time) or 'constant' (use average service time) or 'bypassed' (bypass Stage 1 completely and use a custom constant).
 * @param bypassedServiceTime Constant service time when serviceType list is set to 'bypassed' (default 6.2).
 */
export function analyzeWorkload(
  orders: Order[], 
  numStaff: number, 
  handoverOffset: number = 0,
  baselineStaff: number = 2,
  serviceType: 'empirical' | 'constant' | 'bypassed' = 'empirical',
  bypassedServiceTime: number = 6.2
): { 
  reconstructed: ReconstructedOrder[], 
  metrics: WorkloadMetrics, 
  dailyMetrics: any[], 
  profiledAvgServiceTime: number 
} {
  if (orders.length === 0) {
    return { reconstructed: [], metrics: emptyMetrics(), dailyMetrics: [], profiledAvgServiceTime: 0 };
  }

  // Sort orders by arrival time
  const sortedOrders = [...orders].sort((a, b) => a.arrival.getTime() - b.arrival.getTime());

  // --- STAGE 1: PROFILING SERVICE TIMINGS ---
  // We reconstruct the baseline service speeds using baseline staff count (typically 2 in real-world clinic records)
  const baselineStaffState = new Array(baselineStaff).fill(null).map((_, i) => ({
    id: i + 1,
    availableAt: new Date(0)
  }));

  const profiledDurations: { [orderId: string]: number } = {};

  sortedOrders.forEach((order) => {
    // Reset staff availability if a new day starts
    baselineStaffState.forEach(s => {
      if (isBefore(s.availableAt, startOfDay(order.arrival))) {
        s.availableAt = order.arrival;
      }
    });

    baselineStaffState.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime());
    const bestBaselineStaff = baselineStaffState[0];

    const baselineStart = isAfter(bestBaselineStaff.availableAt, order.arrival)
      ? bestBaselineStaff.availableAt
      : order.arrival;

    // Compounding stops subtraction of packaging and counselling offset
    const compoundingCompletion = addMinutes(order.completion, -handoverOffset);
    
    let duration = differenceInMinutes(compoundingCompletion, baselineStart);
    if (duration < 1) {
      // Fallback if data contains weird timestamps (completion before start, etc.)
      const orderTotalLead = differenceInMinutes(order.completion, order.arrival);
      duration = Math.max(2, orderTotalLead - handoverOffset);
    }

    profiledDurations[order.id] = duration;

    // Update baseline staff availability
    bestBaselineStaff.availableAt = compoundingCompletion > baselineStart ? compoundingCompletion : addMinutes(baselineStart, duration);
  });

  const profiledDurationsArray = Object.values(profiledDurations);
  const profiledAvgServiceTime = Math.round(
    profiledDurationsArray.reduce((acc, curr) => acc + curr, 0) / profiledDurationsArray.length
  ) || 8;

  // --- STAGE 2: DYNAMIC EVENT SIMULATION ---
  // Run FIFO Queue Simulation with the user-selected numStaff and service time model
  const activeStaffState = new Array(numStaff).fill(null).map((_, i) => ({
    id: i + 1,
    availableAt: new Date(0)
  }));

  const reconstructed: ReconstructedOrder[] = [];

  sortedOrders.forEach((order) => {
    // Reset staff availability if it's a new day
    activeStaffState.forEach(s => {
      if (isBefore(s.availableAt, startOfDay(order.arrival))) {
        s.availableAt = order.arrival;
      }
    });

    activeStaffState.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime());
    const bestStaff = activeStaffState[0];

    // Simulated start is when the earliest staff is available or when the order arrives
    const simStart = isAfter(bestStaff.availableAt, order.arrival)
      ? bestStaff.availableAt
      : order.arrival;

    // Determine service time to use
    let serviceTime = profiledAvgServiceTime;
    if (serviceType === 'bypassed') {
      serviceTime = bypassedServiceTime;
    } else if (serviceType === 'empirical') {
      serviceTime = profiledDurations[order.id] || profiledAvgServiceTime;
    }

    // Compounding ends after serviceTime minutes (simulated with precision using ms for decimals)
    const simCompFinish = new Date(simStart.getTime() + serviceTime * 60 * 1000);

    // Patient receives the medicine after compounding + handover offset
    const simPatientCompletion = new Date(simCompFinish.getTime() + handoverOffset * 60 * 1000);

    const waitTime = differenceInMinutes(simStart, order.arrival);
    const leadTime = differenceInMinutes(simPatientCompletion, order.arrival);

    reconstructed.push({
      ...order,
      estimatedStart: simStart,
      completion: simPatientCompletion, // Simulated completion timestamp
      waitTime: Math.max(0, waitTime),
      serviceTime: serviceTime,
      leadTime: Math.max(0, leadTime),
      staffId: bestStaff.id
    });

    // Best staff is available after compiling this order
    bestStaff.availableAt = simCompFinish;
  });

  // Keep track of orders per day for grouped daily metrics
  const ordersByDay: { [key: string]: ReconstructedOrder[] } = {};
  reconstructed.forEach(o => {
    const day = format(o.arrival, 'yyyy-MM-dd');
    if (!ordersByDay[day]) ordersByDay[day] = [];
    ordersByDay[day].push(o);
  });

  // Calculate metrics based on simulation results
  let totalActiveMinutes = 0;
  const dailyMetrics = Object.entries(ordersByDay).map(([day, dayOrders]) => {
    const dayStart = minDate(dayOrders.map(o => o.arrival));
    const dayEnd = maxDate(dayOrders.map(o => o.completion));
    const dayDuration = Math.max(1, differenceInMinutes(dayEnd, dayStart));

    // Calculate hourly occupancy and lead time (Fixed Range 07:00 - 12:00)
    const dayHourMap: { [key: string]: number } = {};
    const dayHourLeadSum: { [key: string]: number } = {};
    const dayHourLeadCount: { [key: string]: number } = {};
    const dayHourCompletions: { [key: string]: number } = {};
    const ALL_HOURS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
    ALL_HOURS.forEach(h => {
      dayHourMap[h] = 0;
      dayHourLeadSum[h] = 0;
      dayHourLeadCount[h] = 0;
      dayHourCompletions[h] = 0;
    });

    dayOrders.forEach(o => {
      const h = format(o.arrival, 'HH:00');
      if (dayHourMap.hasOwnProperty(h)) {
        dayHourMap[h] += o.serviceTime;
        dayHourLeadSum[h] += o.leadTime;
        dayHourLeadCount[h] += 1;
      }

      const hComp = format(o.completion, 'HH:00');
      if (dayHourCompletions.hasOwnProperty(hComp)) {
        dayHourCompletions[hComp] += 1;
      }
    });

    const dayHourly = ALL_HOURS.map(hour => {
      const count = dayHourLeadCount[hour];
      return {
        hour,
        occupancy: Math.min(1, dayHourMap[hour] / (numStaff * 60)),
        avgLeadTime: count > 0 ? parseFloat((dayHourLeadSum[hour] / count).toFixed(1)) : 0,
        orderCount: count,
        completions: dayHourCompletions[hour]
      };
    });

    const dayServiceTime = dayOrders.reduce((acc, curr) => acc + curr.serviceTime, 0);
    const dayUtil = Math.min(1, dayServiceTime / (numStaff * dayDuration));

    totalActiveMinutes += dayDuration;

    return {
      day,
      orderCount: dayOrders.length,
      duration: dayDuration,
      utilization: dayUtil,
      avgWait: dayOrders.reduce((acc, curr) => acc + curr.waitTime, 0) / dayOrders.length,
      avgLead: dayOrders.reduce((acc, curr) => acc + curr.leadTime, 0) / dayOrders.length,
      hourly: dayHourly
    };
  });

  const totalServiceTime = reconstructed.reduce((acc, curr) => acc + curr.serviceTime, 0);
  const utilizationRate = totalActiveMinutes > 0
    ? (totalServiceTime / (numStaff * totalActiveMinutes))
    : 0;

  // Hourly statistics
  const hourMap: { [key: string]: { arrivals: number, completions: number, busy: number, leadTimeSum: number } } = {};
  reconstructed.forEach(o => {
    const h = format(o.arrival, 'HH:00');
    if (!hourMap[h]) hourMap[h] = { arrivals: 0, completions: 0, busy: 0, leadTimeSum: 0 };
    hourMap[h].arrivals++;
    hourMap[h].leadTimeSum += o.leadTime;

    const hComp = format(o.completion, 'HH:00');
    if (!hourMap[hComp]) hourMap[hComp] = { arrivals: 0, completions: 0, busy: 0, leadTimeSum: 0 };
    hourMap[hComp].completions++;

    hourMap[h].busy += o.serviceTime;
  });

  const numDays = Math.max(1, Object.keys(ordersByDay).length);
  const ALLOWED_HOURS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
  const hourlyData = Object.entries(hourMap)
    .filter(([hour]) => ALLOWED_HOURS.includes(hour))
    .map(([hour, data]) => ({
      hour,
      arrivals: parseFloat((data.arrivals / numDays).toFixed(1)),
      completions: parseFloat((data.completions / numDays).toFixed(1)),
      occupancy: Math.min(1, data.busy / (numStaff * 60 * numDays)),
      avgLeadTime: data.arrivals > 0 ? parseFloat((data.leadTimeSum / data.arrivals).toFixed(1)) : 0
    })).sort((a, b) => a.hour.localeCompare(b.hour));

  const peakHour = [...hourlyData].sort((a, b) => b.arrivals - a.arrivals)[0]?.hour || '-';

  return {
    reconstructed,
    metrics: {
      totalOrders: reconstructed.length,
      avgWaitTime: reconstructed.reduce((acc, curr) => acc + curr.waitTime, 0) / reconstructed.length,
      avgServiceTime: totalServiceTime / reconstructed.length,
      avgLeadTime: reconstructed.reduce((acc, curr) => acc + curr.leadTime, 0) / reconstructed.length,
      utilizationRate: Math.min(1, utilizationRate),
      peakHour,
      hourlyData
    },
    dailyMetrics,
    profiledAvgServiceTime
  };
}

function emptyMetrics(): WorkloadMetrics {
  return {
    totalOrders: 0,
    avgWaitTime: 0,
    avgServiceTime: 0,
    avgLeadTime: 0,
    utilizationRate: 0,
    peakHour: '-',
    hourlyData: []
  };
}
