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
}

export async function checkout(
  items: CartItem[],
  paymentMethod: 'cash' | 'gcash',
  tendered: number
): Promise<CheckoutResult> {
  const res = await fetch('/api/pos/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, paymentMethod, tendered }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Checkout failed');
  return res.json();
}
