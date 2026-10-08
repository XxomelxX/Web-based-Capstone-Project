// Sync engine: push pending batch → pull delta → merge (blog §10).
// Server-wins conflicts; exponential backoff 1s→2s→4s→8s→16s, max 5.
import { getPendingActions, markActionSynced, markActionFailed, offlineDb } from '@/lib/client/offlineQueue';
import { mergeProducts, saveCategories, saveCachedCustomers, saveSettings, saveUtangEntries, saveExpenses, mergeTransactions, mergeItemLog, mergeVoidRequests, getCachedVoidRequests, removeCachedVoidRequest, getLastSyncedAt, setLastSyncedAt, db as offlineCache } from '@/lib/client/offline';

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
          // Drop the optimistic temp row (negative id) — the real server row
          // arrives via pull/merge in this same sync.
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pl = (action as any)?.payload as { tempId?: number; table?: string } | undefined;
            if (pl?.tempId && pl?.table && (offlineCache as unknown as Record<string, { delete?: (k: number) => Promise<void> }>)[pl.table]?.delete) {
              await (offlineCache as unknown as Record<string, { delete: (k: number) => Promise<void> }>)[pl.table].delete(pl.tempId);
            }
            // Void-request temp mirror rows (negative ids keyed by clientUuid):
            // the server row arrives via pull in this same sync.
            if (action.type === 'void_request' && uuid) {
              const local = await getCachedVoidRequests();
              for (const row of local) {
                if (row.id < 0 && row.clientUuid === uuid) {
                  await removeCachedVoidRequest(row.id);
                }
              }
            }
            // Reviewed/cancelled requests leave the pending set — drop the mirror.
            if ((action.type === 'void_review' || action.type === 'void_request_cancel') && action.id) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const vid = (action.payload as any)?.voidRequestId as number | undefined;
              if (typeof vid === 'number') await removeCachedVoidRequest(vid);
            }
          } catch { /* temp cleanup best-effort */ }
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
        expenses?: Record<string, unknown>[];
        transactions?: Record<string, unknown>[];
        itemlog?: Record<string, unknown>[];
        voidRequests?: Record<string, unknown>[];
        settings: Record<string, unknown> | null;
        syncedAt: string;
      };
      // Delta pull: upsert only — partial lists must never
      // replace (clear) the whole table.
      if (pull.products) await mergeProducts(pull.products);
      if (pull.categories) await saveCategories(pull.categories);
      if (pull.customers) await saveCachedCustomers(pull.customers);
      if (pull.utang) await saveUtangEntries(pull.utang);
      if (pull.expenses) await saveExpenses(pull.expenses);
      if (pull.transactions) await mergeTransactions(pull.transactions);
      if (pull.itemlog) await mergeItemLog(pull.itemlog);
      if (pull.settings) await saveSettings(pull.settings);
      if (pull.voidRequests) {
        // Server is truth for reviewed requests: drop local mirror rows that
        // are no longer pending, then upsert the pending set.
        try {
          const serverIds = new Set(pull.voidRequests.map((r) => (r as { id?: unknown }).id));
          const local = await getCachedVoidRequests();
          for (const row of local) {
            if (typeof row.id === 'number' && row.id > 0 && !serverIds.has(row.id) && !row.pendingSync) {
              await removeCachedVoidRequest(row.id);
            }
          }
        } catch { /* mirror cleanup best-effort */ }
        await mergeVoidRequests(pull.voidRequests
          .map((r) => {
            const row = r as Record<string, unknown>;
            const txn = (row.transaction ?? {}) as Record<string, unknown>;
            const cashier = (txn.cashier ?? {}) as Record<string, unknown>;
            const id = Number(row.id);
            const transactionId = Number(row.transactionId);
            if (!Number.isInteger(id) || !Number.isInteger(transactionId)) return null;
            const st = row.status;
            return {
              id,
              clientUuid: typeof row.clientUuid === 'string' ? row.clientUuid : undefined,
              transactionId,
              reason: typeof row.reason === 'string' ? row.reason : '',
              requestedBy: Number(row.requestedBy) || 0,
              requestedAt: typeof row.requestedAt === 'string' ? row.requestedAt : new Date().toISOString(),
              status: (st === 'pending' || st === 'approved' || st === 'rejected' || st === 'cancelled' ? st : 'pending') as 'pending' | 'approved' | 'rejected' | 'cancelled',
              cashierName: typeof cashier.fullName === 'string' ? cashier.fullName : undefined,
              orderTotal: typeof txn.total === 'number' ? txn.total : undefined,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null));
      }
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
