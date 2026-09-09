const SYNC_TIME_KEY = 'sari-sari-last-sync';

export function formatTime(date?: Date | string): string {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateTime(date?: Date | string): string {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  return d.toLocaleString();
}

export function formatDate(date?: Date | string): string {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  return d.toLocaleDateString();
}

export function setLastSyncTime(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SYNC_TIME_KEY, new Date().toISOString());
  }
}

export function getLastSyncTime(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SYNC_TIME_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return formatTime(d);
}

export function getLastSyncTimeFull(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SYNC_TIME_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return formatDateTime(d);
}
