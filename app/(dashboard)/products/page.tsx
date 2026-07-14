'use client';

import { useEffect, useState } from 'react';
import { getProducts, addProduct, archiveProduct, Product } from '@/lib/api/products';
import { getCategories, Category } from '@/lib/api/categories';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', categoryId: '', price: '', stock: '' });
  const [error, setError] = useState('');

  function refresh() {
    getProducts().then(setProducts);
    getCategories().then(setCategories);
  }

  useEffect(refresh, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await addProduct({
        name: form.name,
        categoryId: Number(form.categoryId),
        price: Number(form.price),
        stock: Number(form.stock),
      });
      setShowModal(false);
      setForm({ name: '', categoryId: '', price: '', stock: '' });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add product');
    }
  }

  async function handleArchive(id: number) {
    await archiveProduct(id);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Products</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-green-700 text-white rounded-md px-4 py-2 text-sm font-medium"
        >
          + Add Product
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">Product Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3">{p.name}</td>
                <td className="p-3">{p.category?.name}</td>
                <td className="p-3">₱{p.price}</td>
                <td className="p-3">
                  <span className={p.stock < 20 ? 'text-red-600 font-semibold' : ''}>{p.stock}</span>
                </td>
                <td className="p-3">
                  <button onClick={() => handleArchive(p.id)} className="text-xs text-gray-500 hover:text-red-600">
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">Add Product</h3>
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

            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border rounded-md px-4 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">
                Add Product
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
