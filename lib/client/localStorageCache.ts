import { formatTime, setLastSyncTime } from '@/lib/client/timeUtils';

export interface CachedData<T> {
  data: T;
  cachedAt: string; // ISO string
}

const PREFIX = 'sari_pos_cache_';

export function saveCategory2Cache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CachedData<T> = {
      data,
      cachedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(payload));
    setLastSyncTime();
  } catch (error) {
    console.warn(`Failed to save Category 2 cache for key ${key}:`, error);
  }
}

export function getCategory2Cache<T>(
  key: string
): { data: T | null; cachedAt: string | null; formattedTime: string | null } {
  if (typeof window === 'undefined') {
    return { data: null, cachedAt: null, formattedTime: null };
  }
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return { data: null, cachedAt: null, formattedTime: null };
    const parsed = JSON.parse(raw) as CachedData<T>;
    return {
      data: parsed.data ?? null,
      cachedAt: parsed.cachedAt ?? null,
      formattedTime: parsed.cachedAt ? formatTime(parsed.cachedAt) : null,
    };
  } catch (error) {
    console.warn(`Failed to read Category 2 cache for key ${key}:`, error);
    return { data: null, cachedAt: null, formattedTime: null };
  }
}
