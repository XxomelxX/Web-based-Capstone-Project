'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/client/offline';
import {
  fetchActiveProductsOnline,
  fetchArchivedProductsOnline,
  addProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
  Product,
} from '@/lib/client/api/products';
import { getCategories, Category } from '@/lib/client/api/categories';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { ArchivedSection } from '@/components/ArchivedSection';
import { SearchInput } from '@/components/SearchInput';
import { formatDate } from '@/lib/client/timeUtils';

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const GOODS_BADGE: Record<string, string> = {
  perishable: 'bg-orange-100 text-orange-700',
  'non-perishable': 'bg-green-100 text-green-700',
  durable: 'bg-blue-100 text-blue-700',
};

const VAT_BADGE: Record<string, string> = {
  exempt: 'bg-slate-100 text-slate-600',
  regular: 'bg-emerald-100 text-emerald-700',
  'zero-rated': 'bg-amber-100 text-amber-700',
};

const VAT_LABEL: Record<string, string> = {
  exempt: 'VAT Exempt',
  regular: 'Regular VAT (12%)',
  'zero-rated': 'Zero-Rated',
};

function getExpiryBadge(expiryDate?: string | Date | null) {
  if (!expiryDate) return null;
  const now = new Date();
  const exp = new Date(expiryDate);
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { label: 'Expired', className: 'bg-rose-100 text-rose-700' };
  if (daysLeft <= 30) return { label: `${daysLeft}d left`, className: 'bg-amber-100 text-amber-700' };
  return { label: formatDate(exp), className: 'bg-slate-100 text-slate-600' };
}

