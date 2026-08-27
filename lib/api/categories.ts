import { getCategoriesOffline } from '@/lib/api/offline';

export interface Category {
  id: number;
  name: string;
  description?: string | null;
  archived?: boolean;
  _count?: { products: number };
}

function checkOnlineOrThrow() {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    throw new Error('This action requires an internet connection');
  }
}

export async function getCategories(): Promise<Category[]> {
  return getCategoriesOffline<Category>();
}

export async function addCategory(data: { name: string; description?: string }): Promise<Category> {
  checkOnlineOrThrow();
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
  checkOnlineOrThrow();
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
  checkOnlineOrThrow();
  const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete category');
  }
}
