'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getProducts, Product } from '@/lib/api/products';
import { checkout, CheckoutResult } from '@/lib/api/pos';
import { getSettings } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { ShiftDetails, ZReadSummary, fetchActiveShift, openShift, closeShift } from '@/lib/api/shift';

interface CartLine {
  product: Product;
  quantity: number;
}

interface StoreSettings {
  storeName: string;
  address?: string;
}

export default function POSClient() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'gcash'>('cash');
  const [tendered, setTendered] = useState(0);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>({ storeName: 'Store' });

  // Shift & Cash Drawer State
  const [activeShift, setActiveShift] = useState<ShiftDetails | null>(null);
  const [loadingShift, setLoadingShift] = useState(true);
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [zReadReceipt, setZReadReceipt] = useState<ZReadSummary | null>(null);
  const [openFloatInput, setOpenFloatInput] = useState<string>('1000');
  const [closeCashInput, setCloseCashInput] = useState<string>('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftActionLoading, setShiftActionLoading] = useState(false);
  const [shiftError, setShiftError] = useState('');

  function loadShiftData() {
    setLoadingShift(true);
    fetchActiveShift().then((shift) => {
      setActiveShift(shift);
      setLoadingShift(false);
      if (!shift) {
        setShowOpenShiftModal(true);
      }
    });
  }

  function refresh() {
    getProducts().then(setProducts);
    getSettings<StoreSettings>().then(setSettings);
    loadShiftData();
  }

  useRealtime({
    products: refresh,
    settings: refresh,
  });

  useEffect(refresh, []);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode === search
  );

  function addToCart(product: Product) {
    if (!activeShift) {
      setShowOpenShiftModal(true);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  function changeCartQuantity(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.product.id === productId
            ? { ...l, quantity: Math.max(0, l.quantity + delta) }
            : l
        )
        .filter((l) => l.quantity > 0)
    );
  }

  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);
  const total = cart.reduce((s, l) => s + l.quantity * l.product.price, 0);
  const change = tendered - total;

  async function handleCompleteSale() {
    if (!activeShift) {
      setError('Please open a shift before completing transactions.');
      setShowOpenShiftModal(true);
      return;
    }
    setError('');
    setProcessing(true);
    try {
      const finalTendered = paymentMethod === 'gcash' ? (tendered >= total ? tendered : total) : tendered;
      const result = await checkout(
        cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.product.price })),
        paymentMethod,
        finalTendered
      );
      setReceipt(result);
      setCart([]);
      setTendered(0);
      getProducts().then(setProducts);
      // Refresh shift live totals
      fetchActiveShift().then(setActiveShift);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  }

  async function handleOpenShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShiftError('');
    setShiftActionLoading(true);
    const amount = parseFloat(openFloatInput) || 0;
    const res = await openShift(amount, shiftNotes);
    setShiftActionLoading(false);
    if (!res.success) {
      setShiftError(res.error || 'Failed to open shift');
      return;
    }
    setShowOpenShiftModal(false);
    loadShiftData();
  }

  async function handleCloseShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShiftError('');
    setShiftActionLoading(true);
    const counted = parseFloat(closeCashInput) || 0;
    const res = await closeShift(counted, shiftNotes);
    setShiftActionLoading(false);
    if (!res.success) {
      setShiftError(res.error || 'Failed to close shift');
      return;
    }
    setShowEndShiftModal(false);
    setActiveShift(null);
    if (res.summary) {
      setZReadReceipt(res.summary);
    }
  }

  // Calculate live variance in End Shift Modal
  const expectedCashAmount = activeShift?.expectedCash ?? 0;
  const countedCashAmount = parseFloat(closeCashInput) || 0;
  const varianceAmount = countedCashAmount - expectedCashAmount;

  return (
    <div className="space-y-4">
      {/* Shift Header Status Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${activeShift ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <div>
            <div className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>{activeShift ? 'Shift Active' : 'No Open Shift'}</span>
              {activeShift && (
                <span className="text-xs font-normal text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  Opened {new Date(activeShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1 mt-0.5">
              <span>Float: <strong className="text-slate-200">₱{(activeShift?.openingFloat ?? 0).toFixed(2)}</strong></span>
              <span>Cash Sales: <strong className="text-slate-200">₱{(activeShift?.cashSales ?? 0).toFixed(2)}</strong></span>
              <span>GCash Sales: <strong className="text-slate-200">₱{(activeShift?.gcashSales ?? 0).toFixed(2)}</strong></span>
              <span>Expected Cash: <strong className="text-cyan-400">₱{(activeShift?.expectedCash ?? 0).toFixed(2)}</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!activeShift ? (
            <button
              onClick={() => {
                setShiftError('');
                setShowOpenShiftModal(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-emerald-950/30"
            >
              + Open Cash Drawer Shift
            </button>
          ) : (
            <button
              onClick={() => {
                setShiftError('');
                setCloseCashInput('');
                setShowEndShiftModal(true);
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-rose-950/30 flex items-center gap-1.5"
            >
              🔒 End Shift (Z-Read)
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h1 className="text-2xl font-bold">Point Of Sale</h1>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Input a Product or Click a Product and press enter..."
            className="w-full border rounded-md px-4 py-3 bg-white"
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={p.stock <= 0}
                className="bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition disabled:opacity-40"
              >
                <div className="font-medium text-sm">{p.name}</div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-green-700 font-bold">₱{p.price}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.stock < 20 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    {p.stock} stk
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-5 space-y-4 h-fit sticky top-4">
          <div className="flex justify-between items-center">
            <h2 className="font-bold">Cart</h2>
            <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{totalItems} items</span>
          </div>

          {cart.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Cart is empty. Input a product to start.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.product.id} className="flex justify-between items-center text-sm">
                  <div>
                    <div>{l.product.name}</div>
                    <div className="text-xs text-gray-500">Qty: {l.quantity}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => changeCartQuantity(l.product.id, -1)}
                      className="w-7 h-7 rounded-md border text-sm"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => changeCartQuantity(l.product.id, 1)}
                      className="w-7 h-7 rounded-md border text-sm"
                    >
                      +
                    </button>
                    <span className="min-w-[70px] text-right">₱{(l.quantity * l.product.price).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-3 space-y-1 text-sm">
            <div className="flex justify-between font-bold text-lg text-orange-700"><span>Total</span><span>₱{total.toFixed(2)}</span></div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Payment Method</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPaymentMethod('cash')}
                className={`border rounded-md py-2 text-sm ${paymentMethod === 'cash' ? 'bg-green-700 text-white' : ''}`}
              >
                Cash
              </button>
              <button
                onClick={() => {
                  setPaymentMethod('gcash');
                  setTendered(total);
                }}
                className={`border rounded-md py-2 text-sm ${paymentMethod === 'gcash' ? 'bg-green-700 text-white' : ''}`}
              >
                GCash
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">
              {paymentMethod === 'cash' ? 'Cash Tendered' : 'GCash Reference #'}
            </label>
            <input
              type="number"
              value={tendered || ''}
              onChange={(e) => setTendered(Number(e.target.value))}
              className="w-full border rounded-md px-3 py-2 mt-1"
              placeholder={paymentMethod === 'cash' ? '0.00' : 'Reference Number'}
            />
          </div>

          <div className="flex justify-between text-sm">
            <span>Change</span>
            <span className="font-semibold">₱{paymentMethod === 'cash' && change > 0 ? change.toFixed(2) : '0.00'}</span>
          </div>

          {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-2 rounded border border-red-200">{error}</p>}

          <button
            onClick={handleCompleteSale}
            disabled={cart.length === 0 || (paymentMethod === 'cash' && tendered < total) || processing || !activeShift}
            className="w-full bg-green-700 hover:bg-green-600 text-white rounded-md py-3 font-medium disabled:opacity-40 transition"
          >
            {processing ? 'Processing...' : !activeShift ? 'Open Shift to Complete Sale' : '✓ Complete Sale'}
          </button>
        </div>

        {/* Sale Receipt Modal */}
        {receipt && (
          <ReceiptModal
            receipt={receipt}
            cashierName={session?.user?.name ?? ''}
            storeName={settings.storeName}
            storeAddress={settings.address ?? ''}
            onClose={() => setReceipt(null)}
          />
        )}

        {/* Open Shift Modal */}
        {showOpenShiftModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                  <span>💼</span> Open Cash Drawer Shift
                </h3>
                {activeShift && (
                  <button onClick={() => setShowOpenShiftModal(false)} className="text-slate-400 hover:text-slate-200">✕</button>
                )}
              </div>

              <p className="text-xs text-slate-400">
                Enter your starting cash float in the cash drawer to activate your register shift.
              </p>

              <form onSubmit={handleOpenShiftSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Opening Cash Float (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={openFloatInput}
                    onChange={(e) => setOpenFloatInput(e.target.value)}
                    placeholder="1000.00"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg font-bold text-cyan-400 outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Shift Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={shiftNotes}
                    onChange={(e) => setShiftNotes(e.target.value)}
                    placeholder="Morning shift / Register 1"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                </div>

                {shiftError && (
                  <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">
                    {shiftError}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {activeShift && (
                    <button
                      type="button"
                      onClick={() => setShowOpenShiftModal(false)}
                      className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={shiftActionLoading}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-60"
                  >
                    {shiftActionLoading ? 'Starting Shift...' : '✓ Start Register Shift'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* End Shift / Z-Read Reconciliation Modal */}
        {showEndShiftModal && activeShift && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                  <span>🔒</span> End Shift & Z-Read Reconciliation
                </h3>
                <button onClick={() => setShowEndShiftModal(false)} className="text-slate-400 hover:text-slate-200">✕</button>
              </div>

              {/* X-Read Live Summary */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2 text-sm">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Live X-Read Summary</div>
                <div className="flex justify-between text-slate-300">
                  <span>Opening Cash Float</span>
                  <span className="font-medium">₱{activeShift.openingFloat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Cash Sales (+)</span>
                  <span className="font-medium text-emerald-400">+₱{(activeShift.cashSales ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>GCash Sales</span>
                  <span className="font-medium text-sky-400">₱{(activeShift.gcashSales ?? 0).toFixed(2)}</span>
                </div>
                <hr className="border-slate-800 my-1" />
                <div className="flex justify-between font-bold text-slate-100">
                  <span>Expected Cash in Drawer</span>
                  <span className="text-cyan-400">₱{expectedCashAmount.toFixed(2)}</span>
                </div>
              </div>

              <form onSubmit={handleCloseShiftSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1">
                    Counted Physical Cash in Drawer (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={closeCashInput}
                    onChange={(e) => setCloseCashInput(e.target.value)}
                    placeholder="Enter physical cash counted"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-xl font-bold text-emerald-400 outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Live Variance Calculation Badge */}
                {closeCashInput !== '' && (
                  <div className={`p-3 rounded-xl border flex justify-between items-center ${
                    varianceAmount === 0
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : varianceAmount > 0
                      ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}>
                    <span className="text-xs font-semibold">
                      {varianceAmount === 0 ? '✓ Exact Match (Balanced)' : varianceAmount > 0 ? '🟢 Cash Overage' : '🔴 Cash Shortage'}
                    </span>
                    <span className="font-bold text-base">
                      {varianceAmount >= 0 ? `+₱${varianceAmount.toFixed(2)}` : `-₱${Math.abs(varianceAmount).toFixed(2)}`}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    End of Shift Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={shiftNotes}
                    onChange={(e) => setShiftNotes(e.target.value)}
                    placeholder="All cash reconciled / Minor shortage"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                </div>

                {shiftError && (
                  <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">
                    {shiftError}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEndShiftModal(false)}
                    className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={shiftActionLoading || closeCashInput === ''}
                    className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-60"
                  >
                    {shiftActionLoading ? 'Closing Shift...' : 'Close Shift & Z-Read'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Z-Read Shift Summary Receipt Modal */}
        {zReadReceipt && (
          <ZReadModal
            summary={zReadReceipt}
            cashierName={session?.user?.name ?? ''}
            storeName={settings.storeName}
            onClose={() => setZReadReceipt(null)}
          />
        )}
      </div>
    </div>
  );
}

function ReceiptModal({
  receipt,
  cashierName,
  storeName,
  storeAddress,
  onClose,
}: {
  receipt: CheckoutResult;
  cashierName: string;
  storeName: string;
  storeAddress: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 font-mono text-xs text-slate-100 space-y-2">
        <div className="flex justify-between items-start">
          <div className="w-full text-center">
            <h3 className="font-bold text-base text-cyan-400">{storeName}</h3>
            {storeAddress && <p className="text-xs text-slate-400">{storeAddress}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-sans font-bold text-lg">✕</button>
        </div>
        <hr className="border-dashed border-slate-800 my-2" />
        <div className="flex justify-between"><span className="text-slate-400">Receipt #</span><span className="font-bold text-slate-100">{receipt.id}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Date</span><span>{new Date(receipt.createdAt).toLocaleString()}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Cashier</span><span>{cashierName}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Payment</span><span className="capitalize font-bold text-cyan-400">{receipt.paymentMethod}</span></div>
        <hr className="border-dashed border-slate-800 my-1" />
        <div className="flex justify-between"><span className="text-slate-400">Subtotal</span><span>₱{receipt.subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">VAT</span><span>₱{receipt.vat.toFixed(2)}</span></div>
        <div className="flex justify-between font-bold text-sm text-slate-100"><span>Total</span><span className="text-emerald-400">₱{receipt.total.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Tendered</span><span>₱{receipt.tendered.toFixed(2)}</span></div>
        <div className="flex justify-between font-bold text-cyan-300"><span>Change</span><span>₱{receipt.change.toFixed(2)}</span></div>
        
        {receipt.offline && (
          <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl p-2 text-center text-[11px] font-bold text-amber-300">
            🟡 Saved Offline — will sync automatically once online
          </div>
        )}

        <div className="mt-4 text-xs text-slate-400 text-center border-t border-dashed border-slate-800 pt-2">
          Thank you for your purchase!
        </div>

        <div className="pt-3 flex gap-2 font-sans print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl py-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950/40"
          >
            🖨️ Print Receipt
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl py-2.5 text-xs font-bold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ZReadModal({
  summary,
  cashierName,
  storeName,
  onClose,
}: {
  summary: ZReadSummary;
  cashierName: string;
  storeName: string;
  onClose: () => void;
}) {
  const discrepancy = summary.overageShortage;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3 text-gray-900">
        <div className="text-center border-b pb-3">
          <h3 className="font-bold text-lg">{storeName}</h3>
          <p className="text-xs font-semibold text-gray-500 tracking-wide uppercase">Z-READ SHIFT REPORT</p>
        </div>

        <div className="text-sm space-y-1">
          <Row label="Cashier" value={cashierName} bold />
          <Row label="Shift Opened" value={new Date(summary.openedAt).toLocaleString()} />
          <Row label="Shift Closed" value={new Date(summary.closedAt).toLocaleString()} />
        </div>

        <hr className="border-slate-200" />

        <div className="text-sm space-y-1">
          <Row label="Opening Float" value={`₱${summary.openingFloat.toFixed(2)}`} />
          <Row label="Cash Sales" value={`₱${summary.cashSales.toFixed(2)}`} />
          <Row label="GCash Sales" value={`₱${summary.gcashSales.toFixed(2)}`} />
          <Row label="Total Sales" value={`₱${summary.totalSales.toFixed(2)}`} bold />
        </div>

        <hr className="border-slate-200" />

        <div className="text-sm space-y-1">
          <Row label="Expected Cash" value={`₱${summary.expectedCash.toFixed(2)}`} />
          <Row label="Counted Cash" value={`₱${summary.closingCash.toFixed(2)}`} />
        </div>

        <div className={`text-center rounded-md py-2 font-bold ${
          discrepancy === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
        }`}>
          {discrepancy === 0
            ? `BALANCED (₱0.00)`
            : `${discrepancy > 0 ? 'OVER' : 'SHORT'} (₱${Math.abs(discrepancy).toFixed(2)})`}
        </div>

        <div className="flex gap-2 pt-2">
          <button className="flex-1 border rounded-md py-2 text-sm">🖨 Print Z-Read</button>
          <button onClick={onClose} className="flex-1 bg-green-700 text-white rounded-md py-2 text-sm">Done</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : 'text-gray-700'}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

