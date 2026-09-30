import { getProductsOffline, getArchivedProductsOffline } from '@/lib/client/api/offline';
import { getCachedProducts, mergeProducts } from '@/lib/client/offline';

export interface Product {
  id: number;
  name: string;
  categoryId: number;
  category?: { id: number; name: string };
  price: number;
  cost: number;
  stock: number;
  packSize?: string | null;
  unit?: string | null;
  barcode?: string | null;
  archived: boolean;
  goodsType: string; // 'perishable' | 'non-perishable' | 'durable'
  vatType: string; // 'exempt' | 'regular' | 'zero-rated'
  expiryDate?: string | Date | null;
  _hasHistory?: boolean;
}

export async function getProducts(): Promise<Product[]> {
  return getProductsOffline<Product>();
}

export async function getArchivedProducts(): Promise<Product[]> {
  return getArchivedProductsOffline<Product>();
}

/**
 * Raw online fetch of active products with NO Dexie side effects.
 * Use when the caller performs its own authoritative cache write
 * (e.g. Products page merges active + archived atomically).
 */
export async function fetchActiveProductsOnline(): Promise<Product[]> {
  const res = await fetch('/api/products', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load products');
  return res.json();
}

/**
 * Raw online fetch of archived products with NO Dexie side effects.
 */
export async function fetchArchivedProductsOnline(): Promise<Product[]> {
  const res = await fetch('/api/products?archived=true', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load archived products');
  return res.json();
}

/**
 * Active-only product list that NEVER wipes archived rows from Dexie.
 * Online: fetches active list and upserts (merge). Offline: reads cache.
 * Use for sale lists (POS) that only need active products.
 */
export async function getActiveProducts(): Promise<Product[]> {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    return (await getCachedProducts<Product>()).filter((p) => !p.archived);
  }
  const active = await fetchActiveProductsOnline();
  await mergeProducts(active as unknown as Record<string, unknown>[]);
  return active;
}

function checkOnlineOrThrow() {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    throw new Error('This action requires an internet connection');
  }
}

export async function addProduct(data: Partial<Product>): Promise<Product> {
  checkOnlineOrThrow();
  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to create product');
  }
  return res.json();
}

export async function updateProduct(id: number, data: Partial<Product>): Promise<Product> {
  checkOnlineOrThrow();
  const res = await fetch(`/api/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update product');
  }
  return res.json();
}

export async function archiveProduct(id: number): Promise<Product> {
  return updateProduct(id, { archived: true });
}

export async function unarchiveProduct(id: number): Promise<Product> {
  return updateProduct(id, { archived: false });
}

export async function deleteProduct(id: number): Promise<void> {
  checkOnlineOrThrow();
  const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete product');
  }
}
