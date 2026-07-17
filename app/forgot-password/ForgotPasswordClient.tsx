'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function ForgotPasswordClient() {
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!username.trim() || !newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to reset password.');
        return;
      }

      setSuccess('Password updated successfully. Please log in with your new password.');
      setUsername('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto rounded-3xl border border-slate-800 bg-slate-950/95 p-8 shadow-xl shadow-black/20">
      <h1 className="text-3xl font-semibold text-white">Admin Password Reset</h1>
      <p className="mt-3 text-sm text-slate-400">
        Reset password for an admin account. This action is restricted to signed-in admins.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {error && <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-200">{error}</div>}
        {success && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-200">{success}</div>}

        <label className="block text-sm font-medium text-slate-300">
          Admin Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500"
            placeholder="admin username"
          />
        </label>

        <label className="block text-sm font-medium text-slate-300">
          New Password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500"
            placeholder="new password"
          />
        </label>

        <label className="block text-sm font-medium text-slate-300">
          Confirm Password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500"
            placeholder="confirm password"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Updating...' : 'Reset Password'}
        </button>
      </form>
    </div>
  );
}
