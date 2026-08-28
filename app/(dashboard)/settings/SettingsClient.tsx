'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSettings, updateSettings } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { useCurrentUser } from '@/lib/useCurrentUser';

interface Settings { id: number; storeName: string; currency: string; address?: string; taxRate: number; lowStockThreshold: number }

export default function SettingsClient() {
  const { user } = useCurrentUser();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const isAdmin = user?.role === 'admin';

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    getSettings<Settings>().then(setSettings).catch(() => {});
  }, []);

  useRealtime({
    settings: refresh,
  });

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

  async function handleSave() {
    if (!settings) return;
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    try {
      await updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  }

  if (!settings) return <p className="text-slate-400">Loading settings...</p>;

  if (!isAdmin) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-white">Page not available</h1>
          <p className="text-sm text-slate-400">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {isOffline && (
        <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold">
          ⚠️ Changing system settings is disabled while offline. (Category 3 System Conflict Risk)
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400">Configure your store and preferences</p>
      </div>

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow p-6 space-y-4 text-slate-200">
        <h2 className="font-semibold flex items-center gap-2 text-white">🏪 Store Information</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-300">Store name</label>
            <input disabled={!isAdmin || isOffline} value={settings.storeName} onChange={(e) => setSettings({ ...settings, storeName: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1 disabled:opacity-50" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300">Currency</label>
            <input disabled={!isAdmin || isOffline} value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1 disabled:opacity-50" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300">Address</label>
          <input disabled={!isAdmin || isOffline} value={settings.address ?? ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1 disabled:opacity-50" />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300">Low-stock threshold</label>
          <input disabled={!isAdmin || isOffline} type="number" value={settings.lowStockThreshold} onChange={(e) => setSettings({ ...settings, lowStockThreshold: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1 disabled:opacity-50" />
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-2 text-white">👤 Account</h3>
          <p className="text-xs text-slate-400">Signed in as</p>
          <p className="font-medium text-slate-100">{session?.user?.name}</p>
          <p className="text-xs text-slate-400 mt-2">Role</p>
          <p className="font-medium uppercase text-xs text-cyan-400">{session?.user?.role}</p>
        </div>

        {isAdmin && (
          <div className="flex justify-end gap-2 pt-2">
            {saved && <span className="text-sm text-emerald-400 self-center font-semibold">Saved ✓</span>}
            <button type="button" onClick={refresh} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Reset</button>
            <button onClick={handleSave} disabled={isOffline} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold transition">Save Changes</button>
          </div>
        )}
      </div>
    </div>
  );
}
