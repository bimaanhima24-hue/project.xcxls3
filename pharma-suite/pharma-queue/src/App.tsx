import React, { useState, useEffect } from 'react';
import { 
  format, 
  parseISO, 
  differenceInSeconds 
} from 'date-fns';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  updateDoc, 
  deleteDoc,
  doc,
  getDocFromServer,
  where
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import * as XLSX from 'xlsx';
import { 
  auth, 
  db 
} from './firebase';
import { QueueItem } from './types';
import { 
  Plus, 
  LogOut, 
  Clock, 
  Filter, 
  Calendar, 
  CheckCircle2, 
  Loader2, 
  Activity, 
  X, 
  Trash2, 
  FileDown, 
  Check, 
  ArrowRight,
  Sparkles,
  Search,
  FileSpreadsheet,
  Upload
} from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Info: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Format duration helper (displays e.g. "12m 4s")
const formatDuration = (startISO: string, endISO?: string) => {
  if (!endISO) return '-';
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  
  const totalSeconds = differenceInSeconds(end, start);
  if (totalSeconds < 0) return '0s';
  
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

// Return raw minutes helper for sorting / statistics calculations
const getDurationInMinutes = (startISO: string, endISO?: string) => {
  if (!endISO) return 0;
  return Math.max(0, differenceInSeconds(parseISO(endISO), parseISO(startISO)) / 60);
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // App workspace states
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [idPasien, setIdPasien] = useState('');
  const [obatRacik, setObatRacik] = useState(0);
  const [obatNonRacik, setObatNonRacik] = useState(0);
  const [inputDate, setInputDate] = useState('2026-03-02');
  const [inputTime, setInputTime] = useState('08:00:00');
  const [isLiveTime, setIsLiveTime] = useState(false);

  // Filter state
  const [selectedDate, setSelectedDate] = useState('2026-03-02');
  const [filterMode, setFilterMode] = useState<'single' | 'all'>('single');
  const [showTrash, setShowTrash] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Import XLSX states
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importError, setImportError] = useState('');
  const [isConfirmingDeleteDate, setIsConfirmingDeleteDate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteConfirmation, setBulkDeleteConfirmation] = useState(false);
  const [emptyTrashConfirmation, setEmptyTrashConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    id: string;
    id_pasien: string;
    isPermanent: boolean;
  } | null>(null);



  // 1. Connection Validation & Auth State
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        console.warn("Connection test failed: server might be offline, which is fine during dev:", error instanceof Error ? error.message : String(error));
      }
    }
    testConnection();

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Real-time Clock interval (updates Date and Time if live-mode is active)
  useEffect(() => {
    let interval: any;
    if (isLiveTime) {
      interval = setInterval(() => {
        const now = new Date();
        setInputTime(format(now, 'HH:mm:ss'));
        setInputDate(format(now, 'yyyy-MM-dd'));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isLiveTime]);

  // 3. Sync queues from Firestore (reactive subscription only when user authenticated)
  useEffect(() => {
    if (!user) {
      setQueues([]);
      return;
    }

    const queuesRef = collection(db, 'queues');
    const q = query(
      queuesRef, 
      where('uid', '==', user.uid),
      orderBy('waktu_resep_masuk', 'asc')
    );

    const unsubscribeQueues = onSnapshot(q, (snapshot) => {
      const items: QueueItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          id_pasien: data.id_pasien,
          jumlah_obat_racik: Number(data.jumlah_obat_racik || 0),
          jumlah_obat_non_racik: Number(data.jumlah_obat_non_racik || 0),
          waktu_resep_masuk: data.waktu_resep_masuk,
          waktu_resep_selesai: data.waktu_resep_selesai,
          waktu_obat_diserahkan: data.waktu_obat_diserahkan,
          status: data.status,
          uid: data.uid,
          status_hapus: !!data.status_hapus,
        });
      });
      setQueues(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'queues');
    });

    return () => unsubscribeQueues();
  }, [user]);

  // Handle Login using Google Account
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error instanceof Error ? error.message : String(error));
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error instanceof Error ? error.message : String(error));
    }
  };

  // Add Item to queue
  const addToQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      // Parse YYYY-MM-DD and HH:mm:ss manually to avoid browser timezone parsing discrepancies
      const [year, month, day] = inputDate.split('-').map(Number);
      const [hours, minutes, seconds] = inputTime.split(':').map(Number);
      const localDate = new Date(year, month - 1, day, hours, minutes, seconds || 0);
      const entryTime = localDate.toISOString();

      const newItem: Omit<QueueItem, 'id'> = {
        id_pasien: idPasien.trim(),
        jumlah_obat_racik: Number(obatRacik),
        jumlah_obat_non_racik: Number(obatNonRacik),
        waktu_resep_masuk: entryTime,
        status: 'menunggu',
        uid: user.uid,
      };

      await addDoc(collection(db, 'queues'), newItem);

      // Reset Form fields
      setIdPasien('');
      setObatRacik(0);
      setObatNonRacik(0);
      setInputTime(format(new Date(), 'HH:mm:ss'));
      setIsLiveTime(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'queues');
    }
  };

  // Helper to parse dates from Excel rows dynamically
  const parseExcelDate = (val: any): string => {
    if (!val) return '';
    if (val instanceof Date) {
      return val.toISOString();
    }
    
    if (typeof val === 'number') {
      // Excel base date standard is December 30, 1899
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const msInDay = 24 * 60 * 60 * 1000;
      const timeInMs = excelEpoch.getTime() + val * msInDay;
      return new Date(timeInMs).toISOString();
    }
    
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const parsed = Date.parse(trimmed);
      if (!isNaN(parsed)) {
        return new Date(parsed).toISOString();
      }
      
      // If it is just time like "08:30:15"
      if (trimmed.includes(':') && !trimmed.includes('-') && !trimmed.includes('/')) {
        const defaultDateStr = selectedDate || '2026-03-02';
        const parsedDateTime = Date.parse(`${defaultDateStr} ${trimmed}`);
        if (!isNaN(parsedDateTime)) {
          return new Date(parsedDateTime).toISOString();
        }
      }
      
      // DD/MM/YYYY or DD-MM-YYYY
      const dateMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2}):?(\d{1,2})?)?/);
      if (dateMatch) {
        const [, day, month, year, hours = '0', minutes = '0', seconds = '0'] = dateMatch;
        const parsedDate = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hours),
          parseInt(minutes),
          parseInt(seconds)
        );
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate.toISOString();
        }
      }
    }
    return '';
  };

  // Handler for uploading and parsing XLSX files to Firestore
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsImporting(true);
    setImportError('');
    setImportProgress('Membaca file Excel (.xlsx)...');

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        // Read workbook
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Parse rows as raw json array
        const rawData = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
        
        if (rawData.length === 0) {
          throw new Error('File Excel tidak mempunyai baris data.');
        }

        setImportProgress(`Mendeteksi kolom data (0/${rawData.length})...`);
        let successCount = 0;

        for (let i = 0; i < rawData.length; i++) {
          const row = rawData[i];
          setImportProgress(`Mengimpor antrian resep (${i + 1}/${rawData.length})...`);

          let namaPasien = '';
          let racik = 0;
          let nonRacik = 0;
          let jumlahResepFallback = 0;
          let status: 'menunggu' | 'proses' | 'selesai' = 'menunggu';

          // Search properties of the row object with robust fuzzy matching
          for (const key of Object.keys(row)) {
            const lowerKey = key.toLowerCase().trim();
            const value = row[key];
            if (value === null || value === undefined || value === '') continue;

            if (
              lowerKey.includes('pasien') || 
              lowerKey.includes('patient') || 
              lowerKey === 'nama' || 
              lowerKey === 'id' || 
              lowerKey === 'id_pasien' || 
              lowerKey === 'nama_pasien'
            ) {
              namaPasien = String(value).trim();
            } else if (
              lowerKey.includes('obat racik') || 
              lowerKey.includes('obat_racik') || 
              (lowerKey.includes('racik') && !lowerKey.includes('non'))
            ) {
              racik = Math.max(0, parseInt(value) || 0);
            } else if (
              lowerKey.includes('non-racik') || 
              lowerKey.includes('non_racik') || 
              lowerKey.includes('non racik') || 
              lowerKey.includes('biasa') || 
              lowerKey.includes('jadi')
            ) {
              nonRacik = Math.max(0, parseInt(value) || 0);
            } else if (
              lowerKey.includes('jumlah resep') || 
              lowerKey.includes('jumlah_resep') || 
              lowerKey.includes('jumlah obat') || 
              lowerKey.includes('jumlah_obat') || 
              lowerKey === 'jumlah' || 
              lowerKey === 'total' || 
              lowerKey === 'qty' || 
              lowerKey === 'resep'
            ) {
              jumlahResepFallback = Math.max(0, parseInt(value) || 0);
            } else if (lowerKey.includes('status') || lowerKey.includes('state') || lowerKey.includes('tahapan')) {
              const valStr = String(value).toLowerCase().trim();
              if (['menunggu', 'proses', 'selesai', 'diserahkan'].includes(valStr)) {
                status = valStr === 'diserahkan' ? 'selesai' : valStr as any;
              }
            }
          }

          // If neither racik nor nonRacik was explicitly provided but we found a generic count Column (e.g. Jumlah/Jumlah Resep)
          if (racik === 0 && nonRacik === 0 && jumlahResepFallback > 0) {
            nonRacik = jumlahResepFallback;
          }

          // Skip if no patient identity found
          if (!namaPasien) continue;

          // Find dates with fuzzy matching
          let waktuMasukISO = '';
          let waktuSelesaiISO = '';
          let waktuDiserahkanISO = '';

          for (const key of Object.keys(row)) {
            const lowerKey = key.toLowerCase().trim();
            const value = row[key];
            if (!value) continue;

            if (
              lowerKey.includes('resep masuk') || 
              lowerKey.includes('waktu masuk') || 
              lowerKey.includes('tanggal masuk') || 
              lowerKey.includes('resep_masuk') || 
              lowerKey === 'masuk'
            ) {
              waktuMasukISO = parseExcelDate(value);
            } else if (
              lowerKey.includes('resep selesai') || 
              lowerKey.includes('waktu selesai') || 
              lowerKey.includes('tanggal selesai') || 
              lowerKey.includes('resep_selesai') || 
              lowerKey === 'selesai'
            ) {
              waktuSelesaiISO = parseExcelDate(value);
            } else if (
              lowerKey.includes('diserahkan') || 
              lowerKey.includes('penyerahan') || 
              lowerKey === 'waktu_obat_diserahkan'
            ) {
              waktuDiserahkanISO = parseExcelDate(value);
            }
          }

          // Generate sequential date if missing
          if (!waktuMasukISO) {
            const defaultDateStr = selectedDate || '2026-03-02';
            const [year, month, day] = defaultDateStr.split('-').map(Number);
            const minutes = (i * 2) % 65; // Stagger minutes so times look natural
            const hours = 8 + Math.floor((i * 2) / 60);
            const lDate = new Date(year, month - 1, day, hours, minutes, 0);
            waktuMasukISO = lDate.toISOString();
          }

          const itemToSave: any = {
            id_pasien: namaPasien,
            jumlah_obat_racik: racik,
            jumlah_obat_non_racik: nonRacik,
            waktu_resep_masuk: waktuMasukISO,
            status: status,
            uid: user.uid,
          };

          if (waktuSelesaiISO) {
            itemToSave.waktu_resep_selesai = waktuSelesaiISO;
            itemToSave.status = 'selesai';
          } else if (waktuDiserahkanISO) {
            itemToSave.waktu_resep_selesai = waktuDiserahkanISO;
            itemToSave.status = 'selesai';
          }

          try {
            await addDoc(collection(db, 'queues'), itemToSave);
            successCount++;
          } catch (writeErr) {
            console.error('Single row write error:', writeErr);
          }
        }

        setImportProgress(`Berhasil mengimpor ${successCount} resep pasien!`);
        setTimeout(() => {
          setIsImporting(false);
          setImportProgress('');
        }, 4000);
      } catch (err: any) {
        console.error('File parsing error:', err);
        setImportError(err instanceof Error ? err.message : 'Gagal membaca format data Excel.');
        setIsImporting(false);
      }
    };

    reader.onerror = () => {
      setImportError('Gagal membaca berkas.');
      setIsImporting(false);
    };

    reader.readAsBinaryString(file);
  };



  // Update Status Progression
  const updateStatus = async (item: QueueItem, nextStatus: 'proses' | 'selesai') => {
    try {
      const updateData: any = { status: nextStatus };
      const nowISO = new Date().toISOString();

      if (nextStatus === 'proses') {
        // Just advance status
      } else if (nextStatus === 'selesai') {
        updateData.waktu_resep_selesai = nowISO;
      }

      await updateDoc(doc(db, 'queues', item.id), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `queues/${item.id}`);
    }
  };

  // Delete individual item (Soft Delete)
  const deleteItem = async (id: string) => {
    const item = queues.find(q => q.id === id);
    if (item) {
      setDeleteConfirmation({
        id: item.id,
        id_pasien: item.id_pasien,
        isPermanent: false
      });
    }
  };

  // Restore individual item from Recycle Bin
  const restoreItem = async (id: string) => {
    try {
      await updateDoc(doc(db, 'queues', id), {
        status_hapus: false
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `queues/${id}`);
    }
  };

  // Delete item permanently
  const permanentlyDeleteItem = async (id: string) => {
    const item = queues.find(q => q.id === id);
    if (item) {
      setDeleteConfirmation({
        id: item.id,
        id_pasien: item.id_pasien,
        isPermanent: true
      });
    }
  };

  // Permanently delete all items currently in the Recycle Bin (Empty Trash)
  const emptyTrashPool = async () => {
    const deletedItems = queues.filter(item => item.status_hapus);
    if (deletedItems.length === 0) return;
    try {
      const promises = deletedItems.map(item => 
        deleteDoc(doc(db, 'queues', item.id))
      );
      await Promise.all(promises);
      setEmptyTrashConfirmation(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'empty-trash');
    }
  };

  // Delete all active queues of selected date (Move to Trash)
  const deleteQueuesBySelectedDate = async () => {
    const activeOnThisDate = queues.filter(item => {
      if (item.status_hapus) return false;
      try {
        const docDate = format(parseISO(item.waktu_resep_masuk), 'yyyy-MM-dd');
        return docDate === selectedDate;
      } catch {
        return false;
      }
    });

    if (activeOnThisDate.length === 0) {
      alert(`Tidak ada antrian aktif pada tanggal ${format(new Date(selectedDate), 'dd MMMM yyyy')} untuk dipindahkan ke Sampah.`);
      setIsConfirmingDeleteDate(false);
      return;
    }

    try {
      const promises = activeOnThisDate.map(item => 
        updateDoc(doc(db, 'queues', item.id), {
          status_hapus: true
        })
      );
      await Promise.all(promises);
      setIsConfirmingDeleteDate(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bulk-delete-by-date/${selectedDate}`);
    }
  };

  // Multiple selection handlers
  const toggleSelectItem = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (visibleItems: QueueItem[]) => {
    const visibleIds = visibleItems.map(item => item.id);
    const areAllSelected = visibleIds.every(id => selectedIds.includes(id));

    if (areAllSelected) {
      // Uncheck all visible items
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      // Check all visible items
      setSelectedIds(prev => {
        const union = new Set([...prev, ...visibleIds]);
        return Array.from(union);
      });
    }
  };

  const bulkDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    try {
      const promises = selectedIds.map(id => 
        updateDoc(doc(db, 'queues', id), {
          status_hapus: true
        })
      );
      await Promise.all(promises);
      setSelectedIds([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'bulk-delete-queues');
    }
  };



  // Filter queues to only display selected date (based on 'waktu_resep_masuk' date element)
  const filteredQueues = queues.filter((item) => {
    // Hide soft-deleted items from the main active flows
    if (item.status_hapus) return false;

    // Filter by search query if set (searching bypasses date filters to look across all dates)
    if (searchQuery.trim() !== '') {
      return item.id_pasien.toLowerCase().includes(searchQuery.trim().toLowerCase());
    }

    if (filterMode === 'all') return true;
    try {
      const docDate = format(parseISO(item.waktu_resep_masuk), 'yyyy-MM-dd');
      return docDate === selectedDate;
    } catch (e) {
      return false;
    }
  });

  // Count matching items currently in the trash bin
  const trashMatchesCount = searchQuery.trim() !== ''
    ? queues.filter(item => item.status_hapus && item.id_pasien.toLowerCase().includes(searchQuery.trim().toLowerCase())).length
    : 0;

  // Count items stored on other dates (used to notify users if data seems missing)
  const totalInOtherDates = queues.filter((item) => {
    if (item.status_hapus) return false;
    try {
      const docDate = format(parseISO(item.waktu_resep_masuk), 'yyyy-MM-dd');
      return docDate !== selectedDate;
    } catch (e) {
      return false;
    }
  }).length;

  // Export filtered items to Excel file
  const exportToExcel = () => {
    if (filteredQueues.length === 0) {
      alert('Tidak ada data antrian untuk diekspor pada tanggal terpilih.');
      return;
    }

    const dataExcel = filteredQueues.map((item, index) => {
      let durasiRacik = '-';
      let durasiNonRacik = '-';
      
      const waitMinutes = getDurationInMinutes(item.waktu_resep_masuk, item.waktu_resep_selesai);
      
      if (item.waktu_resep_selesai) {
        if (item.jumlah_obat_racik > 0) {
          durasiRacik = `${waitMinutes.toFixed(1)} menit`;
        }
        if (item.jumlah_obat_non_racik > 0) {
          durasiNonRacik = `${waitMinutes.toFixed(1)} menit`;
        }
      }

      return {
        'No Antrian': index + 1,
        'ID/Nama Pasien': item.id_pasien,
        'Obat Racik': item.jumlah_obat_racik,
        'Obat Non-Racik': item.jumlah_obat_non_racik,
        'Waktu Resep Masuk': format(parseISO(item.waktu_resep_masuk), 'yyyy-MM-dd HH:mm:ss'),
        'Waktu Resep Selesai': item.waktu_resep_selesai ? format(parseISO(item.waktu_resep_selesai), 'yyyy-MM-dd HH:mm:ss') : '-',
        'Status': item.status.toUpperCase(),
        'Durasi Racik': durasiRacik,
        'Durasi Non-Racik': durasiNonRacik,
        'Total Tunggu': item.waktu_resep_selesai ? formatDuration(item.waktu_resep_masuk, item.waktu_resep_selesai) : '-'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Antrian Farmasi');
    XLSX.writeFile(workbook, `Antrian_Farmasi_${selectedDate}.xlsx`);
  };

  // Average time calculations (Durations in minutes)
  const racikDurations = filteredQueues
    .filter(item => item.jumlah_obat_racik > 0 && item.waktu_resep_selesai)
    .map(item => getDurationInMinutes(item.waktu_resep_masuk, item.waktu_resep_selesai));

  const nonRacikDurations = filteredQueues
    .filter(item => item.jumlah_obat_non_racik > 0 && item.waktu_resep_selesai)
    .map(item => getDurationInMinutes(item.waktu_resep_masuk, item.waktu_resep_selesai));

  const avgRacik = racikDurations.length > 0 
    ? (racikDurations.reduce((sum, val) => sum + val, 0) / racikDurations.length).toFixed(1)
    : '0.0';

  const avgNonRacik = nonRacikDurations.length > 0 
    ? (nonRacikDurations.reduce((sum, val) => sum + val, 0) / nonRacikDurations.length).toFixed(1)
    : '0.0';

  const totalAntrian = filteredQueues.length;
  const antrianSelesai = filteredQueues.filter(item => item.status === 'selesai' || item.status === 'diserahkan').length;



  if (loading) {
    return (
      <div className="id-page flex flex-col items-center justify-center min-h-screen bg-stone-50 text-stone-600 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        <span className="text-sm font-medium">Memuat Aplikasi...</span>
      </div>
    );
  }

  // Auth screen
  if (!user) {
    return (
      <div id="login-layout" className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div id="login-card" className="max-w-md w-full bg-white rounded-3xl border border-black/5 p-8 shadow-xl text-center space-y-6">
          <div className="mx-auto w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center border border-emerald-100">
            <Activity className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-stone-900 tracking-tight">Antrian Farmasi</h2>
            <p className="text-stone-500 text-sm mt-2">Masuk menggunakan Akun Google untuk mengakses dasbor antrian resep obat.</p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-stone-900 hover:bg-stone-800 text-white rounded-2xl text-sm font-medium transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Masuk dengan Google
          </button>
        </div>
      </div>
    );
  }

  // Dashboard Main Screen
  return (
    <div id="main-admin" className="min-h-screen pb-16 pt-6 px-4 md:px-8 max-w-7xl mx-auto space-y-6">
      
      {/* Header bar */}
      <header id="app-header" className="flex items-center justify-between p-4 bg-white border border-black/5 rounded-3xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100">
            <Activity className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-stone-900">Antrian Farmasi</h1>
            <p className="text-xs text-stone-500 font-medium">Sistem Monitoring Pelayanan Resep</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end text-sm">
            <span className="font-bold text-stone-900">{user.displayName}</span>
            <span className="text-xs text-stone-400">{user.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 border border-black/5 hover:bg-stone-50 text-stone-500 hover:text-red-600 rounded-xl transition-colors"
            title="Keluar"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Grid Dashboard Statistika */}
      <section id="statistic-row" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Antrian Terpilih */}
        <div className="bg-white border border-black/5 p-4 rounded-3xl shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 bg-emerald-50 rounded-2xl flex items-center justify-center border border-emerald-100/50">
            <Clock className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <span className="block text-xs text-stone-400 font-bold uppercase tracking-wider">
              {filterMode === 'all' ? 'Total Antrian (Semua)' : 'Total Antrian'}
            </span>
            <span className="text-xl font-black text-stone-900 tracking-tight">{totalAntrian} Resep</span>
          </div>
        </div>

        {/* Antrian Selesai */}
        <div id="stat-selesai" className={`border p-4 rounded-3xl shadow-sm flex items-center gap-3.5 transition-all duration-300 ${
          totalAntrian > 0 && antrianSelesai === totalAntrian
            ? 'bg-emerald-50/50 border-emerald-200/50'
            : 'bg-white border-black/5'
        }`}>
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border transition-all duration-300 ${
            totalAntrian > 0 && antrianSelesai === totalAntrian
              ? 'bg-emerald-50 text-emerald-600 border-emerald-100/50 shadow-sm'
              : 'bg-blue-50 text-blue-600 border-blue-100/50'
          }`}>
            <CheckCircle2 className={`w-5 h-5 ${totalAntrian > 0 && antrianSelesai === totalAntrian ? 'animate-bounce' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="block text-xs text-stone-400 font-bold uppercase tracking-wider">
                {filterMode === 'all' ? 'Selesai (Semua)' : 'Selesai'}
              </span>
              {totalAntrian > 0 && antrianSelesai === totalAntrian && (
                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-black tracking-wide uppercase rounded-md border border-emerald-200">
                  Selesai Semua
                </span>
              )}
            </div>
            <span className={`text-xl font-black tracking-tight transition-colors duration-300 ${
              totalAntrian > 0 && antrianSelesai === totalAntrian
                ? 'text-emerald-800 font-extrabold'
                : 'text-stone-900'
            }`}>{antrianSelesai} / {totalAntrian}</span>
          </div>
        </div>

        {/* Rata-rata Racik */}
        <div className="bg-white border border-black/5 p-4 rounded-3xl shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 bg-amber-50 rounded-2xl flex items-center justify-center border border-amber-100/50">
            <Sparkles className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <span className="block text-xs text-stone-400 font-bold uppercase tracking-wider">
              {filterMode === 'all' ? 'Rerata Racik (Semua)' : 'Rata-rata Racik'}
            </span>
            <span className="text-xl font-black text-stone-900 tracking-tight">{avgRacik} <span className="text-xs font-normal text-stone-400">menit</span></span>
          </div>
        </div>

        {/* Rata-rata Non-Racik */}
        <div className="bg-white border border-black/5 p-4 rounded-3xl shadow-sm flex items-center gap-3.5">
          <div className="w-11 h-11 bg-pink-50 rounded-2xl flex items-center justify-center border border-pink-100/50">
            <Activity className="w-5 h-5 text-pink-600" />
          </div>
          <div>
            <span className="block text-xs text-stone-400 font-bold uppercase tracking-wider">
              {filterMode === 'all' ? 'Rerata Non-Racik (Semua)' : 'Rata-rata Non-Racik'}
            </span>
            <span className="text-xl font-black text-stone-900 tracking-tight">{avgNonRacik} <span className="text-xs font-normal text-stone-400">menit</span></span>
          </div>
        </div>

      </section>

      {/* Main Grid: Form Entry & List Antrian */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Kolom Kiri: Form Input */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-black/5 rounded-3xl shadow-sm p-6 space-y-5">
            <div>
              <h2 className="text-base font-black text-stone-900 tracking-tight">Input Antrian Baru</h2>
              <p className="text-xs text-stone-400 font-medium">Tambahkan resep masuk dari pasien</p>
            </div>

            <form onSubmit={addToQueue} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5Packed">ID Pasien / Nama</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: PXYZ001 atau Budi Setiawan"
                  value={idPasien}
                  onChange={(e) => setIdPasien(e.target.value)}
                  className="w-full px-4 py-2.5 bg-stone-50 border border-black/5 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">Obat Racikan</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={obatRacik}
                    onChange={(e) => setObatRacik(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 bg-stone-50 border border-black/5 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">Obat Non-Racik</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={obatNonRacik}
                    onChange={(e) => setObatNonRacik(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 bg-stone-50 border border-black/5 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                  />
                </div>
              </div>

              {/* Input Date */}
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5">Tanggal Masuk</label>
                <input
                  type="date"
                  required
                  value={inputDate}
                  onChange={(e) => {
                    setInputDate(e.target.value);
                    setIsLiveTime(false);
                  }}
                  className="w-full px-4 py-2.5 bg-stone-50 border border-black/5 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                />
              </div>

              {/* Input Time with Live Toggle */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider">Waktu Masuk</label>
                  <button 
                    type="button"
                    onClick={() => setIsLiveTime(!isLiveTime)}
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider transition-all border ${
                      isLiveTime 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-stone-100 text-stone-500 border-stone-200'
                    }`}
                  >
                    {isLiveTime ? '● Live Time' : 'Manual Time'}
                  </button>
                </div>
                <input
                  type="time"
                  step="1"
                  required
                  value={inputTime}
                  onChange={(e) => {
                    setInputTime(e.target.value);
                    setIsLiveTime(false);
                  }}
                  className="w-full px-4 py-2.5 bg-stone-50 border border-black/5 rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm"
                />
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl tracking-wide text-sm transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Tambahkan Ke Antrian
              </button>
            </form>
          </div>

          {/* Impor Antrian dari Excel */}
          <div className="bg-white border border-black/5 rounded-3xl shadow-sm p-6 space-y-4">
            <div>
              <h2 className="text-base font-black text-stone-900 tracking-tight flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                Impor Antrian dari Excel
              </h2>
              <p className="text-xs text-stone-400 font-medium">Unggah berkas .xlsx untuk mengimpor banyak resep sekaligus</p>
            </div>

            <div className="border border-stone-200 border-dashed rounded-2xl p-4 bg-stone-50 hover:bg-stone-100 transition-all relative group text-center cursor-pointer">
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleImportExcel}
                disabled={isImporting}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                id="excel-file-input"
              />
              <div className="flex flex-col items-center justify-center gap-2 text-stone-500 py-3">
                <Upload className="w-6 h-6 text-stone-400 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold text-stone-700">Pilih berkas Excel (.xlsx)</span>
                <span className="text-[10px] text-stone-400">Atau seret & taruh berkas di sini</span>
              </div>
            </div>

            {isImporting && (
              <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center gap-3 text-emerald-800 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600 flex-shrink-0" />
                <span className="text-[11px] font-bold">{importProgress}</span>
              </div>
            )}

            {importError && (
              <div className="p-3.5 bg-red-50 rounded-2xl border border-red-100 flex items-center gap-3 text-red-800">
                <X className="w-4 h-4 text-red-500 flex-shrink-0 cursor-pointer" onClick={() => setImportError('')} />
                <span className="text-[11px] font-bold">{importError}</span>
              </div>
            )}

            <div className="bg-stone-50 border border-stone-100 p-3.5 rounded-2xl space-y-1.5 text-[10px] text-stone-400 text-left">
              <span className="font-extrabold text-stone-500 block uppercase tracking-wider mb-1 text-[9px]">Format Kolom Excel:</span>
              <p>● <strong className="text-stone-600">ID/Nama Pasien</strong>: Nama pasien (Budi)</p>
              <p>● <strong className="text-stone-600">Obat Racik</strong> & <strong className="text-stone-600">Obat Non-Racik</strong>: Angka (Atau gunakan kolom <strong className="text-stone-600">Jumlah Resep</strong> / <strong className="text-stone-600">Jumlah</strong>)</p>
              <p>● <strong className="text-stone-600">Waktu Resep Masuk</strong> & <strong className="text-stone-600">Waktu Resep Selesai</strong>: Format tanggal atau jam saja</p>
              <p className="text-emerald-700 font-bold pt-1">*) Sistem mendukung pemetaan otomatis & cerdas dari kolom berkas Excel Anda.</p>
            </div>
          </div>
        </div>

        {/* Kolom Kanan: List Tabel Antrian */}
        <div id="queue-table-col" className="lg:col-span-8 space-y-4">
          
          {/* Filter, Search & Export control bar */}
          <div className="bg-white border border-black/5 p-4 rounded-3xl shadow-sm flex flex-col gap-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search input (highly functional, styled beautifully) */}
              <div className="relative flex-1 max-w-md w-full">
                <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Cari pasien berdasarkan nama..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-10 py-2 w-full bg-stone-50 border border-black/5 rounded-2xl text-xs font-semibold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all placeholder:text-stone-400 text-stone-900"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1.5 hover:bg-stone-200/50 p-1 rounded-lg transition-colors text-stone-400 hover:text-stone-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Action buttons (Trash & Export) */}
              <div className="flex items-center gap-2 self-start md:self-auto w-full md:w-auto justify-between md:justify-start">
                <button
                  type="button"
                  onClick={() => setShowTrash(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 border border-black/5 hover:bg-stone-50 text-stone-500 hover:text-red-600 rounded-2xl text-xs font-bold transition-colors shadow-sm"
                  title="Buka Keranjang Sampah"
                >
                  <Trash2 className="w-4 h-4" />
                  Sampah ({queues.filter(item => item.status_hapus).length})
                </button>

                <button
                  type="button"
                  onClick={exportToExcel}
                  className="flex items-center justify-center gap-2 px-4 py-2 border border-black/5 hover:bg-stone-50 text-stone-800 hover:text-emerald-700 rounded-2xl text-xs font-extrabold transition-colors shadow-sm"
                >
                  <FileDown className="w-4 h-4" />
                  Ekspor Laporan (Excel)
                </button>
              </div>
            </div>

            {/* Date Filters Row */}
            <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-3">
              <div className="flex items-center gap-1.5">
                <Filter className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Penyaringan Tanggal:</span>
              </div>
              <div className="flex bg-stone-100 p-0.5 rounded-2xl border border-black/5">
                <button
                  type="button"
                  onClick={() => setFilterMode('single')}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition-all ${
                    filterMode === 'single'
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                >
                  Per Tanggal
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition-all ${
                    filterMode === 'all'
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                >
                  Semua Tanggal
                </button>
              </div>

              {filterMode === 'single' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setIsConfirmingDeleteDate(false);
                    }}
                    className="px-3 py-1.5 bg-stone-50 border border-black/5 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                  
                  {!isConfirmingDeleteDate ? (
                    <button
                      type="button"
                      onClick={() => setIsConfirmingDeleteDate(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-red-50 text-stone-500 hover:text-red-650 border border-black/5 hover:border-red-200 rounded-2xl text-[11px] font-bold transition-all shadow-sm"
                      title="Hapus semua antrian aktif pada tanggal terpilih"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Kosongkan Tanggal Ini
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-200/50 p-1 pl-2.5 rounded-2xl">
                      <span className="text-[10px] font-black text-red-950">Yakin hapus tanggal ini?</span>
                      <button
                        type="button"
                        onClick={deleteQueuesBySelectedDate}
                        className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-lg transition-colors"
                      >
                        Ya, Hapus
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingDeleteDate(false)}
                        className="px-2 py-1 bg-stone-200 hover:bg-stone-300 text-stone-700 text-[10px] font-black rounded-lg transition-colors"
                      >
                        Batal
                      </button>
                    </div>
                  )}
                </div>
              )}

              {searchQuery && (
                <span className="ml-auto text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-150 px-2.5 py-1 rounded-xl">
                  Sedang mencari "{searchQuery}" di semua tanggal
                </span>
              )}
            </div>
          </div>



          {/* Match found in trash banner */}
          {trashMatchesCount > 0 && (
            <div className="bg-red-50 border border-red-200/40 p-4 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-900 shadow-sm animate-fade-in">
              <div className="flex items-center gap-3 text-xs font-semibold">
                <Trash2 className="w-5 h-5 text-red-600 flex-shrink-0 animate-pulse" />
                <div>
                  <span className="block font-black text-red-950">Nama "{searchQuery}" Ada di Sampah!</span>
                  <span className="text-red-700 block mt-0.5">
                    Terdeteksi ada <strong>{trashMatchesCount}</strong> data pasien yang cocok dengan pencarian di Keranjang Sampah.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTrash(true)}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white font-extrabold text-[11px] rounded-xl transition-all shadow-sm flex items-center gap-1.5 self-end sm:self-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Buka & Pulihkan Sekarang
              </button>
            </div>
          )}

          {/* Bulk actions banner */}
          {selectedIds.length > 0 && (
            <div className="bg-amber-50 border border-amber-200/40 p-4 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 shadow-sm animate-fade-in">
              <div className="flex items-center gap-3 text-xs font-semibold">
                <div className="bg-amber-100 text-amber-800 p-2 rounded-xl flex-shrink-0">
                  <Trash2 className="w-4 h-4 text-amber-600 animate-pulse" />
                </div>
                <div>
                  <span className="block font-black text-amber-950">Terpilih {selectedIds.length} Antrian Pasien</span>
                  <span className="text-amber-700 block mt-0.5">
                    Hapus antrian pasien yang dicentang sekaligus ke dalam Keranjang Sampah.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="px-4 py-2 border border-black/5 hover:bg-stone-105 text-stone-600 font-extrabold text-[11px] rounded-xl transition-all shadow-sm bg-stone-50"
                >
                  Batal Pilihan
                </button>
                <button
                  type="button"
                  onClick={() => setBulkDeleteConfirmation(true)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-extrabold text-[11px] rounded-xl transition-all shadow-sm flex items-center gap-1.5 animate-shake"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus ({selectedIds.length}) Terpilih
                </button>
              </div>
            </div>
          )}

          {/* All medicines completed banner */}
          {totalAntrian > 0 && antrianSelesai === totalAntrian && (
            <div id="all-completed-banner" className="bg-emerald-50 border border-emerald-150 p-4 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-900 shadow-sm animate-fade-in">
              <div className="flex items-center gap-3 text-xs font-semibold">
                <div className="bg-emerald-100 text-emerald-800 p-2 rounded-xl flex-shrink-0 border border-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 animate-bounce" />
                </div>
                <div>
                  <span className="block font-black text-emerald-950 text-sm tracking-tight">Keterangan: Semua obat selesai semua!</span>
                  <span className="text-emerald-700 block mt-0.5">
                    Hebat! Seluruh <strong>{totalAntrian}</strong> resep obat aktif untuk hari ini / penyaringan tanggal terpilih telah selesai diracik oleh apoteker ahli.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Table container card */}
          <div className="bg-white border border-black/5 rounded-3xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/5 bg-stone-50 text-[10px] font-black uppercase text-stone-400 tracking-wider">
                    <th className="py-4 px-4 text-center w-12">
                      <input
                        type="checkbox"
                        checked={filteredQueues.length > 0 && filteredQueues.every(item => selectedIds.includes(item.id))}
                        onChange={() => toggleSelectAll(filteredQueues)}
                        className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        title="Pilih / Batal pilih semua"
                      />
                    </th>
                    <th className="py-4 px-4 text-center">No</th>
                    <th className="py-4 px-4">ID/Nama Pasien</th>
                    <th className="py-4 px-4 text-center">Info Obat</th>
                    <th className="py-4 px-4">Waktu Masuk</th>
                    <th className="py-4 px-4">Durasi Tunggu</th>
                    <th className="py-4 px-4 text-center">Status</th>
                    <th className="py-4 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 text-sm font-medium text-stone-700">
                  {filteredQueues.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-stone-400 p-6">
                        {searchQuery.trim() !== '' ? (
                          <div className="flex flex-col items-center py-4">
                            <Search className="w-10 h-10 text-stone-300 mb-2.5" />
                            <p className="font-extrabold text-stone-800 text-sm mb-1">
                              Pencarian tidak menemukan pasien aktif bernama "{searchQuery}"
                            </p>
                            <p className="text-xs text-stone-400">
                              Coba periksa kesesuaian penulisan nama lengkap atau cari di menu Sampah.
                            </p>
                          </div>
                        ) : (
                          <>
                            <Calendar className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                            <p className="font-bold text-stone-500 mb-1">
                              Tidak ada antrian resep tercatat untuk tanggal {format(new Date(selectedDate), 'dd MMMM yyyy')}.
                            </p>
                            {totalInOtherDates > 0 && (
                              <div className="mt-4 flex flex-col items-center gap-2">
                                <p className="text-xs text-stone-400">
                                  Terdeteksi ada <strong>{totalInOtherDates}</strong> antrian di tanggal lain.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setFilterMode('all')}
                                  className="px-4 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl transition-all border border-emerald-200 shadow-sm"
                                >
                                  Tampilkan Semua Tanggal
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredQueues.map((item, idx) => {
                      // Durasi calculated from resep masuk to resep selesai
                      const durationStr = formatDuration(item.waktu_resep_masuk, item.waktu_resep_selesai);
                      const isSelected = selectedIds.includes(item.id);
                      
                      return (
                        <tr key={item.id} className={`hover:bg-stone-50/50 transition-colors ${isSelected ? 'bg-amber-50/20' : ''}`}>
                          <td className="py-4 px-4 text-center w-12">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectItem(item.id)}
                              className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-4 px-4 text-center font-bold text-stone-400">{idx + 1}</td>
                          <td className="py-4 px-4">
                            <span className="font-extrabold text-stone-900 block">{item.id_pasien}</span>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <div className="inline-flex gap-1.5 flex-wrap justify-center text-[10px] font-bold uppercase. tracking-wider">
                              {item.jumlah_obat_racik > 0 && (
                                <span className="bg-amber-50 text-amber-700 border border-amber-200/50 px-2 py-0.5 rounded-full">
                                  {item.jumlah_obat_racik} Racik
                                </span>
                              )}
                              {item.jumlah_obat_non_racik > 0 && (
                                <span className="bg-pink-50 text-pink-700 border border-pink-200/50 px-2 py-0.5 rounded-full">
                                  {item.jumlah_obat_non_racik} Non-Racik
                                </span>
                              )}
                              {item.jumlah_obat_racik === 0 && item.jumlah_obat_non_racik === 0 && (
                                <span className="text-stone-400 font-normal">-</span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-xs font-mono text-stone-500">
                            {format(parseISO(item.waktu_resep_masuk), 'HH:mm:ss')}
                          </td>
                          <td className="py-4 px-4 text-xs">
                            <div className="flex flex-col">
                              <span className="font-extrabold text-stone-800">{durationStr}</span>
                              {item.waktu_resep_selesai && (
                                <span className="text-[10px] text-stone-400 font-mono">
                                  Selesai: {format(parseISO(item.waktu_resep_selesai), 'HH:mm:ss')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center">
                            {item.status === 'menunggu' && (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-50 text-amber-600 border border-amber-200/20">
                                MENUNGGU
                              </span>
                            )}
                            {item.status === 'proses' && (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-50 text-blue-600 border border-blue-200/20">
                                PROSES
                              </span>
                            )}
                            {(item.status === 'selesai' || item.status === 'diserahkan') && (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-50 text-emerald-600 border border-emerald-200/20">
                                SELESAI
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              
                              {/* Progression buttons */}
                              {item.status === 'menunggu' && (
                                <button
                                  onClick={() => updateStatus(item, 'proses')}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
                                  title="Mulai Proses Peracikan"
                                >
                                  Proses
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                              
                              {item.status === 'proses' && (
                                <button
                                  onClick={() => updateStatus(item, 'selesai')}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
                                  title="Selesai Peracikan"
                                >
                                  Selesai
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              )}



                              {/* Delete triggers */}
                              <button
                                onClick={() => deleteItem(item.id)}
                                className="p-2 border border-black/5 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-xl transition-colors shrink-0"
                                title="Hapus Antrian"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>

                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>



      {showTrash && (
        <div id="trash-modal" className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-black/5 w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between bg-stone-50">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-black text-stone-900 tracking-tight">Keranjang Sampah (Antrian Terhapus)</h3>
              </div>
              <button 
                onClick={() => setShowTrash(false)}
                className="p-1 border border-black/5 hover:bg-stone-100 rounded-lg transition-colors text-stone-400 hover:text-stone-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body: List of deleted items */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <p className="text-xs text-stone-500 font-medium">
                Berikut adalah resep/pasien yang berada di Keranjang Sampah. Anda dapat memulihkannya kembali ke antrian aktif kapan saja.
              </p>

              <div className="border border-black/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-black/5 bg-stone-50 text-[10px] font-black uppercase text-stone-400 tracking-wider">
                        <th className="py-3 px-4 text-center">No</th>
                        <th className="py-3 px-4">Nama Pasien</th>
                        <th className="py-3 px-4 text-center">Info Obat</th>
                        <th className="py-3 px-4">Tanggal Masuk</th>
                        <th className="py-3 px-4 text-right">Tindakan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 text-xs font-medium text-stone-600">
                      {queues.filter(item => item.status_hapus).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-stone-400">
                            Keranjang sampah kosong.
                          </td>
                        </tr>
                      ) : (
                        queues.filter(item => item.status_hapus).map((item, idx) => (
                          <tr key={item.id} className="hover:bg-stone-50/50 transition-colors">
                            <td className="py-3 px-4 text-center font-bold text-stone-400">{idx + 1}</td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-stone-950 block">{item.id_pasien}</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {item.jumlah_obat_racik + item.jumlah_obat_non_racik} Obat
                            </td>
                            <td className="py-3 px-4 font-mono text-stone-400">
                              {format(parseISO(item.waktu_resep_masuk), 'yyyy-MM-dd HH:mm:ss')}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => restoreItem(item.id)}
                                  className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-extrabold transition-colors border border-emerald-200/50"
                                >
                                  Pulihkan
                                </button>
                                <button
                                  type="button"
                                  onClick={() => permanentlyDeleteItem(item.id)}
                                  className="p-1 px-1.5 text-stone-400 hover:text-red-650 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-lg transition-all"
                                  title="Hapus Permanen"
                                >
                                  <X className="w-3.5 h-3.5 text-red-500" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-stone-50 border-t border-black/5 flex items-center justify-between">
              {queues.some(item => item.status_hapus) ? (
                <button
                  type="button"
                  onClick={() => setEmptyTrashConfirmation(true)}
                  className="flex items-center gap-1.5 px-4 py-2 border border-red-200/60 bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 rounded-xl text-xs font-bold transition-all shadow-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Kosongkan Sampah
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setShowTrash(false)}
                className="px-4 py-2 bg-stone-900 border border-transparent hover:bg-stone-800 rounded-xl text-xs font-bold text-white transition-colors"
              >
                Tutup
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Avoids window.confirm in iframe) */}
      {deleteConfirmation && (
        <div id="delete-confirm-modal" className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-3xl border border-black/5 w-full max-w-sm shadow-2xl p-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center border border-red-100">
              <Trash2 className="w-5 h-5 animate-pulse" />
            </div>
            
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-stone-900 tracking-tight">
                {deleteConfirmation.isPermanent ? 'Hapus Permanen?' : 'Pindahkan ke Sampah?'}
              </h3>
              <p className="text-xs text-stone-500 font-medium">
                {deleteConfirmation.isPermanent 
                  ? `Apakah Anda yakin ingin menghapus antrian resep pasien "${deleteConfirmation.id_pasien}" secara PERMANEN? Tindakan ini tidak dapat dibatalkan.`
                  : `Apakah Anda yakin ingin memindahkan antrian resep pasien "${deleteConfirmation.id_pasien}" ke Keranjang Sampah?`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmation(null)}
                className="px-4 py-2 border border-black/5 rounded-xl text-xs font-bold text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetId = deleteConfirmation.id;
                  const isPerm = deleteConfirmation.isPermanent;
                  setDeleteConfirmation(null);
                  try {
                    if (isPerm) {
                      await deleteDoc(doc(db, 'queues', targetId));
                    } else {
                      await updateDoc(doc(db, 'queues', targetId), {
                        status_hapus: true
                      });
                    }
                  } catch (e) {
                    console.error("Gagal menghapus antrian:", e);
                  }
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Bulk Delete Confirmation Modal */}
      {bulkDeleteConfirmation && (
        <div id="bulk-delete-confirm-modal" className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-3xl border border-black/5 w-full max-w-sm shadow-2xl p-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center border border-red-100">
              <Trash2 className="w-5 h-5 animate-pulse" />
            </div>
            
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-stone-900 tracking-tight">
                Pindahkan ke Sampah ({selectedIds.length} Antrian)?
              </h3>
              <p className="text-xs text-stone-500 font-medium">
                Apakah Anda yakin ingin memindahkan <strong>{selectedIds.length}</strong> antrian resep pasien yang dipilih secara massal ke Keranjang Sampah?
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setBulkDeleteConfirmation(false)}
                className="px-4 py-2 border border-black/5 rounded-xl text-xs font-bold text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  setBulkDeleteConfirmation(false);
                  await bulkDeleteSelected();
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                Ya, Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty Trash Confirmation Modal */}
      {emptyTrashConfirmation && (
        <div id="empty-trash-confirm-modal" className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-3xl border border-black/5 w-full max-w-sm shadow-2xl p-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center border border-red-100">
              <Trash2 className="w-5 h-5 animate-pulse" />
            </div>
            
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-stone-900 tracking-tight">
                Kosongkan Keranjang Sampah?
              </h3>
              <p className="text-xs text-stone-500 font-medium">
                Apakah Anda yakin ingin menghapus <strong>seluruh</strong> antrian yang ada di Keranjang Sampah secara <strong>PERMANEN</strong>? Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEmptyTrashConfirmation(false)}
                className="px-4 py-2 border border-black/5 rounded-xl text-xs font-bold text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  await emptyTrashPool();
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                Ya, Kosongkan
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
