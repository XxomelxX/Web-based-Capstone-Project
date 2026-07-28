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
  createdAt: string;
  customer?: {
    id: number;
    name: string;
  } | null;
  offline?: boolean;
}

import { checkoutOffline } from '@/lib/api/offline';

export async function checkout(
  items: CartItem[],
  paymentMethod: 'cash' | 'gcash',
  tendered: number,
  customerId?: number | null
): Promise<CheckoutResult> {
  return checkoutOffline(items, paymentMethod, tendered, customerId);
}
