'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useCurrentUser } from '@/lib/client/hooks/useCurrentUser';
import { formatTime, formatDateTime } from '@/lib/client/timeUtils';
import { getActiveProducts, Product } from '@/lib/client/api/products';
import { checkout, CheckoutResult } from '@/lib/client/api/pos';
import { getSettings, getCustomersLight, recordUtangPayment, getFifoBatches } from '@/lib/client/api/inventory';
import {
  effectivePrice,
  lineTotalOf,
  previewSlices,
  type FifoBatchWithPrice,
  type PriceableProduct,
} from '@/lib/client/pos-pricing';
import { addUtangOffline } from '@/lib/client/api/offline';
import { getCachedCustomers, saveCachedCustomers, getCachedUtangEntries } from '@/lib/client/offline';
import { useLiveQuery } from 'dexie-react-hooks';
import { db as offlineCache } from '@/lib/client/offline';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { LiveClock } from '@/components/LiveClock';
import { Pagination, pageWindow } from '@/components/Pagination';
import { toast } from 'sonner';
import { ShiftDetails, ZReadSummary, applyOfflineSaleToShift, cacheActiveShift, fetchActiveShift, openShift, closeShift, sameShift, formatVariance, formatVarianceDelta, parseCashCount } from '@/lib/client/api/shift';
import { ShiftReadingModal } from './ShiftReadingModal';
import { peso, toPesos, parsePesosToCents } from '@/lib/money';

interface CartLine {
  product: Product;
  quantity: number;
  /**
   * Effective unit price (integer centavos) snapshotted on the line's FIRST
   * add. Never re-snapshotted by product refreshes — only a fresh add after
   * the line is removed re-locks it. Used as the estimate display until fresh
   * FIFO batch data provides the exact split.
   */
  lockedPrice?: number | null;
}

interface CustomerLight {
  id: number;
  name: string;
}

function getExpiryBadge(expiryDate?: string | Date | null) {
  if (!expiryDate) return null;
  const now = new Date();
  const exp = new Date(expiryDate);
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { label: 'Expired', className: 'bg-rose-100 text-rose-700' };
  if (daysLeft <= 30) return { label: `${daysLeft}d left`, className: 'bg-amber-100 text-amber-700' };
  return null;
}

/**
 * End-of-timestamp boundary for an expiry date. Date-only values (the admin
 * form and seeds produce midnight timestamps) count their whole calendar day
 * as sellable — same end-of-day convention as the credit-due date input.
 */
function expiryCutoffMs(expiryDate: string | Date): number | null {
  const exp = new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return null;
  return new Date(exp.getFullYear(), exp.getMonth(), exp.getDate(), 23, 59, 59, 999).getTime();
}

/**
 * True when a product can no longer be sold on the POS: it is perishable and
 * its expiry date has passed — every FIFO layer it holds is expired with it
 * (the schema tracks expiry per product, not per stock layer). Non-perishable
 * and durable goods never age out this way. `now` defaults to live — the
 * event-handler call sites re-evaluate at click time even if the rendered
 * grid is momentarily stale.
 */
function isSellSkippedExpiredPerishable(product: Product, now: number = Date.now()): boolean {
  if (product.goodsType !== 'perishable' || !product.expiryDate) return false;
  const cutoff = expiryCutoffMs(product.expiryDate);
  return cutoff !== null && cutoff < now;
}

interface StoreSettings {
  storeName: string;
  address?: string;
}

// Module-scope temp-id generator for offline-cached customers: monotonic
// negative ids that never collide with server autoincrement ids (same
// convention as temp user ids). Event-handler use only — replaces Date.now(),
// which the react-hooks/purity rule flags inside component bodies.
let tempCachedCustomerId = -1000000;

