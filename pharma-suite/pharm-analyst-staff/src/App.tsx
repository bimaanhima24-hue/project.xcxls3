/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, LineChart, Line, Legend, LabelList, PieChart, Pie, Cell
} from 'recharts';
import { 
  Users, Clock, ClipboardList, TrendingUp, Upload, Info, 
  AlertCircle, ChevronRight, Activity, Brain
} from 'lucide-react';
import { format, parse } from 'date-fns';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { analyzeWorkload, type Order, type WorkloadMetrics, type ReconstructedOrder } from './lib/workload';
import { GoogleGenAI } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const translateDay = (dayStr: string) => {
  const map: { [key: string]: string } = {
    'Monday': 'Senin',
    'Tuesday': 'Selasa',
    'Wednesday': 'Rabu',
    'Thursday': 'Kamis',
    'Friday': 'Jumat',
    'Saturday': 'Sabtu',
    'Sunday': 'Minggu'
  };
  return map[dayStr] || dayStr;
};

const getIndonesianDateString = (dateStr: string) => {
  const dateObj = new Date(dateStr);
  const dayName = format(dateObj, 'EEEE');
  const formattedDate = format(dateObj, 'dd MMM yyyy');
  return `${translateDay(dayName)}, ${formattedDate}`;
};

const getDayNameOnly = (dateStr: string) => {
  const dateObj = new Date(dateStr);
  const dayName = format(dateObj, 'EEEE');
  return translateDay(dayName);
};

// Sample Data helper
const DEFAULT_SAMPLE_DATA = `ID,Waktu Masuk,Obat Racik,Obat Non Racik,Waktu Selesai
ORD001,2024-05-14 08:00,0,2,2024-05-14 08:15
ORD002,2024-05-14 08:05,0,3,2024-05-14 08:30
ORD003,2024-05-14 08:10,1,2,2024-05-14 08:25
ORD004,2024-05-14 08:15,0,4,2024-05-14 08:45
ORD005,2024-05-14 08:20,0,4,2024-05-14 08:40
ORD006,2024-05-14 09:00,1,1,2024-05-14 09:10
ORD007,2024-05-14 09:05,0,2,2024-05-14 09:20
ORD008,2024-05-14 09:10,0,1,2024-05-14 09:15
ORD009,2024-05-14 10:00,1,3,2024-05-14 10:30
ORD010,2024-05-14 10:05,0,4,2024-05-14 10:45`;

