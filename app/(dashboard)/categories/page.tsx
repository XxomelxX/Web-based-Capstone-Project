'use client';

import { useEffect, useState } from 'react';
import { getCategories, addCategory, updateCategory, deleteCategory, Category } from '@/lib/api/categories';
import { getProducts, Product } from '@/lib/api/products';
import { useRealtime } from '@/lib/use-realtime';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', description: '', archived: false });
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);
  const [viewingCategory, setViewingCategory] = useState<Category | null>(null);

  function refresh() {
    getCategories().then(setCategories);
    getProducts().then(setAllProducts);
  }

  useRealtime({
    categories: refresh,
    products: refresh,
  });

  useEffect(refresh, []);

  function openAdd() {
    setEditingCategory(null);
    setForm({ name: '', description: '', archived: false });
    setError('');
    setShowModal(true);
  }

  function openEdit(c: Category) {
    setEditingCategory(c);
    setForm({ name: c.name, description: c.description ?? '', archived: c.archived ?? false });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

  async function handleDelete(c: Category) {
    setError('');
    try {
      await deleteCategory(c.id);
      setDeleteConfirm(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleteConfirm(null);
    }
  }

  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);
  const viewProducts = viewingCategory
    ? allProducts.filter((p) => p.categoryId === viewingCategory.id)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-sm text-gray-500">{activeCategories.length} active categories · group your products</p>
        </div>
        <button onClick={openAdd} className="bg-purple-600 text-white rounded-md px-4 py-2 text-sm font-medium">
          + Add Category
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">Category</th>
              <th className="p-3">Description</th>
              <th className="p-3">Products</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeCategories.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-gray-400">No categories yet.</td></tr>
            ) : (
              activeCategories.map((c) => {
                const count = c._count?.products ?? 0;
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 text-gray-500">{c.description}</td>
                    <td className="p-3">
                      <button
                        onClick={() => setViewingCategory(c)}
                        className="text-blue-600 hover:underline"
                      >
                        {count} product{count !== 1 ? 's' : ''}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(c)}
                          className="text-gray-500 hover:text-blue-600 transition"
                          title="Edit category"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => count === 0 && setDeleteConfirm(c)}
                          disabled={count > 0}
                          className={`transition ${count > 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-red-600'}`}
                          title={count > 0 ? "Can't delete — reassign or remove its products first." : 'Delete category'}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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

      {/* Archived categories section */}
      {archivedCategories.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="bg-orange-50 px-4 py-2 border-b">
            <h2 className="text-sm font-semibold text-orange-700">Archived Categories ({archivedCategories.length})</h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {archivedCategories.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-medium text-gray-500">{c.name}</td>
                  <td className="p-3 text-gray-400">{c.description}</td>
                  <td className="p-3">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-xs text-green-700 font-medium hover:underline"
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

      {/* Add / Edit Category Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">{editingCategory ? 'Edit Category' : 'New Category'}</h3>
              <button type="button" onClick={() => setShowModal(false)}>×</button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            {editingCategory && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.archived}
                  onChange={(e) => setForm({ ...form, archived: e.target.checked })}
                  className="rounded"
                />
                Archive this category
              </label>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">
                {editingCategory ? 'Save Changes' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-lg">Delete Category</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to permanently delete <strong>{deleteConfirm.name}</strong>?
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setDeleteConfirm(null)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="bg-red-600 text-white rounded-md px-4 py-2 text-sm">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* View Products Modal */}
      {viewingCategory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">{viewingCategory.name} — Products</h3>
              <button onClick={() => setViewingCategory(null)}>×</button>
            </div>
            {viewProducts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No products in this category.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-2">Product</th>
                    <th className="py-2">Price</th>
                    <th className="py-2">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {viewProducts.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-2">{p.name}</td>
                      <td className="py-2">₱{p.price}</td>
                      <td className="py-2">
                        <span className={p.stock < 20 ? 'text-red-600 font-semibold' : ''}>{p.stock}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={() => setViewingCategory(null)} className="border rounded-md px-4 py-2 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
