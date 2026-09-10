'use client';

import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'sari-sari-pwa-dismissed';

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) {
      setInstalled(true);
      return;
    }

    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed) return;

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    }

    function handleAppInstalled() {
      setInstalled(true);
      setShowBanner(false);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
    setShowBanner(false);
  }

  function handleDismiss() {
    setShowBanner(false);
    localStorage.setItem(DISMISS_KEY, '1');
  }

  if (installed || !showBanner) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm font-medium backdrop-blur-md mb-4 shadow-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        <Download size={18} className="text-emerald-400 shrink-0" />
        <span className="truncate">
          Install <strong className="text-emerald-200">Sari-Sari POS</strong> on your device for faster access and offline use.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleInstall}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-100 transition text-xs font-semibold cursor-pointer"
        >
          <Download size={14} />
          Install
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1.5 rounded-lg hover:bg-emerald-500/20 transition text-emerald-400 hover:text-emerald-200 cursor-pointer"
          aria-label="Dismiss install banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
