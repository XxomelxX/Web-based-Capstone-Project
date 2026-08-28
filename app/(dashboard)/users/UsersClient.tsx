'use client';

import { useEffect, useState, useCallback } from 'react';
import { getUsers, addUser, updateUser, deleteUser, deactivateUser } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { useCurrentUser } from '@/lib/useCurrentUser';

interface User { id: number; fullName: string; username: string; email: string; role: string; status: string; createdAt: string }

export default function UsersClient() {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState<User[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '', role: 'cashier' as 'admin' | 'cashier' });
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [canDeactivate, setCanDeactivate] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editError, setEditError] = useState('');
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    getUsers<User>().then(setUsers).catch(() => {});
  }, []);

  useRealtime({
    users: refresh,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
    function handleOnlineChange() {
      setIsOffline(typeof window !== 'undefined' && !navigator.onLine);
    }
    window.addEventListener('online', handleOnlineChange);
    window.addEventListener('offline', handleOnlineChange);
    return () => {
      window.removeEventListener('online', handleOnlineChange);
      window.removeEventListener('offline', handleOnlineChange);
    };
  }, [refresh]);

  function checkOnlineOrSetError(setErrFn: (msg: string) => void): boolean {
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setErrFn('This action requires an internet connection');
      return false;
    }
    return true;
  }

  function openAdd() {
    if (!checkOnlineOrSetError(setError)) return;
    setError('');
    setShowModal(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!checkOnlineOrSetError(setError)) return;
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
    if (!checkOnlineOrSetError(setEditError)) return;
    setEditError('');
    try {
      await updateUser(editTarget.id, { fullName: editName, newPassword: newPassword || undefined });
      setEditTarget(null);
      setNewPassword('');
      refresh();
      if (editTarget.id === Number(user?.id)) {
        window.location.reload();
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  function openEdit(u: User) {
    if (!checkOnlineOrSetError(setError)) return;
    setEditTarget(u);
    setEditName(u.fullName);
    setNewPassword('');
    setEditError('');
  }

  function openDelete(u: User) {
    if (!checkOnlineOrSetError(setError)) return;
    setDeleteTarget(u);
    setDeleteError('');
    setCanDeactivate(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    if (!checkOnlineOrSetError(setDeleteError)) return;
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
    if (!checkOnlineOrSetError(setDeleteError)) return;
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

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Page Not Available</h1>
        <p className="text-slate-400 text-sm">User management is only available to store administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isOffline && (
        <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold">
          ⚠️ User Account Management is disabled while offline. (Category 3 Security Risk)
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">User Accounts</h1>
          <p className="text-sm text-slate-400">Manage cashier and admin accounts</p>
        </div>
        <button
          onClick={openAdd}
          disabled={isOffline}
          className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold transition"
        >
          + Add User
        </button>
      </div>

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[600px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="p-3">Full Name</th>
              <th className="p-3">Username</th>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-900/50">
                <td className="p-3 font-medium text-slate-100">{u.fullName}</td>
                <td className="p-3 text-cyan-400">@{u.username}</td>
                <td className="p-3 text-slate-400">{u.email}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${u.role === 'admin' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'inactive' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                    {u.status || 'active'}
                  </span>
                </td>
                <td className="p-3 space-x-2">
                  <button onClick={() => openEdit(u)} disabled={isOffline} className="text-xs text-cyan-400 hover:underline disabled:opacity-40">Edit</button>
                  <button onClick={() => openDelete(u)} disabled={isOffline} className="text-xs text-rose-400 hover:underline disabled:opacity-40">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Add New User</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Full Name</label>
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Username</label>
              <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Email</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Password</label>
              <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'cashier' })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1">
                <option value="cashier">Cashier</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={isOffline} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">Create Account</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit User Modal */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Edit User: @{editTarget.username}</h3>
              <button onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {editError && <p className="text-sm text-rose-400">{editError}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Full Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">New Password (leave blank to keep current)</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditTarget(null)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button onClick={handleEdit} disabled={isOffline} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Delete User: {deleteTarget.fullName}</h3>
              <button onClick={() => setDeleteTarget(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {deleteError && <p className="text-sm text-rose-400">{deleteError}</p>}
            <p className="text-sm text-slate-300">Are you sure you want to delete user <strong>@{deleteTarget.username}</strong>?</p>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setDeleteTarget(null)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              {canDeactivate ? (
                <button onClick={handleDeactivate} disabled={isOffline} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">Deactivate User</button>
              ) : (
                <button onClick={handleDelete} disabled={isOffline} className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">Delete Account</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
