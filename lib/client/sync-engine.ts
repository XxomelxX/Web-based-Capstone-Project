// Sync engine: push pending batch → pull delta → merge (blog §10).
// Server-wins conflicts; exponential backoff 1s→2s→4s→8s→16s, max 5.
import { getPendingActions, markActionSynced, markActionFailed, offlineDb } from '@/lib/client/offlineQueue';
import { saveProducts, saveCategories, saveCachedCustomers, saveSettings, saveUtangEntries, getLastSyncedAt, setLastSyncedAt } from '@/lib/client/offline';

let retryCount = 0;
const MAX_RETRIES = 5;

export function calculateBackoff(): number {
  return Math.min(1000 * Math.pow(2, retryCount), 16000);
}
export function shouldRetry(): boolean { return retryCount < MAX_RETRIES; }
export function getRetryDelay(): number { return calculateBackoff(); }
export function incrementRetry(): void { retryCount++; }
export function resetRetries(): void { retryCount = 0; }
export function getRetryCount(): number { return retryCount; }

export interface SyncResult { success: boolean; synced: number; conflicts: number; syncedAt: string; error?: string }

export async function performSync(): Promise<SyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const pending = await getPendingActions();
    let synced = 0;
    let conflicts = 0;

    if (pending.length > 0) {
      // Backfill: rows queued before clientUuid existed get ONE permanent key
      // persisted to Dexie first, so all retries reuse it (no duplicates).
      for (const a of pending) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (a.id && !(a.payload as any)?.clientUuid) {
          const clientUuid = crypto.randomUUID();
          await offlineDb.queuedActions.update(a.id, {
            payload: { ...a.payload, clientUuid },
          });
          a.payload = { ...a.payload, clientUuid };
        }
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          actions: pending.map((a) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clientUuid: (a.payload as any)?.clientUuid as string,
            type: a.type,
            payload: a.payload,
            createdAt: a.createdAt,
          })),
        }),
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
      const data = await res.json() as {
        results: { clientUuid: string; ok: boolean; serverId?: number; conflict?: boolean; error?: string }[];
      };
      // Map results back to queue rows by order (server echoes clientUuid)
      const byUuid = new Map(data.results.map((r) => [r.clientUuid, r]));
      for (const action of pending) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uuid = (action.payload as any)?.clientUuid as string | undefined;
        const r = uuid ? byUuid.get(uuid) : undefined;
        if (!action.id) continue;
        if (r?.ok) {
          await markActionSynced(action.id);
          synced++;
          if (r.conflict) conflicts++;
        } else {
          await markActionFailed(action.id, r?.error ?? 'Sync rejected');
          if (r?.conflict) conflicts++;
        }
      }
    }

    // Pull delta: products (delta) + categories/customers/settings (full) (server-wins merge)
    const lastSynced = await getLastSyncedAt();
    const pullController = new AbortController();
    const pullTimeout = setTimeout(() => pullController.abort(), 30000);
    const pullRes = await fetch(`/api/sync/pull${lastSynced ? `?since=${encodeURIComponent(lastSynced)}` : ''}`, { cache: 'no-store', signal: pullController.signal });
    clearTimeout(pullTimeout);
    if (pullRes.ok) {
      const pull = await pullRes.json() as {
        products: Record<string, unknown>[];
        categories: Record<string, unknown>[];
        customers: Record<string, unknown>[];
        utang: Record<string, unknown>[];
        settings: Record<string, unknown> | null;
        syncedAt: string;
      };
      if (pull.products) await saveProducts(pull.products);
      if (pull.categories) await saveCategories(pull.categories);
      if (pull.customers) await saveCachedCustomers(pull.customers);
      if (pull.utang) await saveUtangEntries(pull.utang);
      if (pull.settings) await saveSettings(pull.settings);
      await setLastSyncedAt(pull.syncedAt ?? syncedAt);
    }

    resetRetries();
    return { success: true, synced, conflicts, syncedAt };
  } catch (e) {
    return { success: false, synced: 0, conflicts: 0, syncedAt, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function checkConnectivity(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`/api/health?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}