export default function ProductsClient() {
  const liveProducts = useLiveQuery(() => db.products.toArray());
  const liveCategories = useLiveQuery(() => db.categories.toArray());
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    price: '',
    stock: '',
    goodsType: 'non-perishable',
    vatType: 'exempt',
    expiryDate: '',
  });
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allProducts: Product[] = (liveProducts ?? []) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: Category[] = (liveCategories ?? []) as any;

  const debouncedSearch = useDebouncedValue(search, 200).trim().toLowerCase();

  function productMatches(p: Product): boolean {
    if (!debouncedSearch) return true;
    const categoryName =
      p.category?.name ?? categories.find((c) => c.id === p.categoryId)?.name ?? '';
    return (
      p.name.toLowerCase().includes(debouncedSearch) ||
      (p.barcode ?? '').toLowerCase().includes(debouncedSearch) ||
      categoryName.toLowerCase().includes(debouncedSearch)
    );
  }

  const activeProducts = allProducts.filter((p) => !p.archived && productMatches(p));
  const archivedProducts = allProducts.filter((p) => p.archived && productMatches(p));

  // In-flight guard: archive triggers both an explicit refresh() and an
  // SSE-triggered refresh(); coalesce overlaps so concurrent runs can't
  // interleave partial writes.
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) {
      await refreshPromiseRef.current.catch(() => {});
      return;
    }
    const run = (async () => {
      const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
      setIsOffline(offlineNow);
      if (offlineNow) return;

      try {
        // Side-effect-free fetches: no intermediate Dexie writes, so overlapping
        // refreshes can't wipe each other's subset. Single authoritative write below.
        const [activeProds, archivedProds, cats] = await Promise.all([
          fetchActiveProductsOnline(),
          fetchArchivedProductsOnline(),
          getCategories(),
        ]);
        await db.transaction('rw', db.products, async () => {
          await db.products.clear();
          await db.products.bulkPut([...activeProds, ...archivedProds] as unknown as Record<string, unknown>[]);
        });
        await db.categories.bulkPut(cats as unknown as Record<string, unknown>[]);
        setIsCached(false);
      } catch {
        setIsCached(true);
      }
    })();
    refreshPromiseRef.current = run;
    try {
      await run;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, []);

  useRealtime({
    products: () => refresh(),
    categories: () => refresh(),
    restock: () => refresh(),
  });

  useEffect(() => {
    refresh();
    function handleReconnect() { refresh(); }
    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [refresh]);

  function checkOnlineOrSetError(): boolean {
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return false;
    }
    return true;
  }

  function openAdd() {
    if (!checkOnlineOrSetError()) return;
    setEditingProduct(null);
    setForm({ name: '', categoryId: '', price: '', stock: '', goodsType: 'non-perishable', vatType: 'exempt', expiryDate: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(p: Product) {
    if (!checkOnlineOrSetError()) return;
    setEditingProduct(p);
    setForm({
      name: p.name,
      categoryId: String(p.categoryId),
      price: String(p.price),
      stock: String(p.stock),
      goodsType: p.goodsType || 'non-perishable',
      vatType: p.vatType || 'exempt',
      expiryDate: p.expiryDate ? new Date(p.expiryDate).toISOString().split('T')[0] : '',
    });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkOnlineOrSetError()) return;
    setError('');
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: form.name,
          categoryId: Number(form.categoryId),
          price: Number(form.price),
          stock: Number(form.stock),
          goodsType: form.goodsType,
          vatType: form.vatType,
          expiryDate: form.expiryDate || null,
        });
      } else {
        await addProduct({
          name: form.name,
          categoryId: Number(form.categoryId),
          price: Number(form.price),
          stock: Number(form.stock),
          goodsType: form.goodsType,
          vatType: form.vatType,
          expiryDate: form.expiryDate || null,
        });
      }
      setShowModal(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  }

  async function handleArchive(id: number) {
    if (!checkOnlineOrSetError()) return;
    try {
      // Optimistic Dexie update so the row moves immediately without a reload.
      await db.products.update(id, { archived: true });
      await archiveProduct(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive product');
      await refresh();
    }
  }

  async function handleUnarchive(id: number) {
    if (!checkOnlineOrSetError()) return;
    try {
      await db.products.update(id, { archived: false });
      await unarchiveProduct(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive product');
      await refresh();
    }
  }

  return (
    <div className="space-y-4">
      <CachedDataBanner
        isOffline={isOffline}
        isCached={isCached}
        onRefresh={refresh}
      />

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Products</h1>
        <button
          onClick={openAdd}
          disabled={isOffline}
          className="bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md px-4 py-2 text-sm font-medium transition cursor-pointer"
        >
          + Add Product
        </button>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search products..."
        ariaLabel="Search products"
      />

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[600px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="p-3">Product Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Goods Type</th>
              <th className="p-3">VAT</th>
              <th className="p-3">Expiry</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {activeProducts.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  {debouncedSearch
                    ? <>No products found for &quot;{search.trim()}&quot;</>
                    : 'No active products.'}
                </td>
              </tr>
            ) : (
              activeProducts.map((p) => (
                <tr key={p.id} className="hover:bg-slate-900/50">
                  <td className="p-3 font-medium text-slate-100">{p.name}</td>
                  <td className="p-3 text-slate-400">{p.category?.name || 'Uncategorized'}</td>
                  <td className="p-3 font-semibold text-emerald-400">₱{p.price}</td>
                  <td className="p-3">
                    <span className={p.stock < 20 ? 'text-rose-400 font-semibold' : 'text-slate-300'}>{p.stock}</span>
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${GOODS_BADGE[p.goodsType] ?? 'bg-slate-800 text-slate-300'}`}>
                      {p.goodsType}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${VAT_BADGE[p.vatType] ?? 'bg-slate-800 text-slate-300'}`}>
                      {VAT_LABEL[p.vatType] ?? p.vatType}
                    </span>
                  </td>
                  <td className="p-3">
                    {(() => {
                      const badge = getExpiryBadge(p.expiryDate);
                      return badge ? (
                        <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      );
                    })()}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        disabled={isOffline}
                        className="text-slate-400 hover:text-cyan-400 disabled:opacity-40 transition cursor-pointer"
                        title={isOffline ? 'This action requires an internet connection' : 'Edit product'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleArchive(p.id)}
                        disabled={isOffline}
                        className="text-slate-400 hover:text-amber-400 disabled:opacity-40 transition cursor-pointer"
                        title={isOffline ? 'This action requires an internet connection' : 'Archive product'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ArchivedSection title="Archived Products" count={archivedProducts.length}>
        {archivedProducts.map((p) => (
          <tr key={p.id} className="hover:bg-slate-900/50">
            <td className="p-3 font-medium text-slate-400">{p.name}</td>
            <td className="p-3 text-slate-500">
              {p.category?.name
                ?? categories.find((c) => c.id === p.categoryId)?.name
                ?? 'Uncategorized'}
              {' · '}₱{p.price}
              {' · '}Stock: {p.stock}
              {p.barcode ? ` · ${p.barcode}` : ''}
            </td>
            <td className="p-3">
              <button
                onClick={() => handleUnarchive(p.id)}
                disabled={isOffline}
                className="text-xs text-emerald-400 font-medium hover:underline disabled:opacity-40 cursor-pointer"
                title={isOffline ? 'This action requires an internet connection' : 'Unarchive product'}
              >
                ↩ Unarchive (Edit)
              </button>
            </td>
          </tr>
        ))}
      </ArchivedSection>

      {showModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-white">
              {editingProduct ? 'Edit Product' : 'Add New Product'}
            </h2>
            {isOffline && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                This action requires an internet connection.
              </p>
            )}
            <form onSubmit={handleSubmit} className="space-y-3 text-sm">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Category</label>
                <select
                  required
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                >
                  <option value="">Select Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Price (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Stock</label>
                  <input
                    type="number"
                    required
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Goods Type</label>
                <select
                  value={form.goodsType}
                  onChange={(e) => setForm({ ...form, goodsType: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                >
                  <option value="non-perishable">Non-Perishable</option>
                  <option value="perishable">Perishable</option>
                  <option value="durable">Durable</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">VAT Type</label>
                <select
                  value={form.vatType}
                  onChange={(e) => setForm({ ...form, vatType: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                >
                  <option value="exempt">VAT Exempt (0%)</option>
                  <option value="regular">Regular VAT (12%)</option>
                  <option value="zero-rated">Zero-Rated (0%)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Expiry Date <span className="text-slate-500 font-normal">(optional)</span></label>
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isOffline}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl font-semibold cursor-pointer"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
