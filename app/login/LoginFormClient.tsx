"use client";

import { useState } from 'react';
import Image from 'next/image';
import { getSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/offline';

export default function LoginFormClient() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const cleanUsername = username.trim().toLowerCase();

    // --- 1. OFFLINE LOGIN FLOW ---
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setLoading(true);
      try {
        const cached = await db.cachedCredentials.get(cleanUsername);

        if (!cached) {
          setError(
            'This account has never logged in on this device while online. Please connect to the internet once to enable offline login.'
          );
          setLoading(false);
          return;
        }

        const passwordMatches = await bcrypt.compare(password, cached.passwordHash);
        if (!passwordMatches) {
          setError('Incorrect username or password.');
          setLoading(false);
          return;
        }

        // Store offline session locally — preserves exact cached role ('admin' or 'cashier')
        sessionStorage.setItem(
          'offlineSession',
          JSON.stringify({
            id: cached.userId,
            name: cached.fullName,
            username: cached.username,
            role: cached.role,
          })
        );

        setLoading(false);
        router.push('/dashboard');
        return;
      } catch (err) {
        console.error('Offline authentication error:', err);
        setError('Offline authentication failed.');
        setLoading(false);
        return;
      }
    }

    // --- 2. ONLINE LOGIN FLOW ---
    setLoading(true);

    const result = await signIn('credentials', {
      username: cleanUsername,
      password,
      redirect: false,
      callbackUrl: '/dashboard',
    });

    if (!result || !result.ok) {
      setLoading(false);
      setError(
        `Invalid username or password. ${result?.error ? `(${result.error})` : ''}`
      );
      return;
    }

    // On successful online login, clear old offline session and cache fresh credentials
    sessionStorage.removeItem('offlineSession');
    try {
      const session = await getSession();
      if (session?.user) {
        const localHash = await bcrypt.hash(password, 10);
        await db.cachedCredentials.put({
          username: cleanUsername,
          passwordHash: localHash,
          role: (session.user.role as 'admin' | 'cashier') || 'cashier',
          fullName: session.user.name || username,
          userId: Number(session.user.id || 0),
          cachedAt: new Date().toISOString(),
        });
      }
    } catch (cacheErr) {
      console.warn('Failed to cache user credentials locally:', cacheErr);
    }

    setLoading(false);
    const destination = result.url ?? '/dashboard';
    router.push(destination);
  }

  return (
    <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-slate-950/60 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 flex h-44 w-72 items-center justify-center overflow-hidden rounded-2xl">
          <Image
            src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg"
            alt="Sari-Sari POS"
            width={288}
            height={176}
            className="object-contain"
          />
        </div>
        <h2 className="text-3xl font-bold text-slate-100">Welcome Back</h2>
        <p className="mt-2 text-sm text-slate-400">Sign in to your store dashboard.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-300">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
            required
            className="mt-2 w-full rounded-3xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            className="mt-2 w-full rounded-3xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>

        {error && (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-3xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
