'use client';

/**
 * Durable identity store.
 *
 * WHY THIS EXISTS: `sessionStorage` is per-tab and dies on tab close / new tab /
 * browser restart. The offline shell used it as its only identity source
 * (offlineSession), so a cold offline load had `user === null`. Every consumer
 * that defaults a missing role — TopNavbar/BottomTabBar (`user?.role ?? 'cashier'`),
 * SettingsClient — then silently downgraded an admin to the cashier UI, and
 * POSClient.loadShiftData() bailed before it could even read the cached shift.
 * That is why the app could not "stay on the admin side" or keep an open shift
 * while offline.
 *
 * localStorage survives reload/new-tab/restart. Logout still wipes it (see
 * wipeOfflineData), so the shared-device guarantee is unchanged.
 */

export interface StoredIdentity {
  id: number | string;
  name: string;
  role: string;
  username?: string;
  savedAt: string;
}

const IDENTITY_KEY = 'sari-pos-identity';
// Legacy per-tab mirror, still written so existing readers keep working
// (lib/client/api/inventory.ts readSessionUser for void requests).
const LEGACY_SESSION_KEY = 'offlineSession';

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

/** Normalise anything identity-shaped into a StoredIdentity. */
export function toIdentity(
  input: { id?: number | string; name?: string; role?: string; username?: string } | null | undefined
): StoredIdentity | null {
  if (!input) return null;
  const role = typeof input.role === 'string' && input.role ? input.role : null;
  // A record without a role is worse than no record: it re-creates the
  // "defaults to cashier" downgrade this module exists to prevent.
  if (!role) return null;
  const name = typeof input.name === 'string' && input.name ? input.name : '';
  return {
    id: input.id ?? 0,
    name,
    role,
    username: typeof input.username === 'string' ? input.username : undefined,
    savedAt: new Date().toISOString(),
  };
}

export function saveIdentity(
  input: { id?: number | string; name?: string; role?: string; username?: string } | null | undefined
): StoredIdentity | null {
  const identity = toIdentity(input);
  if (!canUseWindow()) return identity;
  if (!identity) return null;
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    window.sessionStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({
      id: identity.id,
      name: identity.name,
      username: identity.username,
      role: identity.role,
    }));
  } catch { /* storage unavailable (private mode) — callers fall back */ }
  return identity;
}

export function readIdentity(): StoredIdentity | null {
  if (!canUseWindow()) return null;
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredIdentity>;
    const identity = toIdentity(parsed);
    if (!identity) return null;
    return { ...identity, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString() };
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  if (!canUseWindow()) return;
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
    window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch { /* best-effort */ }
}

/** True when the stored identity belongs to a different user than `username`. */
export function identityBelongsToOther(username?: string): boolean {
  const stored = readIdentity();
  if (!stored || !stored.username || !username) return false;
  return stored.username.toLowerCase() !== username.toLowerCase();
}