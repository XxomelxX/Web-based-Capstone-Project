import { getCategoriesOffline, queueOrFetch } from '@/lib/api/offline';

export interface Category {
  id: number;
  name: string;
  description?: string | null;
  archived?: boolean;
  _count?: { products: number };
}

export async function getCategories(): Promise<Category[]> {
  return getCategoriesOffline<Category>();
}

export async function addCategory(data: { name: string; description?: string }): Promise<Category> {
  const result = await queueOrFetch('/api/categories', 'POST', data, 'add-category');
  if (result.offlineQueued) {
    return { id: Date.now(), name: data.name, description: data.description ?? null, archived: false } as Category;
  }
  return result.data as Category;
}

export async function updateCategory(id: number, data: Partial<Category>): Promise<Category> {
  const result = await queueOrFetch(`/api/categories/${id}`, 'PATCH', data, 'update-category');
  if (result.offlineQueued) {
    return { id, ...data } as Category;
  }
  return result.data as Category;
}

export async function deleteCategory(id: number): Promise<void> {
  const result = await queueOrFetch(`/api/categories/${id}`, 'DELETE', null, 'delete-category');
  if (result.offlineQueued) {
    return;
  }
  return;
}
