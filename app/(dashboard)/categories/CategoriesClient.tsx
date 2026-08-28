'use client';

import { useEffect, useState, useCallback } from 'react';
import { getCategories, addCategory, updateCategory, Category } from '@/lib/api/categories';
import { getProducts, Product } from '@/lib/api/products';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';

export default function CategoriesClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', description: '', archived: false });
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    if (offlineNow) {
      const cachedCats = getCategory2Cache<Category[]>('categories');
      if (cachedCats.data) {
        setCategories(cachedCats.data);
        setIsCached(true);
        setCachedTime(cachedCats.formattedTime || cachedCats.cachedAt);
      }
      const cachedProds = getCategory2Cache<Product[]>('products_active');
      if (cachedProds.data) setAllProducts(cachedProds.data);
    } else {
      getCategories()
        .then((cats) => {
          setCategories(cats);
          saveCategory2Cache('categories', cats);
          setIsCached(false);
          setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
        })
        .catch(() => {
          const cachedCats = getCategory2Cache<Category[]>('categories');
          if (cachedCats.data) {
            setCategories(cachedCats.data);
            setIsCached(true);
            setCachedTime(cachedCats.formattedTime || cachedCats.cachedAt);
          }
        });

      getProducts().then(setAllProducts).catch(() => {});
    }
  }, []);

  useRealtime({
    categories: refresh,
    products: refresh,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();

    function handleReconnect() {
      refresh();
    }

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
    setEditingCategory(null);
    setForm({ name: '', description: '', archived: false });
    setError('');
    setShowModal(true);
  }

  function openEdit(c: Category) {
    if (!checkOnlineOrSetError()) return;
    setEditingCategory(c);
    setForm({ name: c.name, description: c.description ?? '', archived: c.archived ?? false });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkOnlineOrSetError()) return;
    setError('');
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: form.name,
          description: form.description || null,
          archived: form.archived,
        });
      } else {
        await addCategory({ name: form.name, description: form.description || undefined });
      }
      setShowModal(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save category');
    }
  }

  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);

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
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-sm text-slate-400">{activeCategories.length} active categories · group your products</p>
        </div>
        <button
          onClick={openAdd}
          disabled={isOffline}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md px-4 py-2 text-sm font-medium transition"
        >
          + Add Category
        </button>
      </div>

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[500px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="p-3">Category</th>
              <th className="p-3">Description</th>
              <th className="p-3">Products</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {activeCategories.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-slate-500">No categories yet.</td></tr>
            ) : (
              activeCategories.map((c) => {
                const count = allProducts.filter((p) => p.categoryId === c.id).length;
                return (
                  <tr key={c.id} className="hover:bg-slate-900/50">
                    <td className="p-3 font-medium text-slate-100">{c.name}</td>
                    <td className="p-3 text-slate-400">{c.description || '—'}</td>
                    <td className="p-3 text-slate-400">
                      {count} product{count !== 1 ? 's' : ''}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(c)}
                          disabled={isOffline}
                          className="text-slate-400 hover:text-cyan-400 disabled:opacity-40 transition"
                          title={isOffline ? 'This action requires an internet connection' : 'Edit category'}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {archivedCategories.length > 0 && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
          <div className="bg-amber-950/30 px-4 py-2 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-amber-400">Archived Categories ({archivedCategories.length})</h2>
          </div>
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-800 text-slate-400">
              {archivedCategories.map((c) => (
                <tr key={c.id} className="hover:bg-slate-900/50">
                  <td className="p-3 font-medium text-slate-400">{c.name}</td>
                  <td className="p-3 text-slate-500">{c.description || '—'}</td>
                  <td className="p-3">
                    <button
                      onClick={() => openEdit(c)}
                      disabled={isOffline}
                      className="text-xs text-emerald-400 font-medium hover:underline disabled:opacity-40"
                    >
                      ↩ Unarchive (Edit)
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">{editingCategory ? 'Edit Category' : 'New Category'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">×</button>
            </div>
            {isOffline && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                This action requires an internet connection.
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            {editingCategory && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.archived}
                  onChange={(e) => setForm({ ...form, archived: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700"
                />
                Archive this category
              </label>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={isOffline} className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">
                {editingCategory ? 'Save Changes' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