export default function App() {
  const [numStaff, setNumStaff] = useState(2);
  const [handoverOffset, setHandoverOffset] = useState(3);
  const [baselineStaff, setBaselineStaff] = useState(2);
  const [workingHours, setWorkingHours] = useState(4);
  const [simulationBasis, setSimulationBasis] = useState<string>('average');
  const [bypassedServiceTime, setBypassedServiceTime] = useState(6.2);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<string | null>(null);

  const [pageSize, setPageSize] = useState<number | 'all'>(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedChartDay, setSelectedChartDay] = useState<string>('all');
  const [obatFilter, setObatFilter] = useState<'all' | 'masuk' | 'keluar'>('all');
  const [metricDisplayType, setMetricDisplayType] = useState<'total' | 'average'>('average');
  const [customWorkingHours, setCustomWorkingHours] = useState<{[key: string]: number}>({});

  useEffect(() => {
    setCurrentPage(1);
    setSelectedChartDay('all');
    setSimulationBasis('average');
    setCustomWorkingHours({});
  }, [orders]);

  const dailyCalculatedTimes = useMemo(() => {
    if (orders.length === 0) return [];
    
    // Group orders by day
    const ordersByDay: { [key: string]: number } = {};
    orders.forEach(o => {
      const day = format(o.arrival, 'yyyy-MM-dd');
      ordersByDay[day] = (ordersByDay[day] || 0) + 1;
    });
    
    return Object.entries(ordersByDay).map(([day, count]) => {
      const hours = customWorkingHours[day] !== undefined ? customWorkingHours[day] : workingHours;
      // S * H * 60 / N
      const calculatedTime = (baselineStaff * hours * 60) / count;
      return {
        day,
        count,
        hours,
        calculatedTime: parseFloat(calculatedTime.toFixed(1))
      };
    }).sort((a, b) => a.day.localeCompare(b.day));
  }, [orders, baselineStaff, workingHours, customWorkingHours]);

  const averageCalculatedTime = useMemo(() => {
    if (dailyCalculatedTimes.length === 0) return 6.2;
    const sum = dailyCalculatedTimes.reduce((acc, curr) => acc + curr.calculatedTime, 0);
    return parseFloat((sum / dailyCalculatedTimes.length).toFixed(1));
  }, [dailyCalculatedTimes]);

  const selectedServiceTime = useMemo(() => {
    if (simulationBasis === 'custom') {
      return bypassedServiceTime;
    }
    if (simulationBasis === 'average') {
      return averageCalculatedTime;
    }
    if (simulationBasis.startsWith('day_')) {
      const dayStr = simulationBasis.replace('day_', '');
      const found = dailyCalculatedTimes.find(d => d.day === dayStr);
      return found ? found.calculatedTime : averageCalculatedTime;
    }
    return 6.2;
  }, [simulationBasis, bypassedServiceTime, averageCalculatedTime, dailyCalculatedTimes]);

  // ANALISIS SKENARIO INTERAKTIF (Configurable: numStaff, handoverOffset)
  const simulatedAnalysis = useMemo(() => {
    return analyzeWorkload(orders, numStaff, handoverOffset, baselineStaff, 'bypassed', selectedServiceTime);
  }, [orders, numStaff, handoverOffset, baselineStaff, selectedServiceTime]);

  const { reconstructed, metrics, dailyMetrics } = simulatedAnalysis;

  const chartHourlyData = useMemo(() => {
    if (selectedChartDay === 'all' || selectedChartDay === 'grid') {
      if (metricDisplayType === 'average') {
        return metrics.hourlyData;
      } else {
        const numDays = Math.max(1, dailyMetrics.length);
        return metrics.hourlyData.map(hData => ({
          ...hData,
          arrivals: Math.round(hData.arrivals * numDays),
          completions: Math.round(hData.completions * numDays),
        }));
      }
    }
    
    // Calculate for a specific day
    const dayOrders = reconstructed.filter(o => format(o.arrival, 'yyyy-MM-dd') === selectedChartDay);
    if (dayOrders.length === 0) return [];
    
    const ALL_HOURS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
    const hourMap: { [key: string]: { arrivals: number, completions: number, busy: number, leadTimeSum: number } } = {};
    ALL_HOURS.forEach(h => {
      hourMap[h] = { arrivals: 0, completions: 0, busy: 0, leadTimeSum: 0 };
    });
    
    dayOrders.forEach(o => {
      const hArr = format(o.arrival, 'HH:00');
      if (!hourMap[hArr]) {
        hourMap[hArr] = { arrivals: 0, completions: 0, busy: 0, leadTimeSum: 0 };
      }
      hourMap[hArr].arrivals++;
      hourMap[hArr].leadTimeSum += o.leadTime;
      
      const hComp = format(o.completion, 'HH:00');
      if (!hourMap[hComp]) {
        hourMap[hComp] = { arrivals: 0, completions: 0, busy: 0, leadTimeSum: 0 };
      }
      hourMap[hComp].completions++;
      
      hourMap[hArr].busy += o.serviceTime;
    });
    
    const hourlyData = Object.entries(hourMap).map(([hour, data]) => ({
      hour,
      arrivals: data.arrivals,
      completions: data.completions,
      occupancy: Math.min(1, data.busy / (numStaff * 60)),
      avgLeadTime: data.arrivals > 0 ? parseFloat((data.leadTimeSum / data.arrivals).toFixed(1)) : 0
    })).sort((a, b) => a.hour.localeCompare(b.hour));
    
    return hourlyData;
  }, [reconstructed, selectedChartDay, metrics.hourlyData, numStaff, metricDisplayType, dailyMetrics]);

  const dayColors = useMemo(() => [
    '#3b82f6', // Biru (Senin)
    '#ef4444', // Merah (Selasa)
    '#10b981', // Hijau (Rabu)
    '#8b5cf6', // Ungu (Kamis)
    '#06b6d4', // Cyan (Jumat)
    '#f59e0b', // Oren/Amber (Sabtu)
    '#ec4899', // Pink (Minggu)
  ], []);

  const groupedChartData = useMemo(() => {
    const ALL_HOURS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
    return ALL_HOURS.map(hour => {
      const dataPoint: any = { hour };
      dailyMetrics.forEach((dayData, idx) => {
        const foundHour = dayData.hourly?.find((h: any) => h.hour === hour);
        let val = 0;
        if (obatFilter === 'all' || obatFilter === 'masuk') {
          val = foundHour ? foundHour.orderCount : 0;
        } else if (obatFilter === 'keluar') {
          val = foundHour ? (foundHour.completions || 0) : 0;
        }
        dataPoint[`day_${idx}`] = val;
      });
      return dataPoint;
    });
  }, [dailyMetrics, obatFilter]);

  const daySelectAction = useMemo(() => {
    if (reconstructed.length === 0 || dailyMetrics.length === 0) return null;
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Hari:</span>
        <select
          value={selectedChartDay}
          onChange={(e) => setSelectedChartDay(e.target.value)}
          className={cn(
            "border rounded-lg px-2.5 py-1.5 font-bold outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer text-xs transition-all",
            selectedChartDay === 'grid' || selectedChartDay === 'grouped'
              ? "bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-100" 
              : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
          )}
        >
          <option value="all">Rata-rata Semua Hari</option>
          <option value="grouped">Grafik Gabungan (Perbandingan Hari 📊)</option>
          <option value="grid">Semua Hari Sekaligus (6 Grafik Terpisah)</option>
          {dailyMetrics.map((d: any) => (
            <option key={d.day} value={d.day}>
              {format(new Date(d.day), 'dd MMM yyyy')} ({d.orderCount} resep)
            </option>
          ))}
        </select>
      </div>
    );
  }, [reconstructed.length, dailyMetrics, selectedChartDay]);

  const workloadAction = useMemo(() => {
    if (reconstructed.length === 0 || dailyMetrics.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-3">
        {/* Toggle Filter Obat Masuk / Keluar */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setObatFilter('all')}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              obatFilter === 'all'
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            Semua
          </button>
          <button
            type="button"
            onClick={() => setObatFilter('masuk')}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer",
              obatFilter === 'masuk'
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Obat Masuk
          </button>
          <button
            type="button"
            onClick={() => setObatFilter('keluar')}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer",
              obatFilter === 'keluar'
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Obat Keluar
          </button>
        </div>

        {/* Pemisah Vertikal */}
        {selectedChartDay === 'all' && (
          <div className="hidden sm:block h-6 w-px bg-slate-200" />
        )}

        {/* Toggle Tipe Metrik: Akumulasi (Total) / Rata-rata */}
        {selectedChartDay === 'all' && (
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setMetricDisplayType('average')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
                metricDisplayType === 'average'
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Rata-rata
            </button>
            <button
              type="button"
              onClick={() => setMetricDisplayType('total')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
                metricDisplayType === 'total'
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Jumlah Total
            </button>
          </div>
        )}

        {/* Pemisah Vertikal */}
        <div className="hidden sm:block h-6 w-px bg-slate-200" />

        {/* Selector Hari */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Hari:</span>
          <select
            value={selectedChartDay}
            onChange={(e) => setSelectedChartDay(e.target.value)}
            className={cn(
              "border rounded-lg px-2.5 py-1.5 font-bold outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer text-xs transition-all",
              selectedChartDay === 'grid' || selectedChartDay === 'grouped'
                ? "bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-100" 
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
            )}
          >
            <option value="all" className="text-slate-750 font-medium">Rata-rata Semua Hari</option>
            <option value="grouped" className="text-indigo-650 font-bold">Grafik Gabungan (Perbandingan Hari 📊)</option>
            <option value="grid" className="text-slate-755 font-medium">Semua Hari Sekaligus (6 Grafik Terpisah)</option>
            {dailyMetrics.map((d: any) => (
              <option key={d.day} value={d.day} className="text-slate-750 font-medium">
                {format(new Date(d.day), 'dd MMM yyyy')} ({d.orderCount} resep)
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }, [reconstructed.length, dailyMetrics, selectedChartDay, obatFilter, metricDisplayType]);

  const totalPages = useMemo(() => {
    if (pageSize === 'all') return 1;
    return Math.ceil(reconstructed.length / pageSize);
  }, [reconstructed.length, pageSize]);

  const paginatedOrders = useMemo(() => {
    if (pageSize === 'all') return reconstructed;
    const startIndex = (currentPage - 1) * pageSize;
    return reconstructed.slice(startIndex, startIndex + pageSize);
  }, [reconstructed, currentPage, pageSize]);

  const leadTimeStats = useMemo(() => {
    if (reconstructed.length === 0) {
      return { 
        over20Count: 0, 
        underEqual20Count: 0, 
        over20Percent: 0, 
        underEqual20Percent: 0,
        racikCount: 0,
        nonRacikOnlyCount: 0,
        avgLeadTimeRacik: 0,
        avgLeadTimeNonRacik: 0
      };
    }

    let overCount = 0;
    let underEqualCount = 0;
    let racikCount = 0;
    let nonRacikOnlyCount = 0;
    let leadTimeRacikSum = 0;
    let leadTimeNonRacikSum = 0;

    reconstructed.forEach(o => {
      const isRacik = (o.obatRacik !== undefined && o.obatRacik > 0);
      const standardLimit = isRacik ? 30 : 20;

      if (o.leadTime > standardLimit) {
        overCount++;
      } else {
        underEqualCount++;
      }

      if (isRacik) {
        racikCount++;
        leadTimeRacikSum += o.leadTime;
      } else {
        nonRacikOnlyCount++;
        leadTimeNonRacikSum += o.leadTime;
      }
    });

    const overPercent = (overCount / reconstructed.length) * 100;
    const underEqualPercent = (underEqualCount / reconstructed.length) * 100;

    return { 
      over20Count: overCount, 
      underEqual20Count: underEqualCount, 
      over20Percent: overPercent, 
      underEqual20Percent: underEqualPercent,
      racikCount,
      nonRacikOnlyCount,
      avgLeadTimeRacik: racikCount > 0 ? leadTimeRacikSum / racikCount : 0,
      avgLeadTimeNonRacik: nonRacikOnlyCount > 0 ? leadTimeNonRacikSum / nonRacikOnlyCount : 0
    };
  }, [reconstructed]);

  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const parseDateString = (dateStr: string, referenceDate?: Date): Date => {
    const rawStr = dateStr.trim();
    if (!rawStr) return new Date();

    // Check if it's only time (e.g. "08.24.40", "08:24:40", "08.24", "08:24")
    const hasDateSeparators = rawStr.includes('/') || rawStr.includes('-');
    const isOnlyTime = !hasDateSeparators && (
      !rawStr.includes(' ') && (
        rawStr.includes(':') || 
        (rawStr.includes('.') && !rawStr.endsWith('26') && !rawStr.endsWith('2026'))
      )
    );

    if (isOnlyTime) {
      if (!referenceDate) return new Date();
      const datePartStr = format(referenceDate, 'yyyy-MM-dd');
      const cleanTime = rawStr.replace(/\./g, ':');
      const timeParts = cleanTime.split(':');
      const h = timeParts[0].padStart(2, '0');
      const min = (timeParts[1] || '00').padStart(2, '0');
      const s = (timeParts[2] || '00').padStart(2, '0');
      const fullTime = `${h}:${min}:${s}`;
      return new Date(`${datePartStr}T${fullTime}`);
    }

    const parts = rawStr.split(/\s+/);
    const datePartStr = parts[0];
    const timePartStr = parts[1] || '00:00:00';

    let m = '';
    let d = '';
    let y = '2026';

    const dateComponents = datePartStr.split(/[\/\-\.]/);

    if (dateComponents.length === 3) {
      if (dateComponents[0].length === 4) {
        y = dateComponents[0];
        m = dateComponents[1].padStart(2, '0');
        d = dateComponents[2].padStart(2, '0');
      } else {
        // dd/MM/yyyy or d/M/yyyy format as specified by the user
        d = dateComponents[0].padStart(2, '0');
        m = dateComponents[1].padStart(2, '0');
        const yearPart = dateComponents[2];
        y = yearPart.length === 2 ? `20${yearPart}` : yearPart;
      }
    } else {
      const fallbackDate = new Date(rawStr.replace(/\./g, ':'));
      if (!isNaN(fallbackDate.getTime())) {
        return fallbackDate;
      }
      return new Date();
    }

    const cleanTimeStr = timePartStr.replace(/\./g, ':');
    const timeComponents = cleanTimeStr.split(':');
    const h = timeComponents[0].padStart(2, '0');
    const min = (timeComponents[1] || '00').padStart(2, '0');
    const s = (timeComponents[2] || '00').padStart(2, '0');
    const fullTimeStr = `${h}:${min}:${s}`;

    const isoString = `${y}-${m}-${d}T${fullTimeStr}`;
    const parsedDate = new Date(isoString);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }

    const finalFallback = new Date(rawStr);
    return isNaN(finalFallback.getTime()) ? new Date() : finalFallback;
  };

  const processText = (text: string) => {
    if (!text.trim()) return;
    setLoading(true);
    setInsights(null);
    
    // Detect delimiter
    const lines = text.trim().split('\n');
    const firstLine = lines[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';

    Papa.parse(text.trim(), {
      header: true,
      skipEmptyLines: true,
      delimiter: delimiter,
      complete: (results) => {
        const parsedOrders = (results.data as any[]).map((row, idx): Order | null => {
          const keys = Object.keys(row);
          if (keys.length < 3) return null;

          // Find keys dynamically by name patterns
          const idKey = keys.find(k => k.toLowerCase().includes('id')) || keys[0];
          const arrivalKey = keys.find(k => k.toLowerCase().includes('masuk') || k.toLowerCase().includes('arrival') || k.toLowerCase().includes('datang')) || keys[1];
          
          let completionKey = keys.find(k => k.toLowerCase().includes('selesai') || k.toLowerCase().includes('completion'));
          if (!completionKey) {
            if (keys.length === 3) {
              completionKey = keys[2];
            } else if (keys.length >= 5) {
              // Try the last column (e.g. "waktu selesai" at index 4)
              completionKey = keys[4] || keys[keys.length - 1];
            } else {
              completionKey = keys[2];
            }
          }

          const obatRacikKey = keys.find(k => {
            const l = k.toLowerCase();
            return l.includes('obat racik') || (l.includes('racik') && !l.includes('non'));
          });
          const obatNonRacikKey = keys.find(k => {
            const l = k.toLowerCase();
            return l.includes('non') && l.includes('racik');
          });

          const idVal = row[idKey] || `ORD-${idx}`;
          const arrivalStr = (row[arrivalKey] || '').toString();
          const completionStr = (row[completionKey] || '').toString();

          let obatRacik: number | undefined = undefined;
          if (obatRacikKey) {
            const val = parseInt(row[obatRacikKey], 10);
            if (!isNaN(val)) obatRacik = val;
          }

          let obatNonRacik: number | undefined = undefined;
          if (obatNonRacikKey) {
            const val = parseInt(row[obatNonRacikKey], 10);
            if (!isNaN(val)) obatNonRacik = val;
          }

          try {
            const arrival = parseDateString(arrivalStr);
            if (isNaN(arrival.getTime())) return null;

            const completion = parseDateString(completionStr, arrival);
            if (isNaN(completion.getTime())) return null;

            return { id: idVal, arrival, completion, obatRacik, obatNonRacik };
          } catch (e) {
            console.error("Parse error for row", idx, e);
            return null;
          }
        }).filter((o): o is Order => o !== null);
        
        if (parsedOrders.length > 0) {
          setOrders(parsedOrders);
          setPasteMode(false);
          setPastedText('');
        } else {
          setInsights("Gagal memproses data. Pastikan format kolom benar (ID; Waktu Masuk; Waktu Selesai).");
        }
        setLoading(false);
      },
      error: (err) => {
        console.error("CSV Parse Error:", err);
        setInsights("Error membaca file: " + err.message);
        setLoading(false);
      }
    });
  };
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      processText(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const loadSample = () => {
    processText(DEFAULT_SAMPLE_DATA);
  };

  const getAIInsights = async () => {
    if (orders.length === 0) return;
    setInsights("Menganalisis data...");
    try {
      const genAI = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY || '',
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
      
      const prompt = `Sebagai konsultan manajemen farmasi, analisislah data performa puskesmas berikut:
      - Total Order: ${metrics.totalOrders}
      - Rata-rata Lead Time (Waktu Tunggu + Pelayanan): ${metrics.avgLeadTime.toFixed(1)} menit
      - Rata-rata Waktu Tunggu: ${metrics.avgWaitTime.toFixed(1)} menit
      - Rata-rata Waktu Layanan: ${metrics.avgServiceTime.toFixed(1)} menit
      - Tingkat Utilisasi Staf (${numStaff} orang): ${(metrics.utilizationRate * 100).toFixed(1)}%
      - Jam Sibuk: ${metrics.peakHour}

      Berikan 3 poin saran praktis dalam Bahasa Indonesia untuk meningkatkan efisiensi atau kenyamanan pasien.`;

      const result = await genAI.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });
      setInsights(result.text || "Gagal membuat rekomendasi.");
    } catch (err) {
      setInsights("Gagal mendapatkan rekomendasi AI. Pastikan API key dikonfigurasi.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight hidden sm:block">PharmLoad</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setPasteMode(true)}
              className="text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors"
            >
              Tempel Data
            </button>
            <button 
              onClick={loadSample}
              className="text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors"
            >
              Data Contoh
            </button>
            <div className="flex items-center rounded-full px-3 py-1 gap-2 transition-all border bg-slate-100 border-transparent" title="Waktu penyerahan obat & edukasi">
              <Clock className="w-4 h-4 text-slate-500" />
              <input 
                type="number" 
                value={handoverOffset}
                min={0}
                max={30}
                onChange={(e) => setHandoverOffset(Number(e.target.value))}
                className="bg-transparent w-8 text-center font-bold focus:outline-none"
              />
              <span className="text-xs text-slate-500 uppercase font-semibold">Penyerahan</span>
            </div>
            
            <div className="flex items-center rounded-full px-3 py-1 gap-2 transition-all border bg-slate-100 border-transparent" title="Jumlah petugas aktif">
              <Users className="w-4 h-4 text-slate-500" />
              <input 
                type="number" 
                value={numStaff}
                min={1}
                onChange={(e) => setNumStaff(Number(e.target.value))}
                className="bg-transparent w-10 text-center font-bold focus:outline-none"
              />
              <span className="text-xs text-slate-500 uppercase font-semibold">Petugas</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Paste Mode Modal/Area */}
        {pasteMode && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl">
              <h2 className="text-xl font-bold mb-4">Tempel Data CSV</h2>
              <p className="text-xs text-slate-500 mb-3 bg-blue-50 p-2 rounded border border-blue-100">
                Data harus diawali dengan baris judul (ID, Waktu Masuk, Selesai). <br/>
                Format waktu didukung: <code>08.11</code> atau <code>08:11:00</code>.
              </p>
              <textarea 
                className="w-full h-64 p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm mb-4 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="No. Antrean;waktu masuk;Waktu obat diserahkan&#10;1;05/04/26 08.11;08.24.40"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setPasteMode(false)}
                  className="px-6 py-2 text-slate-500 font-medium hover:text-slate-700"
                >
                  Batal
                </button>
                <button 
                  onClick={() => processText(pastedText)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                >
                  Analis Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dash Section */}
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 bg-white rounded-2xl border-2 border-dashed border-slate-200 text-center">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-6">
              <Upload className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Unggah Data Layanan</h2>
            <p className="text-slate-500 max-w-md mb-8">
              Unggah file CSV atau klik "Tempel Data" untuk menyalin teks dari chat.
            </p>
            <div className="flex gap-4">
              <label className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all cursor-pointer shadow-lg shadow-blue-200">
                Pilih File CSV
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
              <button 
                onClick={() => setPasteMode(true)}
                className="bg-white text-slate-705 border border-slate-200 px-8 py-3 rounded-xl font-bold hover:bg-slate-50 transition-all cursor-pointer"
              >
                Tempel Teks
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard 
                label="Total Order" 
                value={metrics.totalOrders} 
                icon={<ClipboardList className="w-5 h-5" />}
                color="blue"
              />
              <StatCard 
                label="Rata-rata Lead Time" 
                value={`${metrics.avgLeadTime.toFixed(1)} m`} 
                icon={<Clock className="w-5 h-5" />}
                color="violet"
                subtitle="Masuk s.d. diserahkan"
              />
              <StatCard 
                label="Rata-rata Waktu Tunggu" 
                value={`${metrics.avgWaitTime.toFixed(1)} m`} 
                icon={<Clock className="w-5 h-5" />}
                color="amber"
                subtitle="Estimasi antrean"
              />
              <StatCard 
                label="Utilisasi Staf" 
                value={`${(metrics.utilizationRate * 100).toFixed(0)}%`} 
                icon={<TrendingUp className="w-5 h-5" />}
                color={
                  metrics.utilizationRate < 0.70 ? 'blue' :
                  metrics.utilizationRate <= 0.75 ? 'emerald' :
                  metrics.utilizationRate <= 0.85 ? 'amber' : 'violet'
                }
                subtitle={`${numStaff} petugas (${
                  metrics.utilizationRate < 0.70 ? 'Senggang' :
                  metrics.utilizationRate <= 0.75 ? 'Optimal' :
                  metrics.utilizationRate <= 0.85 ? 'Sibuk' : 'Sangat Sibuk'
                })`}
              />
              <StatCard 
                label="Jam Kesibukan" 
                value={metrics.peakHour} 
                icon={<Users className="w-5 h-5" />}
                color="indigo"
              />
            </div>

            {/* Panel Kalibrasi & Simulasi Dua Tahap */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-2xl p-6 text-white border border-slate-800 shadow-xl space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="bg-indigo-500/25 text-indigo-300 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                      Simulasi Antrean 2-Tahap (FIFO)
                    </span>
                  </div>
                  <h2 className="text-xl font-bold tracking-tight">Pengendalian & Proyeksi Kapasitas Terkalibrasi</h2>
                  <p className="text-xs text-slate-400">
                    Sistem memetakan kapasitas pelayanan murni (Stage 1) dan menggunakan pilihan tersebut untuk memproyeksikan performa di bawah konfigurasi staf baru (Stage 2).
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setBaselineStaff(2);
                      setWorkingHours(4);
                      setNumStaff(2);
                      setHandoverOffset(3);
                      setSimulationBasis('average');
                      setBypassedServiceTime(6.2);
                    }}
                    className="text-xs font-semibold text-slate-300 hover:text-white underline transition"
                  >
                    Reset Kalibrasi
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* TAHAP 1 */}
                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500 text-slate-900 font-bold text-xs flex items-center justify-center">1</span>
                    <h3 className="font-bold text-sm text-indigo-200">Tahap 1: Profiling Kapasitas Harian</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-normal">
                    Menghitung kapasitas pengerjaan resep harian murni berdasarkan jumlah resep riil ($N$), asumsi jam kerja aktif, dan jumlah staf petugas baseline.
                  </p>

                  <div className="space-y-4 pt-1">
                    {/* Input: Baseline Staf */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">
                          Staf Baseline ($S$)
                        </label>
                        <span className="text-[10px] font-bold text-indigo-300 font-mono">{baselineStaff} Staf</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        value={baselineStaff}
                        onChange={(e) => setBaselineStaff(Number(e.target.value))}
                        className="w-full accent-indigo-400 cursor-pointer h-1"
                      />
                    </div>

                    {/* Input: Jam Kerja */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">
                          Jam Kerja Aktif / Hari ($H$)
                        </label>
                        <span className="text-[10px] font-bold text-indigo-300 font-mono">{workingHours} Jam</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={12}
                        value={workingHours}
                        onChange={(e) => setWorkingHours(Number(e.target.value))}
                        className="w-full accent-indigo-400 cursor-pointer h-1"
                      />
                    </div>

                    {/* Formula Info */}
                    <div className="p-2 bg-indigo-950/40 rounded border border-indigo-500/20 text-center">
                      <p className="text-[10px] text-indigo-300 font-mono">
                        Estimasi = (Staf &times; Jam &times; 60) / Resep
                      </p>
                    </div>

                    {/* Daily Calculated Service Times */}
                    <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Hasil Estimasi & Jam Operasional per Hari:
                      </p>
                      {dailyCalculatedTimes.length === 0 ? (
                        <p className="text-[10px] text-slate-500 italic">Belum ada data diunggah.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {dailyCalculatedTimes.map((d) => (
                            <div key={d.day} className="p-2.5 py-2 bg-slate-900/50 rounded-lg border border-white/10 text-[11px] font-mono hover:border-indigo-500/40 transition-all flex items-center justify-between gap-2 focus-within:border-indigo-500/50">
                              {/* Date & Resep Count */}
                              <div className="flex flex-col min-w-[70px]">
                                <span className="text-indigo-100 font-extrabold text-[12px]">{format(new Date(d.day), 'dd MMM')}</span>
                                <span className="text-[10px] text-slate-300 font-bold">({d.count} resep)</span>
                              </div>
                              
                              {/* Jam Kerja Input */}
                              <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 px-2 rounded-md border border-white/15">
                                <span className="text-[11px] text-white font-bold" title="Jam Operasional">⏱️</span>
                                <input 
                                  type="number" 
                                  step="0.5" 
                                  min="0.5" 
                                  max="24"
                                  value={d.hours}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val) && val > 0) {
                                      setCustomWorkingHours(prev => ({ ...prev, [d.day]: val }));
                                    }
                                  }}
                                  className="w-[68px] bg-slate-900 border border-white/20 rounded px-1 py-0.5 text-center text-white font-extrabold focus:outline-none focus:ring-1 focus:ring-indigo-400 text-[11px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-slate-100 font-extrabold text-[10px]">Jam</span>
                                {customWorkingHours[d.day] !== undefined && (
                                  <button 
                                    onClick={() => {
                                      const copy = { ...customWorkingHours };
                                      delete copy[d.day];
                                      setCustomWorkingHours(copy);
                                    }}
                                    className="text-red-100 hover:text-white text-[9px] font-extrabold cursor-pointer bg-red-650/40 hover:bg-red-650 px-1.5 py-0.5 rounded ml-1 border border-red-500/30 transition-colors"
                                    title="Reset ke default"
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>

                              {/* Hasil Estimasi */}
                              <div className="text-right min-w-[60px]">
                                <span className="font-extrabold text-yellow-300 p-1 px-2 rounded bg-yellow-500/15 border border-yellow-400/30 text-[11px] block transition-all">
                                  {d.calculatedTime.toFixed(1)} m
                                </span>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-between items-center p-2.5 bg-indigo-500/20 rounded-lg border border-indigo-500/40 text-[11px] font-mono">
                            <span className="text-white font-black uppercase tracking-wider">Rerata Semua Hari</span>
                            <span className="text-yellow-300 font-extrabold text-[12px] bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-400/20">{averageCalculatedTime.toFixed(1)} m</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* TAHAP 2 */}
                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-900 font-bold text-xs flex items-center justify-center">2</span>
                    <h3 className="font-bold text-sm text-emerald-200">Tahap 2: Simulasi & Proyeksi Staf Baru</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-normal">
                    Simulasikan berapapun jumlah petugas aktif di lapangan untuk melihat perbandingan antrean resep yang dinamis (FIFO).
                  </p>

                  <div className="space-y-4 pt-1">
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">
                          Petugas Aktif yang Diuji
                        </label>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase">
                          Mempengaruhi Antrean
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1}
                          max={10}
                          value={numStaff}
                          onChange={(e) => setNumStaff(Number(e.target.value))}
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                        <span className="text-sm font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded font-mono w-16 text-center shrink-0">
                          {numStaff} Staf
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="p-2.5 bg-white/5 rounded-lg border border-white/5 flex justify-between items-center text-xs">
                        <span className="text-slate-450 font-bold uppercase text-[9px]">Basis Waktu Layanan</span>
                        <span className="font-bold text-yellow-300 font-mono">
                          {selectedServiceTime.toFixed(1)} m / resep
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 bg-white/5 rounded-lg border border-white/5">
                          <span className="text-[9px] text-slate-400 block uppercase font-bold">Rerata Waktu Tunggu</span>
                          <span className={`text-base font-bold font-mono ${metrics.avgWaitTime > 15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {metrics.avgWaitTime.toFixed(1)} m
                          </span>
                        </div>
                        <div className="p-2.5 bg-white/5 rounded-lg border border-white/5">
                          <span className="text-[9px] text-slate-400 block uppercase font-bold">Rerata Leadtime (Total)</span>
                          <span className="text-base font-bold text-violet-300 font-mono">
                            {metrics.avgLeadTime.toFixed(1)} m
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BASIS WAKTU LAYANAN & PARAMETER */}
                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500 text-slate-900 font-bold text-xs flex items-center justify-center">⚙️</span>
                    <h3 className="font-bold text-sm text-indigo-200">Basis Layanan & Parameter Tambahan</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-normal">
                    Atur dasar perhitungan waktu layanan penyiapan obat serta faktor penyerahan (KIE).
                  </p>

                  <div className="space-y-4 pt-1">
                    {/* Basis Selection Dropdown */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-bold block mb-1.5 uppercase">
                        Skenario Basis Waktu Layanan
                      </label>
                      <select
                        value={simulationBasis}
                        onChange={(e) => setSimulationBasis(e.target.value)}
                        className="w-full bg-slate-950 border border-white/15 rounded-lg py-1.5 px-2 text-xs font-bold text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                      >
                        <option value="average">Rata-rata Semua Hari ({averageCalculatedTime.toFixed(1)} m)</option>
                        {dailyCalculatedTimes.map((d) => (
                          <option key={d.day} value={`day_${d.day}`}>
                            Hari {format(new Date(d.day), 'dd/MM')} (N={d.count}) — {d.calculatedTime.toFixed(1)} m
                          </option>
                        ))}
                        <option value="custom">Input Nilai Kustom (Manual)</option>
                      </select>
                    </div>

                    {/* Custom Input: Only visible if simulationBasis === 'custom' */}
                    {simulationBasis === 'custom' && (
                      <div className="p-2.5 bg-white/5 rounded-lg border border-white/5 space-y-1.5">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-400 font-bold uppercase">Estimasi Waktu Layanan</span>
                          <span className="text-[10px] font-bold text-yellow-300 font-mono">{bypassedServiceTime} menit</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={1}
                            max={30}
                            step={0.1}
                            value={bypassedServiceTime}
                            onChange={(e) => setBypassedServiceTime(Number(e.target.value))}
                            className="w-full accent-indigo-400 cursor-pointer h-1"
                          />
                          <input
                            type="number"
                            min={1}
                            max={60}
                            step={0.1}
                            value={bypassedServiceTime}
                            onChange={(e) => setBypassedServiceTime(Number(e.target.value))}
                            className="bg-slate-950 border border-white/15 rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono w-12 text-center"
                          />
                        </div>
                      </div>
                    )}

                    {/* Offset handover */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">
                          Offset Penyerahan & KIE
                        </label>
                        <span className="text-[9px] font-bold text-indigo-400 font-mono">{handoverOffset} Menit</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={35}
                          value={handoverOffset}
                          onChange={(e) => setHandoverOffset(Number(e.target.value))}
                          className="bg-slate-950 border border-white/10 rounded-lg py-1 px-3 text-xs font-bold text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-16 text-center"
                        />
                        <span className="text-[10px] text-slate-400 leading-snug">
                          menit penyerahan, merapikan bungkus & edukasi obat.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Distribusi Lead Time Pasien */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              <div className="md:col-span-7 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
                  <h3 className="font-bold text-lg text-slate-800">Distribusi Lead Time Pasien</h3>
                </div>
                <p className="text-sm text-slate-700 font-medium leading-relaxed">
                  Analisis ketepatan waktu pelayanan resep berdasarkan standar dinamis: <span className="font-extrabold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 text-[11px] whitespace-nowrap">30 Menit untuk Obat Racik</span> dan <span className="font-extrabold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 text-[11px] whitespace-nowrap">20 Menit untuk Non-Racik</span>.
                </p>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-xs text-slate-600 font-bold block mb-0.5">MELEBIHI STANDAR LAYANAN</span>
                    <span className="text-xl font-extrabold text-red-650">{leadTimeStats.over20Percent.toFixed(1)}%</span>
                    <span className="text-xs text-slate-700 font-medium block mt-1">{leadTimeStats.over20Count} pasien</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-xs text-slate-600 font-bold block mb-0.5">SESUAI STANDAR LAYANAN</span>
                    <span className="text-xl font-extrabold text-emerald-605 text-emerald-600">{leadTimeStats.underEqual20Percent.toFixed(1)}%</span>
                    <span className="text-xs text-slate-700 font-medium block mt-1">{leadTimeStats.underEqual20Count} pasien</span>
                  </div>
                </div>

                {leadTimeStats.racikCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-col gap-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Analisis Resep Berdasarkan Jenis</span>
                    <div className="flex flex-wrap gap-2 text-[11px] font-medium text-slate-600">
                      <span className="bg-rose-50/80 border border-rose-200/50 px-2 py-1 rounded text-rose-700 flex items-center gap-1">
                        🧪 <strong>{leadTimeStats.racikCount}</strong> Resep Racik (Rerata: <strong>{leadTimeStats.avgLeadTimeRacik.toFixed(1)}m</strong> / std: 30m)
                      </span>
                      <span className="bg-blue-50/80 border border-blue-200/50 px-2 py-1 rounded text-blue-700 flex items-center gap-1">
                        💊 <strong>{leadTimeStats.nonRacikOnlyCount}</strong> Non-Racik (Rerata: <strong>{leadTimeStats.avgLeadTimeNonRacik.toFixed(1)}m</strong> / std: 20m)
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-5 bg-slate-50 p-5 rounded-2xl border border-slate-100 flex flex-col justify-center gap-3">
                <div className="flex justify-between items-center text-xs font-bold text-slate-700 tracking-wide border-b border-slate-200/60 pb-2">
                  <span>SEGMEN DISTRIBUSI LAYANAN</span>
                  <span className="bg-slate-200 px-2 py-0.5 rounded text-slate-800">{reconstructed.length} Pasien</span>
                </div>

                {/* Donut Chart Container */}
                <div className="relative h-[160px] w-full flex items-center justify-center my-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={reconstructed.length > 0 ? [
                          { name: 'Melebihi Standar', value: leadTimeStats.over20Count, color: '#f43f5e' },
                          { name: 'Sesuai Standar', value: leadTimeStats.underEqual20Count, color: '#10b981' }
                        ] : [
                          { name: 'Belum Ada Data', value: 1, color: '#cbd5e1' }
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={41}
                        outerRadius={58}
                        paddingAngle={reconstructed.length > 0 ? 4 : 0}
                        dataKey="value"
                        label={reconstructed.length > 0 ? ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
                          const RADIAN = Math.PI / 180;
                          const radius = outerRadius + 12;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                          const color = index === 0 ? '#e11d48' : '#059669'; // Rose-600 or Emerald-600

                          return (
                            <text
                              x={x}
                              y={y}
                              fill={color}
                              textAnchor={x > cx ? 'start' : 'end'}
                              dominantBaseline="central"
                              className="text-[10px] font-extrabold font-mono"
                            >
                              {`${(percent * 100).toFixed(1)}%`}
                            </text>
                          );
                        } : undefined}
                      >
                        {reconstructed.length > 0 ? (
                          <>
                            <Cell fill="#f43f5e" />
                            <Cell fill="#10b981" />
                          </>
                        ) : (
                          <Cell fill="#e2e8f0" />
                        )}
                      </Pie>
                      {reconstructed.length > 0 && (
                        <Tooltip 
                          formatter={(value: any, name: string) => [`${value} pasien`, name]}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '11px' }}
                        />
                      )}
                    </PieChart>
                  </ResponsiveContainer>
                  
                  {/* Central Text inside Donut */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xl font-extrabold text-slate-800 leading-none">{reconstructed.length}</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-1">Total Pasien</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs border-t border-slate-200/60 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-bold text-slate-700">
                      <span className="w-3.5 h-3.5 rounded bg-rose-50 block border border-rose-600/10" style={{ backgroundColor: '#f43f5e' }} /> 
                      Melebihi Standar (&gt;30m Racik / &gt;20m Non-Racik)
                    </span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-slate-500">({leadTimeStats.over20Count})</span>
                      <span className="font-extrabold text-red-650 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/15">{leadTimeStats.over20Percent.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-bold text-slate-700">
                      <span className="w-3.5 h-3.5 rounded bg-emerald-50 block border border-emerald-600/10" style={{ backgroundColor: '#10b981' }} /> 
                      Sesuai Standar (≤30m Racik / ≤20m Non-Racik)
                    </span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-slate-500">({leadTimeStats.underEqual20Count})</span>
                      <span className="font-extrabold text-emerald-700 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/15">{leadTimeStats.underEqual20Percent.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Charts */}
              <div className="lg:col-span-2 space-y-6">
                <Card 
                  title="Peta Panas Utilisasi (Heatmap)" 
                  subtitle="Intensitas pelayanan setiap jam dari hari ke hari"
                >
                  <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden shadow-inner">
                    <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100">
                      <div className="p-3 text-[10px] font-bold text-slate-700 border-r border-slate-200 uppercase">Tgl</div>
                      {['07', '08', '09', '10', '11', '12'].map(h => (
                        <div key={h} className="p-3 text-[10px] font-extrabold text-slate-700 text-center uppercase tracking-tighter">
                          {h}:00
                        </div>
                      ))}
                    </div>
                    {dailyMetrics.map((d, dayIdx) => (
                      <div key={d.day} className="grid grid-cols-7 border-b border-slate-150 last:border-0 hover:bg-slate-50/50">
                        <div className="p-3 text-[10px] font-bold text-slate-700 border-r border-slate-200 bg-white truncate">
                          {format(new Date(d.day), 'dd/MM')}
                        </div>
                        {d.hourly.map((h: any) => {
                          const intensity = Math.round(h.occupancy * 10) * 10;
                          const colorClass = h.occupancy === 0 ? 'bg-transparent text-slate-400' : 
                                           h.occupancy < 0.4 ? 'bg-slate-50 text-slate-500 font-medium' :
                                           h.occupancy < 0.70 ? 'bg-slate-100 text-slate-750 font-bold' :
                                           h.occupancy <= 0.75 ? 'bg-emerald-100 text-emerald-950 font-extrabold border border-emerald-300/60' :
                                           h.occupancy <= 0.85 ? 'bg-amber-100 text-amber-950 font-extrabold border border-amber-300/60' : 
                                           'bg-rose-500 text-white font-black';
                          
                          return (
                            <div 
                              key={h.hour} 
                              className={cn("p-3 text-[10px] flex items-center justify-center font-mono transition-all", colorClass)}
                              title={`${h.hour}: ${(h.occupancy * 100).toFixed(1)}%`}
                            >
                              {h.occupancy > 0 ? `${(h.occupancy * 100).toFixed(0)}%` : '-'}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest">Keterangan Status Utilisasi:</span>
                    <div className="flex gap-4 items-center flex-wrap">
                      <div className="flex items-center gap-1.5">
                         <div className="w-3.5 h-3.5 bg-slate-100 rounded border border-slate-300" /> 
                         <span className="text-[10px] font-bold text-slate-650">&lt; 70% (Senggang)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                         <div className="w-3.5 h-3.5 bg-emerald-100 rounded border border-emerald-300" /> 
                         <span className="text-[10px] font-bold text-emerald-700 font-bold">70% - 75% (Optimal)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                         <div className="w-3.5 h-3.5 bg-amber-100 rounded border border-amber-300" /> 
                         <span className="text-[10px] font-bold text-amber-700 font-bold">&gt; 75% - 85% (Sibuk)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                         <div className="w-3.5 h-3.5 bg-rose-500 rounded" /> 
                         <span className="text-[10px] font-bold text-rose-700">&gt; 85% (Sangat Sibuk)</span>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card 
                  title={
                    selectedChartDay === 'all' 
                      ? `Distribusi Beban Kerja per Jam (${metricDisplayType === 'average' ? 'Rata-rata' : 'Total Akumulasi'})` 
                      : selectedChartDay === 'grid'
                      ? "Detail Distribusi Beban Kerja Harian (6 Hari)"
                      : selectedChartDay === 'grouped'
                      ? `Grafik Hubungan Kunjungan Harian ${obatFilter === 'keluar' ? 'Selesai' : 'Masuk'} per Jam`
                      : "Distribusi Beban Kerja per Jam"
                  } 
                  subtitle={
                    selectedChartDay === 'all' 
                      ? `Volume kedatangan vs penyelesaian ${metricDisplayType === 'average' ? 'rata-rata harian' : 'total akumulasi seluruh hari'}` 
                      : selectedChartDay === 'grid'
                      ? "Visualisasi beban kerja per jam untuk masing-masing hari secara langsung"
                      : selectedChartDay === 'grouped'
                      ? `Perbandingan volume ${obatFilter === 'keluar' ? 'resep selesai' : 'kunjungan masuk'} antar hari untuk melihat tren puncak pelayanan`
                      : `Volume kedatangan vs penyelesaian tanggal ${format(new Date(selectedChartDay), 'dd MMM yyyy')}`
                  }
                  action={workloadAction}
                >
                  {selectedChartDay === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
                      {dailyMetrics.map((d: any) => {
                        const dayLabel = getIndonesianDateString(d.day);
                        const chartData = d.hourly.map((h: any) => ({
                          hour: h.hour,
                          arrivals: h.orderCount,
                          completions: h.completions || 0
                        }));
                        return (
                          <div key={d.day} className="bg-slate-50/70 p-4 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-white hover:shadow-md transition-all flex flex-col justify-between">
                            <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-100">
                              <h4 className="text-xs font-bold text-slate-800">{dayLabel}</h4>
                              <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full">
                                {d.orderCount} resep
                              </span>
                            </div>
                            <div className="h-44 w-full pt-2">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 15, right: 3, left: -25, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                  <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#64748b'}} />
                                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#64748b'}} />
                                  <Tooltip 
                                    contentStyle={{ borderRadius: '8px', border: 'none', fontSize: '10px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                  />
                                  {(obatFilter === 'all' || obatFilter === 'masuk') && (
                                    <Bar name="Masuk" dataKey="arrivals" fill="#3b82f6" radius={[2, 2, 0, 0]}>
                                      <LabelList dataKey="arrivals" position="top" style={{ fontSize: 8, fill: '#3b82f6', fontWeight: 600 }} offset={4} formatter={(val: number) => val || ''} />
                                    </Bar>
                                  )}
                                  {(obatFilter === 'all' || obatFilter === 'keluar') && (
                                    <Bar name="Selesai" dataKey="completions" fill="#94a3b8" radius={[2, 2, 0, 0]}>
                                      <LabelList dataKey="completions" position="top" style={{ fontSize: 8, fill: '#64748b', fontWeight: 600 }} offset={4} formatter={(val: number) => val || ''} />
                                    </Bar>
                                  )}
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : selectedChartDay === 'grouped' ? (
                    <div className="h-96 w-full pt-4 flex flex-col justify-between">
                      <div className="flex-1 w-full h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={groupedChartData} margin={{ top: 20, right: 10, left: 10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                              dataKey="hour" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 11, fill: '#64748b' }} 
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fontSize: 11, fill: '#64748b' }} 
                            />
                            <Tooltip 
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                              formatter={(value: any, name: any) => {
                                const dayIdx = parseInt(name.replace('day_', ''), 10);
                                const dayData = dailyMetrics[dayIdx];
                                const label = dayData ? `${getDayNameOnly(dayData.day)} (${format(new Date(dayData.day), 'dd/MM')})` : name;
                                return [value, label];
                              }}
                            />
                            <Legend 
                              iconType="circle" 
                              verticalAlign="bottom"
                              height={36}
                              formatter={(value: any) => {
                                const dayIdx = parseInt(value?.toString().replace('day_', '') || '0', 10);
                                const dayData = dailyMetrics[dayIdx];
                                return dayData ? `${getDayNameOnly(dayData.day)} (${format(new Date(dayData.day), 'dd/MM')})` : value;
                              }}
                            />
                            {dailyMetrics.map((d: any, idx: number) => {
                              const barColor = dayColors[idx % dayColors.length];
                              return (
                                <Bar 
                                  key={d.day} 
                                  name={`day_${idx}`} 
                                  dataKey={`day_${idx}`} 
                                  fill={barColor} 
                                  radius={[3, 3, 0, 0]}
                                >
                                  <LabelList 
                                    dataKey={`day_${idx}`} 
                                    position="top" 
                                    style={{ fontSize: 9, fill: barColor, fontWeight: 600 }} 
                                    offset={6} 
                                    formatter={(val: number) => val || ''} 
                                  />
                                </Bar>
                              );
                            })}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium text-center mt-2 bg-slate-50 py-1.5 rounded-lg border border-slate-100">
                        * Grafik ini mengelompokkan data per jam dengan membandingkan semua hari secara berdampingan (Excel-Style) untuk memudahkan pemantauan tren beban puncak.
                      </div>
                    </div>
                  ) : (
                    <div className="h-80 w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartHourlyData} margin={{ top: 15, right: 5, left: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          />
                          <Legend iconType="circle" />
                          {(obatFilter === 'all' || obatFilter === 'masuk') && (
                            <Bar name="Masuk" dataKey="arrivals" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                              <LabelList dataKey="arrivals" position="top" style={{ fontSize: 10, fill: '#3b82f6', fontWeight: 600 }} offset={6} formatter={(val: number) => val || ''} />
                            </Bar>
                          )}
                          {(obatFilter === 'all' || obatFilter === 'keluar') && (
                            <Bar name="Selesai" dataKey="completions" fill="#94a3b8" radius={[4, 4, 0, 0]}>
                              <LabelList dataKey="completions" position="top" style={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} offset={6} formatter={(val: number) => val || ''} />
                            </Bar>
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>

                <Card 
                  title={(selectedChartDay === 'all' || selectedChartDay === 'grid' || selectedChartDay === 'grouped') ? "Grafik Utilisasi & Okupansi (Rata-rata)" : "Grafik Okupansi"} 
                  subtitle={(selectedChartDay === 'all' || selectedChartDay === 'grid' || selectedChartDay === 'grouped') ? "Intensitas staf rata-rata harian mengerjakan order" : `Intensitas staf harian tanggal ${format(new Date(selectedChartDay), 'dd MMM yyyy')}`}
                  action={daySelectAction}
                >
                  <div className="h-64 w-full pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartHourlyData} margin={{ top: 20, right: 25, left: 25, bottom: 5 }}>
                        <defs>
                          <linearGradient id="colorOcc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} padding={{ left: 20, right: 20 }} />
                        <YAxis hide domain={[0, 1.1]} />
                        <Tooltip 
                          formatter={(val: number) => [`${(val * 100).toFixed(1)}%`, 'Okupansi']}
                        />
                        <Area type="monotone" dataKey="occupancy" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorOcc)">
                          <LabelList dataKey="occupancy" position="top" style={{ fontSize: 10, fill: '#10b981', fontWeight: 600 }} offset={6} formatter={(val: number) => val > 0 ? `${(val * 100).toFixed(0)}%` : ''} />
                        </Area>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card 
                  title={(selectedChartDay === 'all' || selectedChartDay === 'grid' || selectedChartDay === 'grouped') ? "Grafik Rata-rata Lead Time per Jam (Semua Hari)" : "Grafik Rata-rata Lead Time per Jam"} 
                  subtitle={(selectedChartDay === 'all' || selectedChartDay === 'grid' || selectedChartDay === 'grouped') ? "Rata-rata lead time penyiapan obat + penyerahan per jam" : `Rata-rata lead time penyiapan obat + penyerahan per jam tanggal ${format(new Date(selectedChartDay), 'dd MMM yyyy')}`}
                  action={daySelectAction}
                >
                  <div className="h-64 w-full pt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartHourlyData} margin={{ top: 20, right: 25, left: 25, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} padding={{ left: 20, right: 20 }} />
                        <YAxis hide domain={[0, 'auto']} />
                        <Tooltip 
                          formatter={(val: number) => [`${val.toFixed(1)} menit`, 'Lead Time']}
                        />
                        <Line type="monotone" dataKey="avgLeadTime" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }}>
                          <LabelList dataKey="avgLeadTime" position="top" style={{ fontSize: 10, fill: '#8b5cf6', fontWeight: 605 }} offset={6} formatter={(val: number) => val > 0 ? `${val.toFixed(1)}m` : ''} />
                        </Line>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Analisis Harian" subtitle="Performa petugas dari hari ke hari (Klik untuk detail per jam)">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm mt-4">
                      <thead>
                        <tr className="text-slate-700 font-bold border-b border-slate-200 bg-slate-50/50">
                          <th className="py-2.5 px-2">Tanggal</th>
                          <th>Order</th>
                          <th>Rerata Leadtime</th>
                          <th>Utilisasi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyMetrics.map(d => (
                          <React.Fragment key={d.day}>
                            <tr 
                              className="border-b border-slate-100 cursor-pointer hover:bg-slate-100/50 transition-colors"
                              onClick={() => setExpandedDay(expandedDay === d.day ? null : d.day)}
                            >
                              <td className="py-3 px-2 font-semibold text-slate-800 flex items-center gap-2">
                                <Activity className={cn("w-3 h-3 transition-transform text-slate-500", expandedDay === d.day ? "rotate-90 text-indigo-600" : "")} />
                                {format(new Date(d.day), 'dd MMM yyyy')}
                              </td>
                              <td className="text-slate-700 font-semibold">{d.orderCount} resep</td>
                              <td className="font-bold text-violet-700">{d.avgLead.toFixed(1)} menit</td>
                              <td>
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-blue-600 rounded-full" 
                                      style={{ width: `${d.utilization * 100}%` }}
                                    />
                                  </div>
                                  <span className="font-extrabold text-slate-800">{(d.utilization * 100).toFixed(0)}%</span>
                                </div>
                              </td>
                            </tr>
                            {expandedDay === d.day && (
                              <tr className="bg-slate-50 border-b border-slate-100">
                                <td colSpan={4} className="py-5 px-6">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Kolom 1: Utilisasi */}
                                    <div>
                                      <p className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest mb-2 flex items-center justify-between">
                                        <span>Utilisasi per Jam (%)</span>
                                        <span className="text-slate-550 font-bold bg-white px-1.5 py-0.5 rounded shadow-sm border border-slate-100">Okupansi Petugas</span>
                                      </p>
                                      <div className="h-28 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                          <AreaChart data={d.hourly} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                                            <XAxis dataKey="hour" hide padding={{ left: 15, right: 15 }} />
                                            <YAxis hide domain={[0, 1.15]} />
                                            <Tooltip 
                                              formatter={(val: number) => [`${(val * 100).toFixed(1)}%`, 'Okupansi']}
                                              labelStyle={{ fontSize: '10px' }}
                                              contentStyle={{ borderRadius: '8px', border: 'none', padding: '4px 8px' }}
                                            />
                                            <Area type="monotone" dataKey="occupancy" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.15}>
                                              <LabelList dataKey="occupancy" position="top" style={{ fontSize: 9, fill: '#1d4ed8', fontWeight: 700 }} offset={6} formatter={(val: number) => val > 0 ? `${(val * 100).toFixed(0)}%` : ''} />
                                            </Area>
                                          </AreaChart>
                                        </ResponsiveContainer>
                                      </div>
                                      <div className="flex justify-between mt-1.5 px-2 bg-white py-1 rounded border border-slate-100">
                                        {d.hourly.map((h, i) => (
                                          i % 2 === 0 ? <span key={h.hour} className="text-[10px] text-slate-700 font-mono font-bold">{h.hour}</span> : null
                                        ))}
                                      </div>
                                    </div>

                                    {/* Kolom 2: Rerata Lead Time */}
                                    <div>
                                      <p className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest mb-2 flex items-center justify-between">
                                        <span>Rata-rata Lead Time per Jam (Menit)</span>
                                        <span className="text-slate-550 font-bold bg-white px-1.5 py-0.5 rounded shadow-sm border border-slate-100">Waktu Tunggu + Pelayanan</span>
                                      </p>
                                      <div className="h-28 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                          <LineChart data={d.hourly} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                                            <XAxis dataKey="hour" hide padding={{ left: 15, right: 15 }} />
                                            <YAxis hide domain={[0, 'auto']} />
                                            <Tooltip 
                                              formatter={(val: number) => [`${val.toFixed(1)} menit`, 'Lead Time']}
                                              labelStyle={{ fontSize: '10px' }}
                                              contentStyle={{ borderRadius: '8px', border: 'none', padding: '4px 8px' }}
                                            />
                                            <Line type="monotone" dataKey="avgLeadTime" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 1.5 }} activeDot={{ r: 5 }}>
                                              <LabelList dataKey="avgLeadTime" position="top" style={{ fontSize: 9, fill: '#8b5cf6', fontWeight: 600 }} offset={6} formatter={(val: number) => val > 0 ? `${val.toFixed(1)}m` : ''} />
                                            </Line>
                                          </LineChart>
                                        </ResponsiveContainer>
                                      </div>
                                      <div className="flex justify-between mt-1.5 px-2 bg-white py-1 rounded border border-slate-100">
                                        {d.hourly.map((h, i) => (
                                          i % 2 === 0 ? <span key={h.hour} className="text-[10px] text-slate-700 font-mono font-bold">{h.hour}</span> : null
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              {/* Sidebar: AI Insights & Alerts */}
              <div className="space-y-6">
                <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl">
                  <div className="flex items-center gap-2 mb-4 text-slate-400">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <span className="text-sm font-semibold uppercase tracking-wider">AI Insights</span>
                  </div>
                  {insights ? (
                    <div className="prose prose-invert prose-sm">
                      <p className="text-slate-300 leading-relaxed italic">
                        {insights}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-slate-400">
                        Klik tombol di bawah untuk mendapatkan analisis mendalam tentang efisiensi SDM berdasarkan data yang diunggah.
                      </p>
                      <button 
                        onClick={getAIInsights}
                        className="w-full bg-purple-600 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-purple-700 transition-colors cursor-pointer"
                      >
                        Generate Rekomendasi
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200">
                  <h3 className="font-bold flex items-center gap-2 mb-4">
                    <AlertCircle className="w-5 h-5 text-blue-500" />
                    Catatan Metodologi & Kalibrasi
                  </h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Sistem ini menggunakan pendekatan <strong className="text-slate-700">Simulasi Antrean 2-Tahap</strong> untuk memisahkan durasi pelayanan murni dari batasan data statis:
                  </p>
                  <ul className="mt-4 space-y-3 text-xs text-slate-500">
                    <li className="flex gap-2">
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full mt-1 shrink-0" />
                      <div>
                        <strong className="text-slate-700">Tahap 1 (Profiling):</strong> Waktu pengerjaan murni masing-masing resep diekstrak terlebih dahulu dengan mengisolasi waktu antrean di bawah jumlah petugas baseline nyata (biasanya 2 orang).
                      </div>
                    </li>
                    <li className="flex gap-2">
                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full mt-1 shrink-0" />
                      <div>
                        <strong className="text-slate-700">Tahap 2 (Simulasi):</strong> Ketika Anda menambah/mengurangi jumlah petugas uji coba, sistem melakukan simulasi antrean FIFO dinamis. Karena waktu pengerjaan bersih per resep tetap konstan, **Waktu Tunggu dan Lead Time sekarang akan naik/turun secara dinamis** mencerminkan kondisi riil di lapangan.
                      </div>
                    </li>
                    <li className="flex gap-2">
                      <div className="w-1.5 h-1.5 bg-amber-400 rounded-full mt-1 shrink-0" />
                      <div>
                        <strong className="text-slate-700">Offset Penyerahan:</strong> Waktu murni compounding dihitung dengan mengurangkan estimasi menit penyerahan/KIE (misal 3 menit) dari data selesai, memastikan utilisasi staf murni tidak terestimasi berlebihan.
                      </div>
                    </li>
                  </ul>
                </div>

                <button 
                  onClick={() => setOrders([])}
                  className="w-full py-3 text-sm text-slate-400 font-medium hover:text-red-500 transition-colors cursor-pointer"
                >
                  Reset Data & Mulai Baru
                </button>
              </div>
            </div>
            
            {/* Table View */}
            <Card title="Data Rinci (Estimasi)" subtitle="Log pengerjaan order per individu">
              {reconstructed.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Tampilkan per halaman:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPageSize(val === 'all' ? 'all' : Number(val));
                        setCurrentPage(1);
                      }}
                      className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer text-xs"
                    >
                      <option value={10}>10 Baris</option>
                      <option value={50}>50 Baris</option>
                      <option value={100}>100 Baris</option>
                      <option value="all">Semua ({reconstructed.length})</option>
                    </select>
                  </div>

                  {pageSize !== 'all' && totalPages > 1 && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition cursor-pointer"
                      >
                        Sebelumnya
                      </button>
                      <span className="text-slate-500 font-medium px-2">
                        Halaman <span className="font-bold text-slate-800">{currentPage}</span> dari <span className="font-bold text-slate-800">{totalPages}</span>
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition cursor-pointer"
                      >
                        Berikutnya
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="overflow-x-auto -mx-6 px-6 pb-6">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-700 font-bold bg-slate-50/70">
                      <th className="py-3 px-2">ID Order</th>
                      <th>Masuk</th>
                      <th>Estimasi Mulai</th>
                      <th>Selesai</th>
                      <th>Waktu Tunggu</th>
                      <th>Leadtime (Total)</th>
                      <th>Lama Layanan</th>
                      <th>Petugas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOrders.map((o) => (
                      <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-2 font-mono font-bold text-slate-800">{o.id}</td>
                        <td className="text-slate-700 font-medium font-mono">{format(o.arrival, 'HH:mm')}</td>
                        <td className="text-slate-700 font-medium font-mono">{format(o.estimatedStart, 'HH:mm')}</td>
                        <td className="text-slate-700 font-medium font-mono">{format(o.completion, 'HH:mm')}</td>
                        <td>
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm border",
                            o.waitTime > 15 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 text-slate-700 border-slate-200"
                          )}>
                            {o.waitTime} menit
                          </span>
                        </td>
                        <td className="font-bold text-violet-700">{o.leadTime} menit</td>
                        <td>
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm border",
                            o.serviceTime > 30 ? "bg-red-50 text-red-700 border-red-200" : "bg-blue-50 text-blue-700 border-blue-200"
                          )}>
                            {o.serviceTime % 1 === 0 ? o.serviceTime : o.serviceTime.toFixed(1)} menit
                          </span>
                        </td>
                        <td className="text-slate-700 font-bold">Petugas {o.staffId}</td>
                      </tr>
                    ))}
                    {paginatedOrders.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Tidak ada data order tersedia. Silakan unggah file CSV atau tempelkan log teks Anda.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {reconstructed.length > 0 && (
                  <div className="flex justify-between items-center text-xs text-slate-400 mt-4 italic">
                    <span>
                      {pageSize === 'all' 
                        ? `Menampilkan semua ${reconstructed.length} order` 
                        : `Menampilkan data baris ke-${(currentPage - 1) * pageSize + 1} hingga ${Math.min(currentPage * pageSize, reconstructed.length)} dari ${reconstructed.length} order`
                      }
                    </span>
                    {pageSize !== 'all' && totalPages > 1 && (
                      <span className="not-italic font-medium text-slate-500">
                        Halaman {currentPage} dari {totalPages}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, color, subtitle }: { 
  label: string; value: string | number; icon: React.ReactNode; color: 'blue' | 'amber' | 'emerald' | 'indigo' | 'violet';
  subtitle?: string;
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    violet: 'bg-violet-50 text-violet-600',
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-2 rounded-xl", colorMap[color])}>
          {icon}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-bold text-slate-600 mb-1">{label}</h3>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        {subtitle && <p className="text-xs text-slate-600 mt-1 font-semibold">{subtitle}</p>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, children, action }: { title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 mb-4">
        <div>
          <h3 className="font-extrabold text-lg text-slate-800">{title}</h3>
          <p className="text-sm text-slate-600 font-medium leading-relaxed mt-0.5">{subtitle}</p>
        </div>
        {action && <div className="w-full pt-1">{action}</div>}
      </div>
      {children}
    </div>
  );
}
