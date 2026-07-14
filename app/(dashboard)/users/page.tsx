'use client';

import { useEffect, useState } from 'react';
import { getUsers, addUser } from '@/lib/api/inventory';

interface User { id: number; fullName: string; username: string; email: string; role: string; status: string; createdAt: string }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '', role: 'cashier' as 'admin' | 'cashier' });
  const [error, setError] = useState('');

  function refresh() {
    getUsers().then(setUsers);
  }
  useEffect(refresh, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await addUser(form);
      setShowModal(false);
      setForm({ fullName: '', username: '', email: '', password: '', role: 'cashier' });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add user');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-gray-500">{users.length} users registered</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">+ Add User</button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-3">User</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Joined</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.fullName}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${u.role === 'admin' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>{u.role}</span>
                </td>
                <td className="p-3"><span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">{u.status}</span></td>
                <td className="p-3">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-bold text-lg">Add new user</h3><button type="button" onClick={() => setShowModal(false)}>×</button></div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Full Name</label>
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Username</label>
                <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'cashier' })} className="w-full border rounded-md px-3 py-2 mt-1">
                <option value="cashier">Cashier</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">Create user</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
