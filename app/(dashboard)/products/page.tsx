'use client';

import { useEffect, useState } from 'react';
import {
  getProducts, getArchivedProducts, addProduct, updateProduct,
  archiveProduct, unarchiveProduct, deleteProduct, Product
} from '@/lib/api/products';
import { getCategories, Category } from '@/lib/api/categories';
import { useRealtime } from '@/lib/use-realtime';

const GOODS_BADGE: Record<string, string> = {
  perishable: 'bg-orange-100 text-orange-700',
  'non-perishable': 'bg-green-100 text-green-700',
  durable: 'bg-blue-100 text-blue-700',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [form, setForm] = useState({ name: '', categoryId: '', price: '', stock: '', goodsType: 'non-perishable' });
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);

  function refresh() {
    if (tab === 'active') {
      getProducts().then(setProducts);
    } else {
      getArchivedProducts().then(setProducts);
    }
    getCategories().then(setCategories);
  }

  useRealtime({
    products: () => refresh(),
    categories: () => refresh(),
    restock: () => refresh(),
  });

  useEffect(refresh, [tab]);

  function openAdd() {
    setEditingProduct(null);
    setForm({ name: '', categoryId: '', price: '', stock: '', goodsType: 'non-perishable' });
    setError('');
    setShowModal(true);
  }

  function openEdit(p: Product) {
    setEditingProduct(p);
    setForm({
      name: p.name,
      categoryId: String(p.categoryId),
      price: String(p.price),
      stock: String(p.stock),
      goodsType: p.goodsType || 'non-perishable',
    });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: form.name,
          categoryId: Number(form.categoryId),
          price: Number(form.price),
          stock: Number(form.stock),
          goodsType: form.goodsType,
        });
      } else {
        await addProduct({
          name: form.name,
          categoryId: Number(form.categoryId),
          price: Number(form.price),
          stock: Number(form.stock),
          goodsType: form.goodsType,
        });
      }
      setShowModal(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  }

  async function handleArchive(id: number) {
    await archiveProduct(id);
    refresh();
  }

  async function handleUnarchive(id: number) {
    await unarchiveProduct(id);
    refresh();
  }

  async function handleDelete(p: Product) {
    setError('');
    try {
      await deleteProduct(p.id);
      setDeleteConfirm(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleteConfirm(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Products</h1>
        <button
          onClick={openAdd}
          className="bg-green-700 text-white rounded-md px-4 py-2 text-sm font-medium"
        >
          + Add Product
        </button>
      </div>

      {/* Active / Archived tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === 'active' ? 'bg-white shadow text-green-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Active
        </button>
        <button
          onClick={() => setTab('archived')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === 'archived' ? 'bg-white shadow text-orange-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Archived
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">Product Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Goods Type</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-gray-400">
                {tab === 'active' ? 'No active products.' : 'No archived products.'}
              </td></tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.name}</td>
                  <td className="p-3">{p.category?.name}</td>
                  <td className="p-3">₱{p.price}</td>
                  <td className="p-3">
                    <span className={p.stock < 20 ? 'text-red-600 font-semibold' : ''}>{p.stock}</span>
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${GOODS_BADGE[p.goodsType] ?? 'bg-gray-100'}`}>
                      {p.goodsType}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {tab === 'active' ? (
                        <>
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(p)}
                            className="text-gray-500 hover:text-blue-600 transition"
                            title="Edit product"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>

                          {/* Archive */}
                          <button
                            onClick={() => handleArchive(p.id)}
                            className="text-gray-500 hover:text-orange-600 transition"
                            title="Archive product"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                            </svg>
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => !p._hasHistory && setDeleteConfirm(p)}
                            disabled={p._hasHistory}
                            className={`transition ${p._hasHistory ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-red-600'}`}
                            title={p._hasHistory ? "Can't delete — this product has sales history. Archive it instead." : 'Delete product'}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleUnarchive(p.id)}
                          className="text-xs text-green-700 font-medium hover:underline"
                        >
                          ↩ Unarchive
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

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">{editingProduct ? 'Edit Product' : 'Add Product'}</h3>
              <button type="button" onClick={() => setShowModal(false)}>×</button>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div>
              <label className="text-sm font-medium">Product Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded-md px-3 py-2 mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Category</label>
              <select
                required
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="w-full border rounded-md px-3 py-2 mt-1"
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Price (₱)</label>
                <input
                  required
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full border rounded-md px-3 py-2 mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Stock</label>
                <input
                  required
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full border rounded-md px-3 py-2 mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Goods Type</label>
              <select
                value={form.goodsType}
                onChange={(e) => setForm({ ...form, goodsType: e.target.value })}
                className="w-full border rounded-md px-3 py-2 mt-1"
              >
                <option value="perishable">🟠 Perishable</option>
                <option value="non-perishable">🟢 Non-Perishable</option>
                <option value="durable">🔵 Durable</option>
              </select>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border rounded-md px-4 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">
                {editingProduct ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-lg">Delete Product</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to permanently delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setDeleteConfirm(null)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="bg-red-600 text-white rounded-md px-4 py-2 text-sm">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
