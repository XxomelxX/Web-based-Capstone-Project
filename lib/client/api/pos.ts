export interface CartItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export interface CheckoutResult {
  id: number;
  subtotal: number;
  vat: number;
  total: number;
  tendered: number;
  change: number;
  paymentMethod: string;
  // GCash reference number — queued offline, verified later via Xendit.
  gcashRef?: string;
  needsVerification?: boolean;
  xenditStatus?: string;
  checkoutUrl?: string | null;
  createdAt: string;
  customer?: {
    id: number;
    name: string;
  } | null;
  offline?: boolean;
}

import { checkoutOffline } from '@/lib/client/api/offline';

export async function checkout(
  items: CartItem[],
  paymentMethod: 'cash' | 'gcash',
  tendered: number,
  customerId?: number | null,
  gcashRef?: string
): Promise<CheckoutResult> {
  return checkoutOffline(items, paymentMethod, tendered, customerId, gcashRef);
}

export interface GcashOnlineResult {
  transactionId: number;
  referenceId: string;
  paymentId: string;
  checkoutUrl: string | null;
  xenditStatus: string;
  reused?: boolean;
}

/** Online-only Xendit GCash charge. Throws when offline — caller must queue instead. */
export async function createGcashChargeOnline(
  items: CartItem[],
  gcashRef: string,
  customerId?: number | null,
  clientUuid?: string
): Promise<GcashOnlineResult> {
  const res = await fetch('/api/gcash/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientUuid: clientUuid ?? crypto.randomUUID(), items, customerId, gcashRef }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `GCash charge failed (${res.status})`);
  return data as GcashOnlineResult;
}

export async function pollGcashStatus(referenceId: string): Promise<{ xenditStatus: string; needsVerification: boolean; transactionId: number }> {
  const res = await fetch(`/api/gcash/status?referenceId=${encodeURIComponent(referenceId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Status check failed');
  return data as { xenditStatus: string; needsVerification: boolean; transactionId: number };
}