export default function POSClient() {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const [fallbackProducts, setProducts] = useState<Product[]>([]);
  const cachedProducts = useLiveQuery(() => offlineCache.products.toArray(), []) as unknown as Product[] | undefined;
  const [productsLoading, setProductsLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  // Minute tick so the expired-perishable grid filter stays truthful on a POS
  // tab left open across an expiry boundary. setState lives in the timer
  // callback (external-system subscription), not in an effect body.
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    // First fire right away, then every minute: an expiry boundary crossed
    // while the POS sits open flips the shelf within a minute.
    const first = window.setTimeout(() => setExpiryTick(Date.now()), 0);
    const id = window.setInterval(() => setExpiryTick(Date.now()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  // Mirror of `cart` for the stable addToCart callback — addToCart is passed to
  // the memoized ProductGrid, so it must not be re-created on every cart change.
  const cartRef = useRef<CartLine[]>([]);
  // productId → fresh FIFO layers, used for exact per-line price previews.
  // A missing entry means estimate mode (locked price / current layer) — never
  // an error state.
  const [cartBatches, setCartBatches] = useState<Map<number, FifoBatchWithPrice[]>>(() => new Map());
  // Refs mirror the map / in-flight fetches so the stable addToCart callback
  // (passed to the memoized ProductGrid) never needs them as dependencies.
  const cartBatchesRef = useRef<Map<number, FifoBatchWithPrice[]>>(new Map());
  const batchFetchInFlightRef = useRef<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'gcash' | 'credit'>('cash');
  // Cash tendered: raw string as typed (pesos). Derived to integer centavos for
  // all math / API payloads — keeps typing UX (no eager reformat while typing).
  const [tenderedInput, setTenderedInput] = useState('');
  // GCash reference number is a string identifier — never money. Kept separate
  // from `tendered` so it can't leak into Tendered/Change math or the receipt.
  // Manual GCash: cashier types the ref from the customer's GCash receipt.
  const [gcashRef, setGcashRef] = useState('');
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>({ storeName: 'Store' });

  const [customers, setCustomers] = useState<CustomerLight[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number>(0);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [creditNote, setCreditNote] = useState('');
  // Optional deadline (date-only, stored as end of day) for credit sales.
  const [creditDue, setCreditDue] = useState('');

  const [utangEntries, setUtangEntries] = useState<Array<{ customerId: number; remainingBalance: number; status: string }>>([]);

  const [showPayment, setShowPayment] = useState(false);
  const [paySelectedCustomerId, setPaySelectedCustomerId] = useState<number>(0);
  const [payNewCustomerName, setPayNewCustomerName] = useState('');
  const [payShowNewCustomer, setPayShowNewCustomer] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState('');
  const [payNotice, setPayNotice] = useState('');

  const [activeShift, setActiveShift] = useState<ShiftDetails | null>(null);
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [showReadingModal, setShowReadingModal] = useState(false);
  const [zReadReceipt, setZReadReceipt] = useState<ZReadSummary | null>(null);
  const [openFloatInput, setOpenFloatInput] = useState<string>('1000');
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftActionLoading, setShiftActionLoading] = useState(false);
  const [shiftError, setShiftError] = useState('');
  // Physical drawer count typed in the End of the Day modal.
  // '' = not entered (cashier may close without a count); admin requires it.
  const [closingCashInput, setClosingCashInput] = useState('');
  // Collapses overlapping identical shift polls into a single in-flight fetch.
  const shiftFetchRef = useRef(false);

  // Fire-and-forget FIFO batch fetch for the cart preview. Failures are
  // silent: the line keeps its estimate price (e.g. offline with no cache).
  // The in-flight Set dedupes rapid repeated adds of the same product.
  const loadCartBatches = useCallback((productIds: number[]) => {
    for (const productId of new Set(productIds)) {
      if (batchFetchInFlightRef.current.has(productId)) continue;
      batchFetchInFlightRef.current.add(productId);
      getFifoBatches(productId)
        .then((result) => {
          setCartBatches((prev) => {
            const next = new Map(prev);
            next.set(productId, result.batches);
            return next;
          });
        })
        .catch(() => {
          // Silent estimate fallback — batch pricing must never break the POS.
        })
        .finally(() => {
          batchFetchInFlightRef.current.delete(productId);
        });
    }
  }, []);

  // After a sale the cart mirrors the pre-sale layers. Drop every layer set
  // belonging to a product that was just sold: a re-add in the same minute must
  // not preview the consumed layers. The next refresh tick refetches fresh data.
  function pruneSoldCartBatches(productIds: number[]) {
    if (productIds.length === 0) return;
    const next = new Map(cartBatchesRef.current);
    let changed = false;
    for (const productId of productIds) {
      if (next.delete(productId)) changed = true;
    }
    if (!changed) return;
    // Keep the ref in sync immediately — addToCart's dedupe reads it before
    // the post-render effect would copy the state update over.
    cartBatchesRef.current = next;
    setCartBatches(next);
  }

  function loadShiftData() {
    // No role gate here. This used to `return` while the role was unknown,
    // which — because `user` is null on an offline cold load — meant the POS
    // never even read the locally cached shift and came back showing
    // "No Open Shift" after an offline refresh. fetchActiveShift() reads the
    // durable cache offline and the server online; it needs no role.
    // In-flight guard: without it, overlapping polls could stack (each cycle
    // re-renders → re-fires the loader).
    if (shiftFetchRef.current) return;
    shiftFetchRef.current = true;
    fetchActiveShift().then((shift) => {
      // Structural compare: the loader always hands us a fresh object, so a
      // naive setState re-rendered (and re-fetched) on every cycle even when
      // nothing changed.
      setActiveShift((prev) => (sameShift(prev, shift) ? prev : shift));
    }).finally(() => {
      shiftFetchRef.current = false;
    });
  }

  const refresh = useCallback(async () => {
    if (typeof window !== 'undefined' && !navigator.onLine) return;
    setProductsLoading(true);
    // getActiveProducts() merges without clearing, so archived rows survive.
    getActiveProducts().then(setProducts).catch(() => {}).finally(() => setProductsLoading(false));
    // Re-read layers for anything still in the cart so a layer rotation
    // (sale / Stock In / Adjust, possibly from another device) is reflected
    // in the displayed split as soon as products refresh.
    loadCartBatches(cartRef.current.map((l) => l.product.id));
    getSettings<StoreSettings>().then(setSettings);
    loadShiftData();
    getCustomersLight().then(setCustomers).catch(() => {});
    getCachedUtangEntries<{ customerId: number; remainingBalance: number; status: string }>().then(setUtangEntries).catch(() => {});
  }, [loadCartBatches]);

  const cachedActiveProducts = useMemo(
    () => cachedProducts?.filter((p) => !p.archived),
    [cachedProducts]
  );
  const products = cachedActiveProducts?.length ? cachedActiveProducts : fallbackProducts;
  const isLoadingProducts = productsLoading && cachedProducts === undefined && fallbackProducts.length === 0;

  useRealtime({
    products: refresh,
    settings: refresh,
    utang: refresh,
    // Cash movements recorded on another device refresh the live totals.
    shift: loadShiftData,
  });

  // Keep the cartRef mirror in sync after every cart commit.
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Mirror batch data for event handlers that must stay stable (addToCart).
  useEffect(() => {
    cartBatchesRef.current = cartBatches;
  }, [cartBatches]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-load shift data on a REAL account change (id/role swap, login/logout),
  // plus on reconnect. Keyed on stable primitives: `user` itself is a memoized
  // object, but primitives make the intent airtight — this effect must never
  // fire on an ordinary re-render, or the loader turns into a fetch loop.
  useEffect(() => {
    if (!user) return;
    loadShiftData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  useEffect(() => {
    function handleReconnect() { loadShiftData(); }
    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    window.addEventListener('online', handleReconnect);
    return () => {
      window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
      window.removeEventListener('online', handleReconnect);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !navigator.onLine && customers.length === 0) {
      getCachedCustomers<CustomerLight>().then((cached) => {
        if (cached?.length) setCustomers(cached);
      }).catch(() => {});
    }
  }, [customers.length]);

  const filteredProducts = useMemo(() => {
    // `expiryTick` refreshes right after mount and then every minute, so a
    // POS tab left open across an expiry boundary drops expired items by
    // itself. Before the first tick it is still 0 — tiles may show for a
    // second but stay unsellable (the addToCart/checkout guards re-check
    // live at click time).
    const now = expiryTick;
    // Newest-added first (id = creation order) — but expired perishables are
    // gone from the shelf entirely: they cannot be sold, only replaced.
    if (!search.trim()) {
      return products
        .filter((p) => !isSellSkippedExpiredPerishable(p, now))
        .sort((a, b) => b.id - a.id);
    }
    const query = search.toLowerCase();
    return products.filter((p) =>
      !isSellSkippedExpiredPerishable(p, now) &&
      (p.name.toLowerCase().includes(query) ||
        p.barcode?.toLowerCase().includes(query) ||
        p.category?.name?.toLowerCase().includes(query))
    ).sort((a, b) => b.id - a.id);
  }, [products, search, expiryTick]);

  const customerBalances = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of utangEntries) {
      if (e.status === 'paid') continue;
      map.set(e.customerId, (map.get(e.customerId) ?? 0) + e.remainingBalance);
    }
    return map;
  }, [utangEntries]);

  // Available stock for a product: the live Dexie-backed `products` list
  // first (it reflects offline decrements), falling back to the raw cached row.
  const productStock = useCallback((productId: number): number | null => {
    const live = products.find((p) => p.id === productId) ?? cachedProducts?.find((p) => p.id === productId);
    return typeof live?.stock === 'number' ? live.stock : null;
  }, [products, cachedProducts]);

  const addToCart = useCallback((product: Product) => {
    // Expiry guard (evaluated live, not from the possibly-stale grid): an
    // expired perishable can't enter the cart at all.
    if (isSellSkippedExpiredPerishable(product)) {
      toast.error(`Expired — ${product.name} can no longer be sold.`);
      return;
    }
    // Cap at available stock so the grader never queues/checks out more units
    // than the shelf holds ("Only N left" rather than a checkout rejection).
    const stock = productStock(product.id) ?? (typeof product.stock === 'number' ? product.stock : null);
    const inCart = cartRef.current.find((l) => l.product.id === product.id)?.quantity ?? 0;
    if (stock !== null && inCart + 1 > stock) {
      toast.error(stock > 0 ? `Only ${stock} left` : 'Out of stock');
      return;
    }
    // First add of this product: fetch its FIFO layers so the cart can show
    // the exact split. Repeated adds are deduped by the in-flight guard.
    if (!cartBatchesRef.current.has(product.id)) {
      loadCartBatches([product.id]);
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        // Keep the FIRST add's lockedPrice; only the product snapshot follows
        // the latest server data (new layer price for subsequent adds).
        return prev.map((l) =>
          l.product.id === product.id
            ? { ...l, product, quantity: l.quantity + 1 }
            : l
        );
      }
      return [
        ...prev,
        { product, quantity: 1, lockedPrice: effectivePrice(product) },
      ];
    });
  }, [productStock, loadCartBatches]);

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && filteredProducts.length === 1) {
      addToCart(filteredProducts[0]);
      setSearch('');
    }
  }

  function changeCartQuantity(productId: number, delta: number) {
    const line = cart.find((l) => l.product.id === productId);
    if (delta > 0) {
      const current = line?.quantity ?? 0;
      const stock = productStock(productId) ?? (line && typeof line.product.stock === 'number' ? line.product.stock : null);
      if (stock !== null && current + delta > stock) {
        toast.error(stock > 0 ? `Only ${stock} left` : 'Out of stock');
        return;
      }
    }
    // The line is leaving the cart — drop its batch preview too. A later add
    // starts fresh (and re-locks the price at that moment).
    if (line && delta < 0 && line.quantity + delta <= 0) {
      setCartBatches((prev) => {
        if (!prev.has(productId)) return prev;
        const next = new Map(prev);
        next.delete(productId);
        return next;
      });
    }
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

  // Typed-quantity editor for the cart rows: key = productId, value = the
  // in-progress string while the input is focused. The input commits on
  // blur/Enter so typing "12" doesn't fire per-keystroke stock caps/toasts.
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});

  function clearQtyDraft(productId: number) {
    setQtyDraft((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  // Absolute quantity editor for the typed input's commit path. Same shelf
  // cap as addToCart/changeCartQuantity — clamps to stock with the usual
  // "Only N left" toast instead of queueing more than the shelf holds.
  function applyCartQuantity(productId: number, target: number) {
    if (!Number.isInteger(target) || target <= 0) return;
    const line = cart.find((l) => l.product.id === productId);
    // Input rows only render for cart lines; bail if it was removed between
    // focus and commit.
    if (!line) return;
    const stock = productStock(productId) ?? (typeof line.product.stock === 'number' ? line.product.stock : null);
    // A typed edit is never a delete. When the shelf is empty the clamp would
    // be 0 — passing that to changeCartQuantity drops the line (the − button's
    // delete-at-zero behavior). Leave the line untouched instead: removal stays
    // the explicit − button's job.
    if (stock !== null && stock <= 0) {
      toast.error('Out of stock');
      return;
    }
    if (stock !== null && target > stock) {
      toast.error(stock > 0 ? `Only ${stock} left` : 'Out of stock');
    }
    const bounded = stock !== null ? Math.min(target, stock) : target;
    if (bounded <= 0) return; // clamped away — cancelled edit, keep the line
    if (bounded === line.quantity) return; // already there (clamps included)
    // Reuse the +/- path in both directions so batching layout, price
    // previews and offline behavior all stay in one code path.
    changeCartQuantity(productId, bounded - line.quantity);
  }

  // Blur/Enter commit. A valid 1+ value applies; blank/zero is a CANCELLED
  // edit that snaps back to the committed quantity — removing a line stays
  // the − button's job so a stray keystroke can never empty the cart.
  function commitQtyDraft(productId: number, domValue: string) {
    clearQtyDraft(productId);
    const parsed = Number.parseInt(domValue, 10);
    if (Number.isInteger(parsed) && parsed >= 1) applyCartQuantity(productId, parsed);
  }

  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);
  // Same per-line helper as the rendered rows → displayed total === previewed
  // (server) total in the normal, batch-data-available case.
  const total = cart.reduce((s, l) => s + lineTotalOf(l, cartBatches), 0);
  // Payment parity guard: tell the cashier when the exact FIFO split makes
  // the charge differ from the naive locked-price estimate by more than a
  // rounding cent (e.g. a 12-unit sale spanning two layers).
  const showFifoPriceNotice = cart.some((l) => {
    const naiveUnit = l.lockedPrice ?? effectivePrice(l.product);
    const naiveTotal = naiveUnit * l.quantity;
    return Math.abs(lineTotalOf(l, cartBatches) - naiveTotal) > 1;
  });
  // Derived centavos from the raw input; blank/invalid → 0 (treated as not yet tendered).
  const tenderedCents = tenderedInput.trim() === '' ? 0 : parsePesosToCents(tenderedInput) || 0;
  const change = tenderedCents - total;

  async function resolveCustomerName(): Promise<string | null> {
    if (showNewCustomer) {
      if (!newCustomerName.trim()) {
        setError('Enter a customer name');
        return null;
      }
      const name = newCustomerName.trim();
      const existing = customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!existing) {
        if (navigator.onLine) {
          try {
            const { addCustomer } = await import('@/lib/client/api/inventory');
            const result = await addCustomer({ name });
            setCustomers((prev) => [...prev, { id: result.id, name }]);
          } catch {
            const cached = await getCachedCustomers<Record<string, unknown>>();
            const newId = tempCachedCustomerId--;
            await saveCachedCustomers([...cached, { id: newId, name, createdAt: new Date().toISOString() }]);
            setCustomers((prev) => [...prev, { id: newId, name }]);
          }
        } else {
          const cached = await getCachedCustomers<Record<string, unknown>>();
          const newId = tempCachedCustomerId--;
          await saveCachedCustomers([...cached, { id: newId, name, createdAt: new Date().toISOString() }]);
          setCustomers((prev) => [...prev, { id: newId, name }]);
        }
      }
      return name;
    }
    const found = customers.find((c) => c.id === selectedCustomerId);
    if (!found) {
      setError('Select a customer');
      return null;
    }
    return found.name;
  }

  async function handleCompleteSale() {
    if (!activeShift && !isAdmin) {
      setError('Please open a shift before completing transactions.');
      return;
    }
    // Expiry watchdog: a cart line can sit in an open POS tab across its
    // expiry date (overnight shifts / offline days). Block the sale and let
    // the cashier remove the item — expiry must never slip between grid and
    // receipt.
    const expiredLine = cart.find((l) => isSellSkippedExpiredPerishable(l.product));
    if (expiredLine) {
      setError(`${expiredLine.product.name} expired — remove it from the cart to continue.`);
      return;
    }
    setError('');
    setProcessing(true);
    try {
      if (paymentMethod === 'credit') {
        const customerName = await resolveCustomerName();
        if (!customerName) {
          setProcessing(false);
          return;
        }
        // One item row per FIFO price slice: the offline fallback receipt and
        // the queued expectedSubtotal then match the displayed split exactly.
        // The server re-derives slices from the DB and ignores these prices.
        const items = cart.flatMap((l) =>
          previewSlices(l, cartBatches).map((s) => ({
            productId: l.product.id,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
          }))
        );
        // Date-only (YYYY-MM-DD) → end-of-day ISO so picking "today" stays valid.
        const dueIso = creditDue ? new Date(`${creditDue}T23:59:59`).toISOString() : undefined;
        const result = await addUtangOffline(customerName, items, creditNote || undefined, dueIso ?? undefined);
        setReceipt({
          id: result.id,
          subtotal: result.totalAmount,
          vat: 0,
          total: result.totalAmount,
          tendered: 0,
          change: 0,
          paymentMethod: 'credit',
          createdAt: result.createdAt,
          customer: {
            id: result.customer?.id ?? (result as unknown as { customerId?: number }).customerId ?? result.id,
            name: result.customer?.name ?? customerName,
          },
          offline: (result as Record<string, unknown>).offline as boolean | undefined,
        });
        setCart([]);
        // Drop the sold products' pre-sale layer snapshots (see helper).
        pruneSoldCartBatches(cart.map((l) => l.product.id));
        setTenderedInput('');
        setCreditNote('');
        setCreditDue('');
        setSelectedCustomerId(0);
        setNewCustomerName('');
        setShowNewCustomer(false);
        // Layers just rotated: refresh previews for the products we sold so a
        // rapid re-add sees the new active layer. Fire-and-forget by contract.
        loadCartBatches(cart.map((l) => l.product.id));
        // Offline: Dexie already holds the decremented stock and the POS live
        // query re-renders the grid, so re-fetching the whole product list here
        // only bought an extra full-grid render per sale.
        if (!(result as Record<string, unknown>).offline) {
          void getActiveProducts().then(setProducts).catch(() => {});
        }
        // Refresh live shift totals for the seller's own shift (admin included).
        if ((result as Record<string, unknown>).offline && activeShift) {
          // Credit (utang) is a receivable, not drawer cash — the server now
          // counts only cash/gcash sales in the shift snapshot
          // (app/api/shift). A credit sale must not bump transactionCount.
          const updatedShift: ShiftDetails = {
            ...activeShift,
            transactionCount:
              (activeShift.transactionCount ?? 0) +
              (['cash', 'gcash'].includes(paymentMethod) ? 1 : 0),
          };
          cacheActiveShift(updatedShift);
          setActiveShift(updatedShift);
        } else {
          void fetchActiveShift().then((shift) => {
            if (shift) setActiveShift(shift);
          });
        }
      } else {
        // GCash is exact payment: tendered = total, change = 0. The reference
        // number is typed manually from the customer's GCash receipt.
        const ref = paymentMethod === 'gcash' ? gcashRef.trim() : '';
        if (paymentMethod === 'gcash' && !ref) {
          setError('GCash reference number is required.');
          setProcessing(false);
          return;
        }
        const finalTendered = paymentMethod === 'gcash' ? total : tenderedCents;
        // One item row per FIFO price slice (see the credit branch above):
        // keeps the offline receipt/queue estimate equal to the cart display.
        const cartItems = cart.flatMap((l) =>
          previewSlices(l, cartBatches).map((s) => ({
            productId: l.product.id,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
          }))
        );

        const result = await checkout(
          cartItems,
          paymentMethod,
          finalTendered,
          null,
          paymentMethod === 'gcash' ? ref : undefined
        );
        setReceipt(
          paymentMethod === 'gcash'
            ? { ...result, tendered: result.total, change: 0, gcashRef: ref }
            : result
        );
        setCart([]);
        // Drop the sold products' pre-sale layer snapshots (see helper).
        pruneSoldCartBatches(cart.map((l) => l.product.id));
        setTenderedInput('');
        setGcashRef('');
        // Layers just rotated: refresh previews for the products we sold so a
        // rapid re-add sees the new active layer. Fire-and-forget by contract.
        loadCartBatches(cart.map((l) => l.product.id));
        // Online only — offline stock already lives in Dexie (see above).
        if (!result.offline) {
          void getActiveProducts().then(setProducts).catch(() => {});
        }

        // Refresh live shift totals for the seller's own shift (admin included).
        if (result.offline && activeShift) {
          const updatedShift = applyOfflineSaleToShift(activeShift, result.total, paymentMethod);
          cacheActiveShift(updatedShift);
          setActiveShift(updatedShift);
        } else {
          void fetchActiveShift().then((shift) => {
            if (shift) setActiveShift(shift);
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    setPayError('');
    setPayNotice('');
    try {
      let customerName = '';
      if (payShowNewCustomer) {
        if (!payNewCustomerName.trim()) {
          setPayError('Enter a customer name');
          return;
        }
        customerName = payNewCustomerName.trim();
        const existing = customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase());
        if (!existing) {
          // Offline-safe helper: it optimistically caches the customer AND
          // queues a customer_add, so the queued record_payment replays after
          // the customer exists server-side (otherwise sync fails with
          // "Customer not found" and the payment is stuck in the queue).
          const { addCustomer } = await import('@/lib/client/api/inventory');
          const created = await addCustomer({ name: customerName });
          const newCustomer: CustomerLight = { id: created.id, name: created.name ?? customerName };
          // Keep the picker in sync right away — the next payment/new-customer
          // lookup must find this customer without a reload.
          setCustomers((prev) => (prev.some((c) => c.id === newCustomer.id) ? prev : [...prev, newCustomer]));
        }
      } else {
        const found = customers.find((c) => c.id === paySelectedCustomerId);
        if (!found) {
          setPayError('Select a customer');
          return;
        }
        customerName = found.name;
      }

      const amount = parsePesosToCents(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setPayError('Enter a valid amount');
        return;
      }

      const result = await recordUtangPayment({
        customerName,
        amount,
        note: payNote || undefined,
      });

      if ((result as Record<string, unknown>).offline) {
        setPayNotice('Payment queued offline! It will auto-sync once online.');
      } else {
        setPayNotice('Payment recorded successfully!');
      }

      setShowPayment(false);
      setPaySelectedCustomerId(0);
      setPayNewCustomerName('');
      setPayShowNewCustomer(false);
      setPayAmount('');
      setPayNote('');
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment failed');
    }
  }

  // Instant shift open: no modal, no float entry — opens with ₱0.00 float.
  async function handleInstantOpenShift() {
    setShiftError('');
    setShiftActionLoading(true);
    try {
      const res = await openShift(0);
      if (!res.success) {
        setShiftError(res.error || 'Failed to open shift');
        return;
      }
      if (res.shift) setActiveShift(res.shift);
      else loadShiftData();
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : 'Failed to open shift');
    } finally {
      setShiftActionLoading(false);
    }
  }

  // Admin modal open: the admin chooses the drawer float and optional notes.
  async function handleOpenShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShiftError('');
    setShiftActionLoading(true);
    const amount = Math.max(0, parsePesosToCents(openFloatInput) || 0);
    try {
      const res = await openShift(amount, shiftNotes);
      if (!res.success) {
        setShiftError(res.error || 'Failed to open shift');
        return;
      }
      if (res.shift) setActiveShift(res.shift);
      else loadShiftData();
      setShowOpenShiftModal(false);
      setShiftNotes('');
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : 'Failed to open shift');
    } finally {
      setShiftActionLoading(false);
    }
  }

  async function handleCloseShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShiftError('');
    const raw = closingCashInput.trim();
    const countedCash = parseCashCount(closingCashInput);
    // Admin must reconcile the drawer: no count, no close.
    if (isAdmin && countedCash === null) {
      setShiftError('Enter the physical cash count to close the shift.');
      return;
    }
    // Any non-blank input must be a valid non-negative amount (type=number
    // mostly guarantees this, but never silently drop a bad value).
    if (raw !== '' && countedCash === null) {
      setShiftError('Cash count must be a number of 0 or more.');
      return;
    }
    setShiftActionLoading(true);
    // Pass the physical drawer count so the server stores counted cash and the
    // over/short variance. Blank (cashier) → undefined → null variance, exactly
    // as before. Offline the queued close_shift action carries the same value.
    try {
      const res = await closeShift(countedCash ?? undefined, shiftNotes);
      if (!res.success) {
        setShiftError(res.error || 'Failed to close shift');
        return;
      }
      setShowEndShiftModal(false);
      setClosingCashInput('');
      setActiveShift(null);
      if (res.summary) {
        setZReadReceipt(res.summary);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to close shift';
      setShiftError(message);
      toast.error(message);
    } finally {
      // Always release the busy flag — an early throw must never leave the
      // Close Shift button disabled forever.
      setShiftActionLoading(false);
    }
  }

  const expectedCashAmount = activeShift?.expectedCash ?? 0;
  const countedCash = parseCashCount(closingCashInput);
  // Live variance — computed against the SAME expectedCash the server returns
  // (and the same value shown in the summary), so preview === stored variance.
  const closingVariance = countedCash === null ? null : formatVariance(expectedCashAmount, countedCash);
  // Admin: count required. Cashier: still allowed to close with no count.
  const canCloseShift = isAdmin
    ? countedCash !== null
    : closingCashInput.trim() === '' || countedCash !== null;

  const isCredit = paymentMethod === 'credit';

  return (
    <div className="space-y-4">
      {/* Shared real-time clock — same display for admin and cashier */}
      <LiveClock />

      {/* Shift Header Status Bar — cashier opens instantly, admin picks the float via modal */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${activeShift ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <div>
            <div className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>{activeShift ? 'Shift Active' : 'No Open Shift'}</span>
              {activeShift && (
                <span className="text-xs font-normal text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  Opened {formatTime(activeShift.openedAt)}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1 mt-0.5">
              {activeShift && (
                <span>Float: <strong className="text-slate-200">{peso(activeShift.openingFloat ?? 0)}</strong></span>
              )}
              <span>Cash Sales: <strong className="text-slate-200">{peso(activeShift?.cashSales ?? 0)}</strong></span>
              <span>GCash Sales: <strong className="text-slate-200">{peso(activeShift?.gcashSales ?? 0)}</strong></span>
              <span>Expected Cash: <strong className="text-cyan-400">{peso(activeShift?.expectedCash ?? 0)}</strong></span>
            </div>
            {shiftError && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded-md mt-1.5 inline-block">
                {shiftError}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!activeShift ? (
            isAdmin ? (
              <button
                onClick={() => {
                  setShiftError('');
                  setShiftNotes('');
                  setShowOpenShiftModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-emerald-950/30 cursor-pointer"
              >
                + Open Cash Drawer Shift
              </button>
            ) : (
              <button
                onClick={handleInstantOpenShift}
                disabled={shiftActionLoading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-emerald-950/30 cursor-pointer disabled:opacity-60"
              >
                {shiftActionLoading ? 'Starting Shift...' : '+ Open Shift'}
              </button>
            )
          ) : (
            <>
              <button
                onClick={() => {
                  setShiftError('');
                  setShowReadingModal(true);
                }}
                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-cyan-950/30 cursor-pointer flex items-center gap-1.5"
              >
                 Reading
              </button>
              <button
                onClick={() => {
                  setShiftError('');
                  setClosingCashInput('');
                  setShowEndShiftModal(true);
                }}
                className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-rose-950/30 cursor-pointer flex items-center gap-1.5"
              >
                {isAdmin ? 'End of the Day' : 'End Shift'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h1 className="text-2xl font-bold">Point Of Sale</h1>
          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search products by name..."
              className="w-full border rounded-lg pl-10 pr-10 py-3 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <ProductGrid
            key={search}
            products={filteredProducts}
            totalProducts={products.length}
            loading={isLoadingProducts}
            offline={typeof navigator !== 'undefined' && !navigator.onLine}
            search={search}
            onAddToCart={addToCart}
          />
        </div>

        {/* data-pos-flat: this panel is sticky, so its theme backdrop-filter
            forced a re-blur every frame while the card grid scrolled behind it. */}
        <div data-pos-flat className="bg-white rounded-xl shadow p-5 space-y-4 h-fit sticky top-4">
          <div className="flex justify-between items-center">
            <h2 className="font-bold">Cart</h2>
            <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{totalItems} items</span>
          </div>

          {cart.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Cart is empty. Input a product to start.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {cart.map((l) => {
                // Exact FIFO preview when layers are loaded; otherwise the
                // locked/active-layer estimate. The same helper feeds the
                // grand total, so the row and total can never disagree.
                const slices = previewSlices(l, cartBatches);
                const lineTotal = lineTotalOf(l, cartBatches);
                const distinctPrices = new Set(slices.map((s) => s.unitPrice));
                const isSplit = distinctPrices.size > 1;
                const unitPrice = slices[0]?.unitPrice ?? l.lockedPrice ?? l.product.price;
                return (
                  <div key={l.product.id} className="flex justify-between items-center gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{l.product.name}</div>
                      {!isSplit && <div className="text-xs text-gray-500">{peso(unitPrice)}/unit</div>}
                      {isSplit && (
                        <div className="text-[10px] text-gray-500 leading-tight">
                          {slices.map((s, i) => (
                            <span key={`${s.unitPrice}-${i}`}>
                              {i > 0 && ' + '}
                              {peso(s.unitPrice)} × {s.quantity}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { clearQtyDraft(l.product.id); changeCartQuantity(l.product.id, -1); }}
                        className="w-7 h-7 rounded-md border text-sm cursor-pointer"
                      >
                        -
                      </button>
                      {/* Typed quantity edit: commits on blur/Enter so multi-digit
                          typing never trips the stock cap mid-entry. Esc reverts. */}
                      <input
                        value={qtyDraft[l.product.id] ?? String(l.quantity)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, '');
                          setQtyDraft((prev) => ({ ...prev, [l.product.id]: raw }));
                        }}
                        onBlur={(e) => commitQtyDraft(l.product.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            // Revert to the committed quantity, then let blur
                            // tidy the draft state up.
                            e.currentTarget.value = String(l.quantity);
                            e.currentTarget.blur();
                          }
                        }}
                        inputMode="numeric"
                        aria-label={`Quantity — ${l.product.name}`}
                        className="h-7 w-9 rounded-md border text-sm text-center cursor-text"
                      />
                      <button
                        type="button"
                        onClick={() => { clearQtyDraft(l.product.id); changeCartQuantity(l.product.id, 1); }}
                        className="w-7 h-7 rounded-md border text-sm cursor-pointer"
                      >
                        +
                      </button>
                      <span className="min-w-[70px] text-right">{peso(lineTotal)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t pt-3 space-y-1 text-sm">
            <div className="flex justify-between font-bold text-lg text-orange-700"><span>Total</span><span>{peso(total)}</span></div>
            {showFifoPriceNotice && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                FIFO layer prices applied — updated total
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Payment Method</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setPaymentMethod('cash')}
                className={`border rounded-md py-2 text-sm ${paymentMethod === 'cash' ? 'bg-green-700 text-white' : ''} cursor-pointer`}
              >
                Cash
              </button>
              <button
                onClick={() => {
                  setPaymentMethod('gcash');
                  setTenderedInput(toPesos(total));
                }}
                className={`border rounded-md py-2 text-sm ${paymentMethod === 'gcash' ? 'bg-green-700 text-white' : ''} cursor-pointer`}
              >
                GCash
              </button>
              <button
                onClick={() => setPaymentMethod('credit')}
                className={`border rounded-md py-2 text-sm ${isCredit ? 'bg-amber-600 text-white' : ''} cursor-pointer`}
              >
                Credit
              </button>
            </div>
          </div>

          {isCredit && (
            <div>
              <label className="text-sm font-medium">Customer</label>
              {showNewCustomer ? (
                <div className="flex gap-2 mt-1">
                  <input
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Enter customer name"
                    className="flex-1 border rounded-md px-3 py-2 text-sm"
                  />
                  <button type="button" onClick={() => { setShowNewCustomer(false); setNewCustomerName(''); }} className="text-xs text-gray-500 hover:text-gray-700 px-2 cursor-pointer">Cancel</button>
                </div>
              ) : (
                <div className="flex gap-2 mt-1">
                  <select
                    required
                    value={selectedCustomerId || ''}
                    onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
                    className="flex-1 border rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{customerBalances.get(c.id) ? ` — ${peso(customerBalances.get(c.id)!)} owed` : ''}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setShowNewCustomer(true)} className="text-xs text-amber-600 font-semibold hover:underline whitespace-nowrap cursor-pointer">+ New</button>
                </div>
              )}
              <input
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full border rounded-md px-3 py-2 mt-2 text-sm"
              />
              <div className="mt-2">
                <label className="text-sm font-medium">Deadline (optional)</label>
                <input
                  type="date"
                  value={creditDue}
                  onChange={(e) => setCreditDue(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 mt-1 text-sm"
                />
              </div>
            </div>
          )}

          {!isCredit && paymentMethod === 'cash' && (
            <>
              <div>
                <label className="text-sm font-medium">Cash Tendered</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tenderedInput}
                  onChange={(e) => setTenderedInput(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 mt-1"
                  placeholder="0.00"
                />
              </div>

              <div className="flex justify-between text-sm">
                <span>Change</span>
                <span className="font-semibold">
                  {change > 0 ? peso(change) : peso(0)}
                </span>
              </div>
            </>
          )}

          {!isCredit && paymentMethod === 'gcash' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">GCash Reference #</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={gcashRef}
                  onChange={(e) => setGcashRef(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full border rounded-md px-3 py-2 mt-1"
                  placeholder="Enter ref from customer GCash receipt"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Exact payment — no change. Type the reference number from the customer&apos;s GCash confirmation.
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-2 rounded border border-red-200">{error}</p>}

          <button
            onClick={handleCompleteSale}
            disabled={cart.length === 0 || (!isCredit && paymentMethod === 'cash' && tenderedCents < total) || (!isCredit && paymentMethod === 'gcash' && !gcashRef.trim()) || (isCredit && !selectedCustomerId && !showNewCustomer) || processing || (!activeShift && !isAdmin)}
            className={`w-full text-white rounded-md py-3 font-medium disabled:opacity-40 transition cursor-pointer ${isCredit ? 'bg-amber-600 hover:bg-amber-500' : 'bg-green-700 hover:bg-green-600'}`}
          >
            {processing ? 'Processing...' : (!activeShift && !isAdmin) ? 'Open Shift to Complete Sale' : isCredit ? '✓ Record Credit Sale' : '✓ Complete Sale'}
          </button>

          <div className="border-t pt-3">
            <button
              onClick={() => { setShowPayment(true); setPayError(''); setPayNotice(''); }}
              className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md py-2 text-sm font-medium transition cursor-pointer"
            >
              Record Payment
            </button>
          </div>
          {payNotice && <p className="text-xs text-emerald-600 bg-emerald-50 p-2 rounded">{payNotice}</p>}
        </div>

        {/* Sale Receipt Modal */}
        {receipt && (
          <ReceiptModal
            receipt={receipt}
            cashierName={user?.name ?? ''}
            storeName={settings.storeName}
            storeAddress={settings.address ?? ''}
            onClose={() => setReceipt(null)}
          />
        )}

        {/* Record Payment Modal */}
        {showPayment && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <form onSubmit={handleRecordPayment} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="font-bold text-lg text-slate-100">Record Payment</h3>
                <button type="button" onClick={() => setShowPayment(false)} className="text-slate-400 hover:text-slate-200">✕</button>
              </div>
              {payError && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2 rounded">{payError}</p>}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Customer</label>
                {payShowNewCustomer ? (
                  <div className="flex gap-2">
                    <input
                      required
                      value={payNewCustomerName}
                      onChange={(e) => setPayNewCustomerName(e.target.value)}
                      placeholder="Enter customer name"
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white text-sm outline-none focus:border-cyan-500"
                    />
                    <button type="button" onClick={() => { setPayShowNewCustomer(false); setPayNewCustomerName(''); }} className="text-xs text-slate-400 hover:text-white px-2 cursor-pointer">Cancel</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      required
                      value={paySelectedCustomerId || ''}
                      onChange={(e) => setPaySelectedCustomerId(Number(e.target.value))}
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white text-sm outline-none focus:border-cyan-500"
                    >
                      <option value="">Select customer</option>
                      {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{customerBalances.get(c.id) ? ` — ${peso(customerBalances.get(c.id)!)} owed` : ''}</option>
                    ))}
                    </select>
                    <button type="button" onClick={() => setPayShowNewCustomer(true)} className="text-xs text-cyan-400 font-semibold hover:underline whitespace-nowrap cursor-pointer">+ New</button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Amount (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg font-bold text-emerald-400 outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="e.g. Partial cash payment"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowPayment(false)} className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl py-2.5 text-sm font-semibold transition">Record Payment</button>
              </div>
            </form>
          </div>
        )}

        {/* Open Cash Drawer Shift — admin chooses the float amount */}
        {showOpenShiftModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                  <span></span> Open Cash Drawer Shift
                </h3>
                <button
                  onClick={() => setShowOpenShiftModal(false)}
                  className="text-slate-400 hover:text-slate-200 text-xl leading-none"
                  aria-label="Close"
                >
                  ✕
                </button>
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
                    min="0"
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
                  <button
                    type="button"
                    onClick={() => setShowOpenShiftModal(false)}
                    className="flex-1 border border-slate-700 rounded-xl py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
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

        {/* End Shift */}
        {showEndShiftModal && activeShift && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                  <span></span> {isAdmin ? 'End of the Day' : 'End Shift'}
                </h3>
                <button onClick={() => setShowEndShiftModal(false)} className="text-slate-400 hover:text-slate-200">✕</button>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2 text-sm">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Live X-Read Summary</div>
                <div className="flex justify-between text-slate-300">
                  <span>Opening Cash Float</span>
                  <span className="font-medium">{peso(activeShift.openingFloat)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Cash Sales (+)</span>
                  <span className="font-medium text-emerald-400">+{peso(activeShift.cashSales ?? 0)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Cash In (+)</span>
                  <span className="font-medium text-emerald-400">+{peso(activeShift.cashIn ?? 0)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Cash Out (−)</span>
                  <span className="font-medium text-amber-400">−{peso(activeShift.cashOut ?? 0)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Expenses (−)</span>
                  <span className="font-medium text-rose-400">−{peso(activeShift.totalExpenses ?? 0)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>GCash Sales</span>
                  <span className="font-medium text-sky-400">{peso(activeShift.gcashSales ?? 0)}</span>
                </div>
                <hr className="border-slate-800 my-1" />
                <div className="flex justify-between font-bold text-slate-100">
                  <span>Expected Cash in Drawer</span>
                  <span className="text-cyan-400">{peso(expectedCashAmount)}</span>
                </div>
                {/* Live variance — appears as soon as a cash count is typed.
                    Same helper the printed Z-Read uses, so preview === receipt. */}
                {closingVariance && (
                  <div className="flex justify-between items-center font-bold pt-1">
                    <span className="text-slate-400 text-[11px] uppercase tracking-wider font-semibold">
                      Variance (Counted − Expected)
                    </span>
                    <span
                      className={
                        closingVariance.tone === 'balanced'
                          ? 'text-emerald-400'
                          : closingVariance.tone === 'over'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }
                    >
                      {closingVariance.signedText} · {closingVariance.label}
                    </span>
                  </div>
                )}
              </div>

              <form onSubmit={handleCloseShiftSubmit} className="space-y-4">
                {/* Physical cash count: admin required, cashier optional. */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Physical Cash Count (₱){isAdmin ? '' : ' — Optional'}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={closingCashInput}
                    onChange={(e) => setClosingCashInput(e.target.value)}
                    placeholder={isAdmin ? toPesos(expectedCashAmount) : 'Leave blank to close without a count'}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-semibold text-cyan-400"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isAdmin
                      ? 'Count the drawer cash, enter it — the variance above updates as you type.'
                      : 'Optional. Enter the drawer count to record an over/short variance.'}
                  </p>
                </div>

                <p className="text-xs text-slate-400">
                  Closing your shift records the X-Read totals above. The counted cash and
                  variance are saved to the shift and shown on the receipt.
                </p>

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
                    disabled={shiftActionLoading || !canCloseShift}
                    title={canCloseShift ? undefined : 'Enter the physical cash count to close the shift.'}
                    className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-60"
                  >
                    {shiftActionLoading ? 'Closing Shift...' : 'Close Shift'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showReadingModal && activeShift && (
          <ShiftReadingModal
            shift={activeShift}
            isAdmin={isAdmin}
            onClose={() => setShowReadingModal(false)}
            onChanged={loadShiftData}
          />
        )}

        {zReadReceipt && (
          <ZReadModal
            summary={zReadReceipt}
            cashierName={user?.name ?? ''}
            storeName={settings.storeName}
            onClose={() => setZReadReceipt(null)}
          />
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 24;

const ProductGrid = memo(function ProductGrid({
  products,
  totalProducts,
  loading,
  offline,
  search,
  onAddToCart,
}: {
  products: Product[];
  totalProducts: number;
  loading: boolean;
  offline: boolean;
  search: string;
  onAddToCart: (product: Product) => void;
}) {
  const [page, setPage] = useState(1);
  const w = pageWindow(products.length, page, PAGE_SIZE);
  // Only the populated branch is paged; loading/empty branches render whole.
  const pageProducts = products.slice((w.page - 1) * PAGE_SIZE, w.pageEnd);

  return (
    <>
      {/* data-pos-flat: renders every card/badge flat (no per-card backdrop-filter).
          See "POS PERFORMANCE (FLAT SURFACES)" in app/globals.css. */}
      <div data-pos-flat className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {loading ? (
          <p className="col-span-full text-center text-gray-400 py-8">
            Loading products…
          </p>
        ) : products.length === 0 && totalProducts === 0 && offline ? (
          <p className="col-span-full text-center text-gray-400 py-8">
            No products available offline. Please go online to load products.
          </p>
        ) : products.length === 0 ? (
          <p className="col-span-full text-center text-gray-400 py-8">
            No products found matching &quot;{search}&quot;
          </p>
        ) : (
          pageProducts.map((product) => {
            const expBadge = getExpiryBadge(product.expiryDate);
            // activeLayerPrice may ship in a parallel server lane; the local
            // intersection keeps this client compiling until then.
            const priceable = product as PriceableProduct;
            return (
              <button
                key={product.id}
                data-pos-product-card
                onClick={() => onAddToCart(product)}
                disabled={product.stock <= 0}
                className={`bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition cursor-pointer disabled:opacity-40 ${expBadge ? 'border-l-4 border-l-amber-400' : ''}`}
              >
                <div className="font-medium text-sm">{product.name}</div>
                {expBadge && (
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full mt-1 font-medium ${expBadge.className}`}>
                    {expBadge.label}
                  </span>
                )}
                <div className="flex justify-between items-center mt-2">
                  <span className="text-green-700 font-bold">{peso(effectivePrice(priceable))}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${product.stock < 20 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    {product.stock} stk
                  </span>
                </div>
                {typeof priceable.activeLayerCost === 'number' && (
                  <div className="text-[10px] text-gray-500 mt-0.5">cost {peso(priceable.activeLayerCost)}/unit</div>
                )}
              </button>
            );
          })
        )}
      </div>
      <Pagination
        tone="light"
        page={w.page}
        pageCount={w.pageCount}
        total={products.length}
        pageStart={w.pageStart}
        pageEnd={w.pageEnd}
        label="products"
        onPage={setPage}
      />
    </>
  );
});

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
        <div className="flex justify-between"><span className="text-slate-400">Order #</span><span className="font-bold text-slate-100">{receipt.id}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Date</span><span>{formatDateTime(receipt.createdAt)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Cashier</span><span>{cashierName}</span></div>
        {receipt.customer && (
          <div className="flex justify-between"><span className="text-slate-400">Customer</span><span className="font-bold text-amber-400">{receipt.customer.name}</span></div>
        )}
        <div className="flex justify-between"><span className="text-slate-400">Payment</span><span className={`capitalize font-bold ${receipt.paymentMethod === 'credit' ? 'text-amber-400' : 'text-cyan-400'}`}>{receipt.paymentMethod === 'credit' ? 'Credit / Utang' : receipt.paymentMethod}</span></div>
        <hr className="border-dashed border-slate-800 my-1" />
        <div className="flex justify-between"><span className="text-slate-400">Subtotal</span><span>{peso(receipt.subtotal)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">VAT</span><span>{peso(receipt.vat)}</span></div>
        <div className="flex justify-between font-bold text-sm text-slate-100"><span>Total</span><span className="text-emerald-400">{peso(receipt.total)}</span></div>
        {receipt.paymentMethod === 'cash' && (
          <>
            <div className="flex justify-between"><span className="text-slate-400">Tendered</span><span>{peso(receipt.tendered)}</span></div>
            <div className="flex justify-between font-bold text-cyan-300"><span>Change</span><span>{peso(receipt.change)}</span></div>
          </>
        )}
        {receipt.paymentMethod === 'gcash' && receipt.gcashRef && (
          <div className="flex justify-between"><span className="text-slate-400">GCash Ref #</span><span className="font-bold text-cyan-300">{receipt.gcashRef}</span></div>
        )}
        {receipt.paymentMethod === 'gcash' && (
          <div className="flex justify-between"><span className="text-slate-400">GCash Status</span><span className="font-bold text-emerald-300">PAID</span></div>
        )}
        {receipt.paymentMethod === 'credit' && (
          <div className="flex justify-between"><span className="text-slate-400">Amount Owed</span><span className="font-bold text-amber-400">{peso(receipt.total)}</span></div>
        )}

        {receipt.offline && (
          <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl p-2 text-center text-[11px] font-bold text-amber-300">
            🟡 Saved Offline — will sync automatically once online
          </div>
        )}
        {!receipt.offline && receipt.paymentMethod === 'gcash' && (
          <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-2 text-center text-[11px] font-bold text-emerald-300">
            ✓ GCash Paid
          </div>
        )}

        <div className="mt-4 text-xs text-slate-400 text-center border-t border-dashed border-slate-800 pt-2">
          Thank you for your purchase!
        </div>

        <div className="pt-3 flex justify-center font-sans print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl py-2.5 px-8 text-xs font-bold transition"
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
  // Single source of truth with the live preview (formatVarianceDelta), so the
  // receipt can never disagree with the variance shown before closing. The
  // stored value is the server's authoritative `overageShortage`.
  const discrepancy = summary.overageShortage;
  const variance = discrepancy === null ? null : formatVarianceDelta(discrepancy);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3 text-gray-900">
        <div className="text-center border-b pb-3">
          <h3 className="font-bold text-lg">{storeName}</h3>
          <p className="text-xs font-semibold text-gray-500 tracking-wide uppercase">SHIFT REPORT</p>
        </div>

        <div className="text-sm space-y-1">
          <Row label="Cashier" value={cashierName} bold />
          <Row label="Shift Opened" value={formatDateTime(summary.openedAt)} />
          <Row label="Shift Closed" value={formatDateTime(summary.closedAt)} />
        </div>

        <hr className="border-slate-200" />

        <div className="text-sm space-y-1">
          <Row label="Opening Float" value={peso(summary.openingFloat)} />
          <Row label="Cash Sales" value={peso(summary.cashSales)} />
          <Row label="Cash In" value={`+${peso(summary.cashIn)}`} />
          <Row label="Cash Out" value={`-${peso(summary.cashOut)}`} />
          <Row label="Expenses" value={`-${peso(summary.expenses)}`} />
          <Row label="GCash Sales" value={peso(summary.gcashSales)} />
          <Row label="Total Sales" value={peso(summary.totalSales)} bold />
        </div>

        <hr className="border-slate-200" />

        <div className="text-sm space-y-1">
          <Row label="Expected Cash" value={peso(summary.expectedCash)} />
          {summary.closingCash !== null && (
            <Row label="Counted Cash" value={peso(summary.closingCash)} />
          )}
        </div>

        {variance && (
          <div className={`text-center rounded-md py-2 font-bold ${
            variance.tone === 'balanced' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          }`}>
            {variance.tone === 'balanced'
              ? `BALANCED (₱0.00)`
              : `${variance.label} (${variance.text})`}
          </div>
        )}

        <div className="flex gap-2 pt-2">
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
