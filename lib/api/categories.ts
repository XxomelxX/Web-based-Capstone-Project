export interface Category {
  id: number;
  name: string;
  description?: string | null;
  _count?: { products: number };
}

export async function getCategories(): Promise<Category[]> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('Failed to load categories');
  return res.json();
}

export async function addCategory(data: { name: string; description?: string }): Promise<Category> {
  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add category');
  return res.json();
}
