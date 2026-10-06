import { getProductsOffline, getArchivedProductsOffline } from '@/lib/client/api/offline';
import { getCachedProducts, mergeProducts, db } from '@/lib/client/offline';
import { queueProductUpsert, queueProductDelete } from '@/lib/client/offlineQueue';

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

function isOffline() {
  return typeof window !== 'undefined' && !navigator.onLine;
}

export async function addProduct(data: Partial<Product>): Promise<Product> {
  if (isOffline()) {
    // Optimistic create: negative temp id, queued for sync (server-wins).
    const tempId = -Date.now();
    const temp = {
      id: tempId,
      name: data.name ?? 'Untitled product',
      categoryId: data.categoryId ?? 0,
      price: data.price ?? 0,
      cost: data.cost ?? 0,
      stock: data.stock ?? 0,
      packSize: data.packSize ?? null,
      unit: data.unit ?? null,
      barcode: data.barcode ?? null,
      archived: false,
      goodsType: data.goodsType ?? 'non-perishable',
      vatType: data.vatType ?? 'exempt',
      expiryDate: data.expiryDate ?? null,
    } as unknown as Record<string, unknown>;
    await mergeProducts([temp]);
    await queueProductUpsert({ ...data, name: temp.name, price: temp.price }, undefined, tempId);
    return { ...temp, offline: true } as unknown as Product;
  }
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
  if (isOffline()) {
    const existing = await db.products.get(id);
    await mergeProducts([{ ...(existing ?? { id }), ...data, id } as unknown as Record<string, unknown>]);
    await queueProductUpsert(data as unknown as Record<string, unknown>, id > 0 ? id : undefined, id < 0 ? id : undefined);
    return { ...((existing ?? {}) as object), ...data, id, offline: true } as unknown as Product;
  }
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
  if (isOffline()) {
    await db.products.delete(id);
    if (id > 0) await queueProductDelete(id);
    return;
  }
  const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete product');
  }
}
