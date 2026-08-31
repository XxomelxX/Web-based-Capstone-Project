'use client';

import { useEffect, useState } from 'react';
import { useOfflineSync } from '@/lib/useOfflineSync';
import { getAllQueuedCategory1Actions } from '@/lib/offlineQueue';
import type { QueuedCategory1Action } from '@/lib/offlineQueue';

export function OfflineSyncModal({ onClose }: { onClose: () => void }) {
  const { online, queuedCount, failedCount, syncing, syncQueue } = useOfflineSync();
  const [queuedItems, setQueuedItems] = useState<QueuedCategory1Action[]>([]);

  useEffect(() => {
    getAllQueuedCategory1Actions().then(setQueuedItems);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-gray-900">
        <div className="flex justify-between items-center border-b border-gray-200 pb-3">
          <h3 className="font-bold text-base flex items-center gap-2">
            <span>🔄</span> Category 1 Offline Queue &amp; Sync Review
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="text-xs flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-200">
          <div>
            Status:{' '}
            <strong className={online ? 'text-green-600' : 'text-amber-600'}>
              {online ? '🟢 Connected' : '🟡 Offline Mode'}
            </strong>
          </div>
          <div>
            Category 1 Queued: <strong className="text-cyan-600">{queuedCount}</strong>
          </div>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1 text-xs">
          {queuedItems.length === 0 ? (
            <p className="text-gray-500 text-center py-6">
              No pending Category 1 offline actions in queue. All data synced!
            </p>
          ) : (
            queuedItems.map((item, idx) => {
              const title =
                item.type === 'pos_sale'
                  ? 'POS Complete Sale'
                  : item.type === 'add_utang'
                  ? 'Utang — Add Utang'
                  : 'Utang — Record Payment';

              const detail =
                item.type === 'pos_sale'
                  ? `Items: ${item.payload.items?.length || 0} · Method: ${item.payload.paymentMethod}`
                  : item.type === 'add_utang'
                  ? `Customer: ${item.payload.customerName} · Items: ${item.payload.items?.length || 0}`
                  : `Customer: ${item.payload.customerName} · Amount: ₱${item.payload.amount?.toFixed(2) || '0.00'}`;

              return (
                <div key={idx} className="bg-gray-50 border border-gray-200 p-3 rounded-xl space-y-1">
                  <div className="flex justify-between font-bold">
                    <span className="text-gray-800">{title}</span>
                    <span
                      className={
                        item.syncFailed
                          ? 'text-red-600'
                          : item.synced
                          ? 'text-green-600'
                          : 'text-amber-600'
                      }
                    >
                      {item.syncFailed
                        ? '⚠️ Sync Failed (Admin Review)'
                        : item.synced
                        ? '✓ Synced'
                        : '🟡 Pending Sync'}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 flex justify-between">
                    <span>{detail}</span>
                    <span>
                      {new Date(item.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {item.errorMessage && (
                    <div className="text-[10px] text-red-700 bg-red-50 p-1.5 rounded border border-red-200">
                      {item.errorMessage}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={async () => {
              await syncQueue();
              setQueuedItems(await getAllQueuedCategory1Actions());
            }}
            disabled={!online || syncing}
            className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl py-2 text-xs font-semibold transition disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : '🔄 Force Sync Queue Now'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="border border-gray-300 rounded-xl px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
