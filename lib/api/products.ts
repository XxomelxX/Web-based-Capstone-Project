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
}

export async function getProducts(): Promise<Product[]> {
  const res = await fetch('/api/products');
  if (!res.ok) throw new Error('Failed to load products');
  return res.json();
}

export async function addProduct(data: Partial<Product>): Promise<Product> {
  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add product');
  return res.json();
}

export async function updateProduct(id: number, data: Partial<Product>): Promise<Product> {
  const res = await fetch(`/api/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update product');
  return res.json();
}

export async function archiveProduct(id: number): Promise<Product> {
  return updateProduct(id, { archived: true });
}
