'use client';

import { useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { User, Lock, Eye, EyeOff } from 'lucide-react';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/client/offline';

type LoginConnectivity = 'online' | 'offline' | 'server-unavailable' | 'database-unavailable';

async function checkRealConnectivity(): Promise<LoginConnectivity> {
  if (typeof window === 'undefined' || !navigator.onLine) return 'offline';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => null)) as { database?: string } | null;
    if (!res.ok) {
      if (res.status === 503 || data?.database === 'disconnected') return 'database-unavailable';
      return 'server-unavailable';
    }

    return data?.database === 'disconnected' ? 'database-unavailable' : 'online';
  } catch {
    return 'server-unavailable';
  } finally {
    clearTimeout(timeoutId);
  }
}

function getSafeCallbackUrl(raw?: string | null): string {
  const fallback = '/dashboard';
  if (!raw) return fallback;
  try {
    // Absolute URL (middleware sets full request.url) — allow same-origin only.
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (typeof window !== 'undefined' && url.origin !== window.location.origin) return fallback;
      const path = `${url.pathname}${url.search}${url.hash}`;
      return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
    }
    // Relative path — must start with single slash.
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

function getFriendlyAuthError(rawError?: string | null): string {
  if (!rawError) {
    return 'Invalid username or password.';
  }

  const normalized = rawError.toLowerCase();

  if (
    normalized.includes('database unavailable') ||
    normalized.includes('can\'t reach database server') ||
    normalized.includes('database server') ||
    normalized.includes('prisma.') ||
    normalized.includes('connection') ||
    normalized.includes('timeout') ||
    normalized.includes('ecconnrefused') ||
    normalized.includes('econnreset') ||
    normalized.includes('eai_again')
  ) {
    return 'The server could not reach the database. Please try again in a moment.';
  }

  return 'Invalid username or password.';
}

export default function LoginFormClient({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();
  const safeCallbackUrl = getSafeCallbackUrl(callbackUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const cleanIdentifier = username.trim().toLowerCase();
    setLoading(true);

    const connectivity = await checkRealConnectivity();

    // Only hard-block when the browser itself is offline and we must use the
    // cached-credential path. When the server or DB is degraded, still attempt
    // online signIn once — NextAuth returns the real error (invalid credentials
    // vs DB down) instead of a misleading pre-check abort stranding users.
    if (connectivity === 'server-unavailable') {
      console.warn('Health pre-check unreachable; attempting online sign-in anyway.');
    }

    if (connectivity === 'database-unavailable') {
      console.warn('Health reports database disconnected; attempting online sign-in anyway.');
    }

    if (connectivity === 'offline') {
      try {
        const cached = await db.cachedCredentials.get(cleanIdentifier);

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

        // Shared-device safety: only wipe cached business data when the user
        // differs from the previous session owner. Same user keeps cache.
        let prevUsername: string | null = null;
        try {
          const prevRaw = sessionStorage.getItem('offlineSession');
          prevUsername = prevRaw ? ((JSON.parse(prevRaw) as { username?: string }).username ?? null) : null;
        } catch { prevUsername = null; }
        if (prevUsername && prevUsername !== cached.username) {
          try {
            const { wipeOfflineData } = await import('@/lib/client/offline');
            await wipeOfflineData();
          } catch { /* wipe best-effort */ }
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
        // Durable copy: survives tab close / new tab / browser restart, which is
        // what keeps the correct role and shift visible on a cold OFFLINE load.
        const { saveIdentity } = await import('@/lib/client/identity');
        saveIdentity({
          id: cached.userId,
          name: cached.fullName,
          username: cached.username,
          role: cached.role,
        });

        setLoading(false);
        // Full document navigation: a client-side RSC nav for a fresh
        // ?_rsc=<hash> cannot be served offline, while the precached /dashboard
        // shell can.
        window.location.assign('/dashboard');
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
        username: cleanIdentifier,
        password,
        redirect: false,
        callbackUrl: safeCallbackUrl,
      });

      if (!result || !result.ok) {
        setLoading(false);
        setError(getFriendlyAuthError(result?.error));
        return;
      }

      try {
        const session = await getSession();
        if (session?.user) {
          // Different user on a shared device: wipe the previous user's cached
          // business data BEFORE writing the new session, so cached offline
          // shells can never leak data across users.
          try {
            const prevRaw = sessionStorage.getItem('offlineSession');
            const prevUser = prevRaw ? (JSON.parse(prevRaw) as { username?: string }) : null;
            if (!prevUser || prevUser.username !== cleanIdentifier) {
              const { wipeOfflineData } = await import('@/lib/client/offline');
              await wipeOfflineData();
            }
          } catch { /* wipe best-effort */ }
          // Durable identity (localStorage) so an offline reload / new tab /
          // restart still knows who this is and keeps admin-vs-cashier nav.
          const { saveIdentity } = await import('@/lib/client/identity');
          saveIdentity({
            id: Number(session.user.id || 0),
            name: session.user.name || username,
            username: cleanIdentifier,
            role: (session.user.role as 'admin' | 'cashier') || 'cashier',
          });

          const localHash = await bcrypt.hash(password, 10);
          await db.cachedCredentials.put({
            username: cleanIdentifier,
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
      const destination = result.url ?? safeCallbackUrl;
      router.push(destination);
      router.refresh();
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
      {/* Logo */}
      <img
        src="/images/81e09f4c-f773-4009-b7d5-6ef3babd8388-removebg-preview.png"
        alt="J & J Merchandise Store"
        className="mx-auto mb-8 h-40 w-auto object-contain sm:h-48 md:h-64"
      />

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Username or email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Username or Email
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
              <User className="h-5 w-5 text-gray-600" />
            </div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder=""
              required
              className="block w-full rounded-full bg-gray-100 border border-gray-300 py-3 pl-12 pr-4 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#d97706]/30"
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
              <Lock className="h-5 w-5 text-gray-600" />
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=""
              required
              className="block w-full rounded-full bg-gray-100 border border-gray-300 py-3 pl-12 pr-12 text-sm text-gray-800 placeholder-gray-400 outline-none transition focus:ring-2 focus:ring-[#d97706]/30"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-500 hover:text-gray-800 transition"
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
          className="w-full rounded-full bg-[#f59e0b] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#d97706] disabled:opacity-60 mt-4"
        >
          {loading ? 'Signing in...' : 'LOGIN'}
        </button>
      </form>

      <div className="mt-5 flex justify-center">
        <a
          href="/forgot-password"
          className="text-sm text-[#15803d] hover:underline transition"
        >
          Forgot Password?
        </a>
      </div>
    </div>
  );
}
