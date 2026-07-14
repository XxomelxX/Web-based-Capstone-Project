'use client';

import { useEffect, useState } from 'react';
import { getCategories, addCategory, Category } from '@/lib/api/categories';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');

  function refresh() {
    getCategories().then(setCategories);
  }
  useEffect(refresh, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await addCategory(form);
      setShowModal(false);
      setForm({ name: '', description: '' });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-sm text-gray-500">{categories.length} categories · group your products</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-purple-600 text-white rounded-md px-4 py-2 text-sm font-medium">
          + Add Category
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">Category</th>
              <th className="p-3">Description</th>
              <th className="p-3">Products</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-gray-500">{c.description}</td>
                <td className="p-3">{c._count?.products ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">New Category</h3>
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
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
