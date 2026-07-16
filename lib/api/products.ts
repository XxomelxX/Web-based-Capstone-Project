import { getProductsOffline, getArchivedProductsOffline, queueOrFetch } from '@/lib/api/offline';

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
  _hasHistory?: boolean;
}

export async function getProducts(): Promise<Product[]> {
  return getProductsOffline();
}

export async function getArchivedProducts(): Promise<Product[]> {
  return getArchivedProductsOffline();
}

export async function addProduct(data: Partial<Product>): Promise<Product> {
  const result = await queueOrFetch('/api/products', 'POST', data, 'product-create');
  if (result.offlineQueued) {
    return { id: Date.now(), ...data, archived: false, goodsType: data.goodsType ?? 'non-perishable', price: data.price ?? 0, cost: data.cost ?? 0, stock: data.stock ?? 0 } as Product;
  }
  return result.data as Product;
}

export async function updateProduct(id: number, data: Partial<Product>): Promise<Product> {
  const result = await queueOrFetch(`/api/products/${id}`, 'PATCH', data, 'product-update');
  if (result.offlineQueued) {
    return { id, ...data } as Product;
  }
  return result.data as Product;
}

export async function archiveProduct(id: number): Promise<Product> {
  return updateProduct(id, { archived: true });
}

export async function unarchiveProduct(id: number): Promise<Product> {
  return updateProduct(id, { archived: false });
}

export async function deleteProduct(id: number): Promise<void> {
  const result = await queueOrFetch(`/api/products/${id}`, 'DELETE', null, 'product-delete');
  if (result.offlineQueued) {
    return;
  }
  return;
}
