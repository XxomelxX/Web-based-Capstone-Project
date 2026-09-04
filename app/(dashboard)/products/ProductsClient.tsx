'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getProducts,
  getArchivedProducts,
  addProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
  Product,
} from '@/lib/api/products';
import { getCategories, Category } from '@/lib/api/categories';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';

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
  return { label: exp.toLocaleDateString(), className: 'bg-slate-100 text-slate-600' };
}

export default function ProductsClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
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
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    if (offlineNow) {
      const cachedProds = getCategory2Cache<Product[]>(`products_${tab}`);
      if (cachedProds.data) {
        setProducts(cachedProds.data);
        setIsCached(true);
        setCachedTime(cachedProds.formattedTime || cachedProds.cachedAt);
      }
      const cachedCats = getCategory2Cache<Category[]>('categories');
      if (cachedCats.data) {
        setCategories(cachedCats.data);
      }
    } else {
      const fetchFn = tab === 'active' ? getProducts : getArchivedProducts;
      fetchFn()
        .then((prods) => {
          setProducts(prods);
          saveCategory2Cache(`products_${tab}`, prods);
          setIsCached(false);
          setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
        })
        .catch(() => {
          const cachedProds = getCategory2Cache<Product[]>(`products_${tab}`);
          if (cachedProds.data) {
            setProducts(cachedProds.data);
            setIsCached(true);
            setCachedTime(cachedProds.formattedTime || cachedProds.cachedAt);
          }
        });

      getCategories()
        .then((cats) => {
          setCategories(cats);
          saveCategory2Cache('categories', cats);
        })
        .catch(() => {
          const cachedCats = getCategory2Cache<Category[]>('categories');
          if (cachedCats.data) setCategories(cachedCats.data);
        });
    }
  }, [tab]);

  useRealtime({
    products: () => refresh(),
    categories: () => refresh(),
    restock: () => refresh(),
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();

    function handleReconnect() {
      refresh();
    }

    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [tab, refresh]);

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
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  }

  async function handleArchive(id: number) {
    if (!checkOnlineOrSetError()) return;
    try {
      await archiveProduct(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive product');
    }
  }

  async function handleUnarchive(id: number) {
    if (!checkOnlineOrSetError()) return;
    try {
      await unarchiveProduct(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive product');
    }
  }

  return (
    <div className="space-y-4">
      <CachedDataBanner
        cachedAt={cachedTime}
        formattedTime={cachedTime}
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

      <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit border border-slate-800">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition cursor-pointer ${tab === 'active' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Active
        </button>
        <button
          onClick={() => setTab('archived')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition cursor-pointer ${tab === 'archived' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Archived
        </button>
      </div>

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
            {products.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  {tab === 'active' ? 'No active products.' : 'No archived products.'}
                </td>
              </tr>
            ) : (
              products.map((p) => (
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
                      {tab === 'active' ? (
                        <>
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
                        </>
                      ) : (
                        <button
                          onClick={() => handleUnarchive(p.id)}
                          disabled={isOffline}
                          className="text-xs text-emerald-400 font-medium hover:underline disabled:opacity-40 cursor-pointer"
                          title={isOffline ? 'This action requires an internet connection' : 'Unarchive product'}
                        >
                          Unarchive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
