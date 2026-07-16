'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getUsers, addUser, updateUser, deleteUser, deactivateUser } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface User { id: number; fullName: string; username: string; email: string; role: string; status: string; createdAt: string }

export default function UsersPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '', role: 'cashier' as 'admin' | 'cashier' });
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [canDeactivate, setCanDeactivate] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');

  function refresh() {
    getUsers<User>().then(setUsers);
  }

  useRealtime({
    users: refresh,
  });

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

  async function handleEdit() {
    if (!editTarget) return;
    setEditError('');
    try {
      await updateUser(editTarget.id, { fullName: editName });
      setEditTarget(null);
      refresh();
      if (editTarget.id === Number(session?.user?.id)) {
        window.location.reload();
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update name');
    }
  }

  function openEdit(u: User) {
    setEditTarget(u);
    setEditName(u.fullName);
    setEditError('');
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError('');
    setCanDeactivate(false);
    try {
      await deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      const typedErr = err as Error & { canDeactivate?: boolean };
      setDeleteError(typedErr.message);
      if (typedErr.canDeactivate) {
        setCanDeactivate(true);
      }
    }
  }

  async function handleDeactivate() {
    if (!deleteTarget) return;
    try {
      await deactivateUser(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteError('');
      setCanDeactivate(false);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to deactivate');
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

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">User</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Joined</th>
              {isAdmin && <th className="p-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.fullName}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${u.role === 'admin' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>{u.role}</span>
                </td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.status}
                  </span>
                </td>
                <td className="p-3">{new Date(u.createdAt).toLocaleDateString()}</td>
                {isAdmin && (
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-gray-500 hover:text-blue-600 transition"
                        title="Edit user name"
                      >
                        ✎
                      </button>
                      {/* Don't allow deleting yourself */}
                      {u.id !== Number(session?.user?.id) && (
                        <button
                          onClick={() => { setDeleteTarget(u); setDeleteError(''); setCanDeactivate(false); }}
                          className="text-gray-500 hover:text-red-600 transition"
                          title="Delete user"
                        >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-bold text-lg">Add new user</h3><button type="button" onClick={() => setShowModal(false)}>×</button></div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Full Name</label>
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Delete / Deactivate Confirmation Modal */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">Edit User Name</h3>
              <button type="button" onClick={() => setEditTarget(null)}>×</button>
            </div>
            <p className="text-sm text-gray-600">Update the name shown for this user.</p>
            <div>
              <label className="text-sm font-medium">Full Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full border rounded-md px-3 py-2 mt-1"
              />
            </div>
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditTarget(null)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleEdit} className="bg-blue-700 text-white rounded-md px-4 py-2 text-sm">Save</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-lg">Delete User</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to delete <strong>{deleteTarget.fullName}</strong>?
            </p>

            {deleteError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-700">{deleteError}</p>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setDeleteTarget(null)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              {canDeactivate ? (
                <button onClick={handleDeactivate} className="bg-orange-500 text-white rounded-md px-4 py-2 text-sm">
                  Deactivate Instead
                </button>
              ) : (
                <button onClick={handleDelete} className="bg-red-600 text-white rounded-md px-4 py-2 text-sm">
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
