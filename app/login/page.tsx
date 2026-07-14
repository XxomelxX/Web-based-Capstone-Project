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
    <div className="min-h-screen flex">
      <div className="flex-1 bg-green-600 hidden md:flex flex-col items-center justify-center text-white">
        <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
          🏪
        </div>
        <h1 className="text-2xl font-serif italic">J &amp; J Merchandise Store</h1>
      </div>

      <div className="flex-1 flex items-center justify-center bg-green-600 md:bg-white p-6">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm bg-white rounded-xl shadow-lg p-8 space-y-5"
        >
          <div>
            <h2 className="text-xl font-bold">Sign in</h2>
            <p className="text-sm text-gray-500">Access your inventory dashboard</p>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Username</label>
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-700 hover:bg-green-800 text-white font-medium rounded-md py-2 transition disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-center text-xs text-gray-400 pt-2">
            Demo accounts — admin / admin123 · cashier / cashier123
          </p>
        </form>
      </div>
    </div>
  );
}
