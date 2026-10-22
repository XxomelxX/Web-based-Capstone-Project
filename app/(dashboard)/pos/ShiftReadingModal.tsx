'use client';

import { useCallback, useEffect, useState } from 'react';
import { peso, parsePesosToCents } from '@/lib/money';
import { formatDateTime } from '@/lib/client/timeUtils';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { useOnline } from '@/components/providers/online-provider';
import {
  fetchCashMovements,
  recordCashMovement,
  deleteCashMovement,
  type CashMovement,
  type ShiftDetails,
} from '@/lib/client/api/shift';

type MovementAction = 'expense' | 'cash_in' | 'cash_out';

const ACTION_CONFIG: Record<MovementAction, { label: string; buttonClass: string; sign: '+' | '−'; amountClass: string }> = {
  expense: { label: 'Add Expense', buttonClass: 'bg-rose-600 hover:bg-rose-500', sign: '−', amountClass: 'text-rose-400' },
  cash_in: { label: 'Cash In', buttonClass: 'bg-emerald-600 hover:bg-emerald-500', sign: '+', amountClass: 'text-emerald-400' },
  cash_out: { label: 'Cash Out', buttonClass: 'bg-amber-600 hover:bg-amber-500', sign: '−', amountClass: 'text-amber-400' },
};

function movementBadgeClass(type: CashMovement['type']) {
  if (type === 'cash_in') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  if (type === 'cash_out') return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
}

function movementLabel(type: CashMovement['type']) {
  if (type === 'cash_in') return 'Cash In';
  if (type === 'cash_out') return 'Cash Out';
  return 'Expense';
}

/**
 * Shift Reading — live X-Read breakdown of the open shift plus the three
 * drawer movements: Add Expense, Cash In, Cash Out. Both roles can record;
 * only admins can delete (enforced server-side too). Works offline via the
 * cash_movement queue — the totals move optimistically from the cached shift.
 */
export function ShiftReadingModal({
  shift,
  isAdmin,
  onClose,
  onChanged,
}: {
  shift: ShiftDetails;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isOnline = useOnline();
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [action, setAction] = useState<MovementAction | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadMovements = useCallback(async () => {
    const list = await fetchCashMovements();
    setMovements(list);
    setLoadingList(false);
  }, []);

  // Initial load — fetch in an effect, setState only in the async completion
  // (the set-state-in-effect rule allows callbacks, not the effect body).
  useEffect(() => {
    let cancelled = false;
    fetchCashMovements()
      .then((list) => {
        if (cancelled) return;
        setMovements(list);
        setLoadingList(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates — another device (or the same drawer's admin view) recording
  // a movement refreshes this list. POSClient separately reloads the shift
  // totals from the 'shift' channel.
  useRealtime({
    shift: () => {
      loadMovements();
    },
  });

  const openAction = (next: MovementAction) => {
    setAction(next);
    setAmountInput('');
    setNoteInput('');
    setError(null);
  };

  const cancelAction = () => {
    setAction(null);
    setAmountInput('');
    setNoteInput('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!action) return;
    const amount = parsePesosToCents(Number.parseFloat(amountInput));
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Enter a valid amount greater than ₱0.00');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await recordCashMovement(action, amount, noteInput.trim() || undefined);
      cancelAction();
      onChanged(); // POSClient reloads shift totals (also refreshes the cache)
      await loadMovements();
      if (result.offline) {
        setError('Saved offline — will sync when the connection returns.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (movement: CashMovement) => {
    if (!window.confirm(`Delete this ${movementLabel(movement.type).toLowerCase()} of ${peso(movement.amount)}?`)) return;
    setDeletingId(movement.id);
    setError(null);
    try {
      await deleteCashMovement(movement.id);
      onChanged();
      await loadMovements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const cashIn = shift.cashIn ?? 0;
  const cashOut = shift.cashOut ?? 0;
  const expenses = shift.totalExpenses ?? 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
              <span></span> Shift Reading
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Opened {formatDateTime(shift.openedAt)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none" aria-label="Close">✕</button>
        </div>

        {/* Live X-Read breakdown */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Opening Float</span>
            <span className="font-medium">{peso(shift.openingFloat)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Cash Sales (+)</span>
            <span className="font-medium text-emerald-400">+{peso(shift.cashSales ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Debt Payments (+)</span>
            <span className="font-medium text-emerald-400">+{peso(shift.debtPayments ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Cash In (+)</span>
            <span className="font-medium text-emerald-400">+{peso(cashIn)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Cash Out (−)</span>
            <span className="font-medium text-amber-400">−{peso(cashOut)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Expenses (−)</span>
            <span className="font-medium text-rose-400">−{peso(expenses)}</span>
          </div>
          <hr className="border-slate-800 my-1" />
          <div className="flex justify-between font-bold text-slate-100">
            <span>Expected Cash in Drawer</span>
            <span className="text-cyan-400">{peso(shift.expectedCash ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-400 text-xs">
            <span>GCash Sales (memo)</span>
            <span>{peso(shift.gcashSales ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-400 text-xs">
            <span>Debt Collected Today</span>
            <span>{peso(shift.debtPaymentsToday ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-400 text-xs">
            <span>Transactions</span>
            <span>{shift.transactionCount ?? 0}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(ACTION_CONFIG) as MovementAction[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => openAction(key)}
              disabled={action !== null}
              className={`${ACTION_CONFIG[key].buttonClass} text-white rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-50`}
            >
              {ACTION_CONFIG[key].label}
            </button>
          ))}
        </div>

        {action && (
          <form onSubmit={handleSubmit} className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {ACTION_CONFIG[action].label}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Amount (₱)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                autoFocus
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-cyan-400 outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Note (Optional)</label>
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder={action === 'expense' ? 'Ice, sacks, load…' : action === 'cash_in' ? 'Added from safe…' : 'Withdrew for deposit…'}
                maxLength={200}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            {error && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">{error}</div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={cancelAction} className="flex-1 border border-slate-700 rounded-xl py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
              <button type="submit" disabled={saving} className={`flex-1 ${ACTION_CONFIG[action].buttonClass} text-white rounded-xl py-2 text-sm font-semibold transition disabled:opacity-60`}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {error && !action && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">{error}</div>
        )}
        {!isOnline && (
          <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg">
            Offline — entries are queued and will sync automatically. The movement list loads once back online.
          </div>
        )}

        {/* Movements list */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Movements</div>
          {loadingList ? (
            <p className="text-xs text-slate-500 text-center py-3">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-3">
              {isOnline ? 'No cash movements yet this shift.' : 'List unavailable offline.'}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {movements.map((m) => (
                <div key={m.id} className="flex items-center gap-3 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${movementBadgeClass(m.type)}`}>
                    {movementLabel(m.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-200 truncate">{m.note || '—'}</p>
                    <p className="text-[10px] text-slate-500">
                      {formatDateTime(m.createdAt)}{m.user?.fullName ? ` · ${m.user.fullName}` : ''}
                    </p>
                  </div>
                  <span className={`font-semibold ${m.type === 'cash_in' ? 'text-emerald-400' : m.type === 'cash_out' ? 'text-amber-400' : 'text-rose-400'}`}>
                    {m.type === 'cash_in' ? '+' : '−'}{peso(m.amount)}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDelete(m)}
                      disabled={deletingId === m.id}
                      className="text-slate-500 hover:text-rose-400 text-xs px-1 disabled:opacity-50"
                      title="Delete (admin only)"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={onClose} className="w-full border border-slate-700 rounded-xl py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800">
          Close
        </button>
      </div>
    </div>
  );
}
