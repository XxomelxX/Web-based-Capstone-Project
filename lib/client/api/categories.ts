import { getCategoriesOffline } from '@/lib/client/api/offline';
import { db } from '@/lib/client/offline';
import { queueCategoryUpsert, queueCategoryDelete } from '@/lib/client/offlineQueue';

export interface Category {
  id: number;
  name: string;
  description?: string | null;
  archived?: boolean;
  _count?: { products: number };
}

function isOffline() {
  return typeof window !== 'undefined' && !navigator.onLine;
}

export async function getCategories(): Promise<Category[]> {
  return getCategoriesOffline<Category>();
}

export async function addCategory(data: { name: string; description?: string }): Promise<Category> {
  if (isOffline()) {
    const tempId = -Date.now();
    const temp = { id: tempId, name: data.name, description: data.description ?? null };
    await db.categories.put(temp as unknown as Record<string, unknown>);
    await queueCategoryUpsert(data as unknown as Record<string, unknown>, undefined, tempId);
    return { ...temp, offline: true } as unknown as Category;
  }
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to create category');
  }
  return res.json();
}

export async function updateCategory(id: number, data: Partial<Category>): Promise<Category> {
  if (isOffline()) {
    const existing = await db.categories.get(id);
    await db.categories.put({ ...((existing ?? { id }) as object), ...data, id } as unknown as Record<string, unknown>);
    // Category rename offline: refresh cached product labels pointing at it.
    try {
      const prods = await db.products.toArray();
      const touched = prods.filter((p) => (p as { categoryId?: number }).categoryId === id && typeof data.name === 'string');
      for (const p of touched) {
        await db.products.put({ ...p, category: { id, name: data.name } });
      }
    } catch { /* label refresh best-effort */ }
    await queueCategoryUpsert(data as unknown as Record<string, unknown>, id > 0 ? id : undefined, id < 0 ? id : undefined);
    return { ...((existing ?? {}) as object), ...data, id, offline: true } as unknown as Category;
  }
  const res = await fetch(`/api/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update category');
  }
  return res.json();
}

export async function deleteCategory(id: number): Promise<void> {
  if (isOffline()) {
    await db.categories.delete(id);
    if (id > 0) await queueCategoryDelete(id);
    return;
  }
  const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete category');
  }
}
