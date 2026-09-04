import { getProductsOffline } from '@/lib/api/offline';

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
  return getProductsOffline<Product>().then((prods) => prods.filter((p) => p.archived));
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
