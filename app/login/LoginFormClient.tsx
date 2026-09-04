'use client';

import { useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { User, Lock, Eye, EyeOff } from 'lucide-react';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/offline';

async function checkRealConnectivity(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export default function LoginFormClient() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const cleanUsername = username.trim().toLowerCase();
    setLoading(true);

    const reallyOnline = await checkRealConnectivity();

    if (!reallyOnline) {
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

    try {
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
    } catch (networkErr) {
      console.error('signIn() threw unexpectedly (likely actually offline):', networkErr);
      setError(
        'Connection lost during sign in. Please try again once you have a stable connection, or use offline login if this device has logged in before.'
      );
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Heading */}
      <h2
        className="text-4xl font-bold text-[#1a3a2a] text-center mb-8 tracking-widest"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        LOGIN
      </h2>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Username */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Username
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
              <User className="h-5 w-5 text-[#1a3a2a]/60" />
            </div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder=""
              required
              className="block w-full rounded-full bg-[#6b9e8e]/40 border-none py-3 pl-12 pr-4 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#1a3a2a]/30"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
              <Lock className="h-5 w-5 text-[#1a3a2a]/60" />
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=""
              required
              className="block w-full rounded-full bg-[#6b9e8e]/40 border-none py-3 pl-12 pr-12 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#1a3a2a]/30"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-[#1a3a2a]/50 hover:text-[#1a3a2a] transition"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-[#6b9e8e] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#5a8a7a] disabled:opacity-60 mt-4"
        >
          {loading ? 'Signing in...' : 'LOGIN'}
        </button>
      </form>

      {/* Remember me + Forgot password */}
      <div className="flex items-center justify-between mt-5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#1a3a2a] focus:ring-[#1a3a2a] cursor-pointer"
          />
          <span className="text-sm text-gray-600">Remember me</span>
        </label>
        <a
          href="/forgot-password"
          className="text-sm text-[#1a3a2a] hover:underline transition"
        >
          Forgot Password?
        </a>
      </div>
    </div>
  );
}
