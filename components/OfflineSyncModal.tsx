'use client';

import { useEffect, useState } from 'react';
import { useOnline } from '@/components/providers/online-provider';
import { getAllQueuedCategory1Actions, retryAdminBlockedActions } from '@/lib/client/offlineQueue';
import type { QueuedCategory1Action } from '@/lib/client/offlineQueue';
import { peso } from '@/lib/money';

const actionTitles: Record<QueuedCategory1Action['type'], string> = {
  pos_sale: 'POS Complete Sale',
  add_utang: 'Utang — Add Utang',
  record_payment: 'Utang — Record Payment',
  open_shift: 'Shift — Open Shift',
  close_shift: 'Shift — Close Shift',
  cash_movement: 'Shift — Cash Movement',
  product_upsert: 'Product — Update Product',
  product_delete: 'Product — Delete Product',
  category_upsert: 'Category — Update Category',
  category_delete: 'Category — Delete Category',
  expense_add: 'Expense — Add Expense',
  settings_update: 'Settings — Update Settings',
  customer_add: 'Customer — Add Customer',
  void_sale: 'Sale — Void Sale',
  void_request: 'Void Request — Create',
  void_request_cancel: 'Void Request — Cancel',
  void_review: 'Void Request — Review',
  utang_update_deadline: 'Utang — Update Due Date',
  restock: 'Inventory — Restock',
};

export function OfflineSyncModal({ onClose }: { onClose: () => void }) {
  const { isOnline, pendingCount, failedCount, isSyncing, syncNow } = useOnline();
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
            <strong className={isOnline ? 'text-green-600' : 'text-amber-600'}>
              {isOnline ? '🟢 Connected' : '🟡 Offline Mode'}
            </strong>
          </div>
          <div className="flex gap-3">
            <span>Pending: <strong className="text-cyan-600">{pendingCount}</strong></span>
            <span>Failed: <strong className="text-red-600">{failedCount}</strong></span>
          </div>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1 text-xs">
          {queuedItems.length === 0 ? (
            <p className="text-gray-500 text-center py-6">
              No offline actions in queue. All data synced!
            </p>
          ) : (
            queuedItems.map((item, idx) => {
              const title = actionTitles[item.type];
              const detail = item.type === 'pos_sale'
                ? `Items: ${item.payload.items?.length || 0} · Method: ${item.payload.paymentMethod}`
                : item.type === 'add_utang'
                ? `Customer: ${item.payload.customerName} · Items: ${item.payload.items?.length || 0}`
                : item.type === 'record_payment'
                ? `Customer: ${item.payload.customerName} · Amount: ${peso(item.payload.amount ?? 0)}`
                : item.type === 'open_shift'
                ? `Float: ${peso(item.payload.openingFloat ?? 0)}`
                : item.type === 'close_shift'
                ? item.payload.closingCash !== undefined && item.payload.closingCash !== null
                  ? `Cash: ${peso(item.payload.closingCash)}`
                  : 'No physical count'
                : item.type === 'cash_movement'
                ? `${(item.payload.movementType ?? 'movement').replace('_', ' ')} · ${peso(item.payload.amount ?? 0)}`
                : '';
              const needsAdmin = item.errorMessage?.startsWith('Admin only') ?? false;

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
                        ? needsAdmin ? '⚠️ Needs Admin Sync' : '⚠️ Sync Failed'
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
              await retryAdminBlockedActions();
              await syncNow();
              setQueuedItems(await getAllQueuedCategory1Actions());
            }}
            disabled={!isOnline || isSyncing}
            className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl py-2 text-xs font-semibold transition disabled:opacity-50"
          >
            {isSyncing ? 'Syncing...' : '🔄 Force Sync Queue Now'}
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
