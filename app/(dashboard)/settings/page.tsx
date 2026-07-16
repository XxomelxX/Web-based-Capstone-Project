'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getSettings, updateSettings } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface Settings { id: number; storeName: string; currency: string; address?: string; taxRate: number; lowStockThreshold: number }

export default function SettingsPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const isAdmin = session?.user?.role === 'admin';

  function refresh() {
    getSettings<Settings>().then(setSettings);
  }

  useRealtime({
    settings: refresh,
  });

  useEffect(() => {
    refresh();
  }, []);

  async function handleSave() {
    if (!settings) return;
    await updateSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!settings) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500">Configure your store and preferences</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">🏪 Store Information</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Store name</label>
            <input disabled={!isAdmin} value={settings.storeName} onChange={(e) => setSettings({ ...settings, storeName: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1 disabled:bg-gray-50" />
          </div>
          <div>
            <label className="text-sm font-medium">Currency</label>
            <input disabled={!isAdmin} value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1 disabled:bg-gray-50" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Address</label>
          <input disabled={!isAdmin} value={settings.address ?? ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1 disabled:bg-gray-50" />
        </div>

        <div>
          <label className="text-sm font-medium">Low-stock threshold</label>
          <input disabled={!isAdmin} type="number" value={settings.lowStockThreshold} onChange={(e) => setSettings({ ...settings, lowStockThreshold: Number(e.target.value) })} className="w-full border rounded-md px-3 py-2 mt-1 disabled:bg-gray-50" />
        </div>

        <div className="bg-green-50 rounded-lg p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-2">👤 Account</h3>
          <p className="text-xs text-gray-500">Signed in as</p>
          <p className="font-medium">{session?.user?.name}</p>
          <p className="text-xs text-gray-500 mt-2">Role</p>
          <p className="font-medium uppercase text-xs">{session?.user?.role}</p>
        </div>

        {isAdmin && (
          <div className="flex justify-end gap-2 pt-2">
            {saved && <span className="text-sm text-green-600 self-center">Saved ✓</span>}
            <button className="border rounded-md px-4 py-2 text-sm">Reset</button>
            <button onClick={handleSave} className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm">Save Changes</button>
          </div>
        )}
      </div>
    </div>
  );
}
