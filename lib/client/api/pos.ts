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
  // GCash reference number (manual) — typed from the customer's GCash receipt.
  gcashRef?: string;
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
