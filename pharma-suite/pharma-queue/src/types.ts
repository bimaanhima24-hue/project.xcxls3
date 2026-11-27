export interface QueueItem {
  id: string;
  id_pasien: string;
  jumlah_obat_racik: number;
  jumlah_obat_non_racik: number;
  waktu_resep_masuk: string; // ISO String
  waktu_resep_selesai?: string; // ISO String
  waktu_obat_diserahkan?: string; // ISO String
  status: 'menunggu' | 'proses' | 'selesai' | 'diserahkan';
  uid: string;
  status_hapus?: boolean;
}
