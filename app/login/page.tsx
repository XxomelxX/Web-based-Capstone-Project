'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid username or password.');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <div className="flex-1 bg-slate-900 hidden md:flex flex-col items-center justify-center text-cyan-200">
        <div className="w-20 h-20 bg-cyan-500/20 rounded-2xl flex items-center justify-center mb-4 text-3xl">
          🏪
        </div>
        <h1 className="text-2xl font-serif italic">J &amp; J Merchandise Store</h1>
      </div>

      <div className="flex-1 flex items-center justify-center bg-slate-950 p-6">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl shadow-lg p-8 space-y-5"
        >
          <div>
            <h2 className="text-xl font-bold text-slate-100">Sign in</h2>
            <p className="text-sm text-slate-400">Access your inventory dashboard</p>
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-950/20 border border-red-700 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-200">Username</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-200">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium rounded-md py-2 transition disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-center text-xs text-slate-500 pt-2">
          </p>
        </form>
      </div>
    </div>
  );
}
