'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getProducts, Product } from '@/lib/api/products';
import { checkout, CheckoutResult } from '@/lib/api/pos';

interface CartLine {
  product: Product;
  quantity: number;
}

export default function POSPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'gcash'>('cash');
  const [tendered, setTendered] = useState(0);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    getProducts().then(setProducts);
  }, []);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode === search
  );

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.product.price, 0);
  const vat = subtotal * 0.12;
  const total = subtotal + vat;
  const change = tendered - total;

  async function handleCompleteSale() {
    setError('');
    setProcessing(true);
    try {
      const result = await checkout(
        cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.product.price })),
        paymentMethod,
        tendered
      );
      setReceipt(result);
      setCart([]);
      setTendered(0);
      getProducts().then(setProducts); // refresh stock counts
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Point of Sale</h1>
          <p className="text-sm text-gray-500">
            Type a product name or select a product card above. Cashier: <strong>{session?.user?.name}</strong>
          </p>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Scan barcode or type and press enter..."
          className="w-full border rounded-md px-4 py-3 bg-white"
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              disabled={p.stock <= 0}
              className="bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition disabled:opacity-40"
            >
              <div className="font-medium text-sm">{p.name}</div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-green-700 font-bold">₱{p.price}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.stock < 20 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                  {p.stock} stk
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-5 space-y-4 h-fit sticky top-4">
        <div className="flex justify-between items-center">
          <h2 className="font-bold">Cart</h2>
          <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{cart.length} items</span>
        </div>

        {cart.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Cart is empty. Scan a barcode to start.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {cart.map((l) => (
              <div key={l.product.id} className="flex justify-between text-sm">
                <span>{l.product.name} x{l.quantity}</span>
                <span>₱{(l.quantity * l.product.price).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>₱{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>VAT (12%)</span><span>₱{vat.toFixed(2)}</span></div>
          <div className="flex justify-between font-bold text-lg text-orange-700"><span>Total</span><span>₱{total.toFixed(2)}</span></div>
        </div>

        <div>
          <p className="text-sm font-medium mb-1">Payment Method</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`border rounded-md py-2 text-sm ${paymentMethod === 'cash' ? 'bg-green-700 text-white' : ''}`}
            >
              Cash
            </button>
            <button
              onClick={() => setPaymentMethod('gcash')}
              className={`border rounded-md py-2 text-sm ${paymentMethod === 'gcash' ? 'bg-green-700 text-white' : ''}`}
            >
              GCash
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">
            {paymentMethod === 'cash' ? 'Cash Tendered' : 'GCash Reference #'}
          </label>
          <input
            type="number"
            value={tendered || ''}
            onChange={(e) => setTendered(Number(e.target.value))}
            className="w-full border rounded-md px-3 py-2 mt-1"
            placeholder="0.00"
          />
        </div>

        <div className="flex justify-between text-sm">
          <span>Change</span>
          <span className="font-semibold">₱{change > 0 ? change.toFixed(2) : '0.00'}</span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={handleCompleteSale}
          disabled={cart.length === 0 || tendered < total || processing}
          className="w-full bg-green-700 text-white rounded-md py-3 font-medium disabled:opacity-40"
        >
          {processing ? 'Processing...' : '✓ Complete Sale'}
        </button>
      </div>

      {receipt && (
        <ReceiptModal receipt={receipt} cashierName={session?.user?.name ?? ''} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}

function ReceiptModal({
  receipt,
  cashierName,
  onClose,
}: {
  receipt: CheckoutResult;
  cashierName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 font-mono text-sm">
        <div className="flex justify-between items-start">
          <div className="w-full text-center">
            <h3 className="font-bold text-base">Sari-Sari Mart</h3>
            <p className="text-xs">123 Rizal St., Manila, Philippines</p>
          </div>
          <button onClick={onClose} className="text-gray-400">×</button>
        </div>
        <hr className="border-dashed my-2" />
        <div className="flex justify-between"><span>Receipt #</span><span>{receipt.id}</span></div>
        <div className="flex justify-between"><span>Date</span><span>{new Date(receipt.createdAt).toLocaleString()}</span></div>
        <div className="flex justify-between"><span>Cashier</span><span>{cashierName}</span></div>
        <hr className="border-dashed my-2" />
        <div className="flex justify-between"><span>Subtotal</span><span>₱{receipt.subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>VAT (12%)</span><span>₱{receipt.vat.toFixed(2)}</span></div>
        <div className="flex justify-between font-bold"><span>TOTAL</span><span>₱{receipt.total.toFixed(2)}</span></div>
        <hr className="border-dashed my-2" />
        <div className="flex justify-between"><span>Payment</span><span>{receipt.paymentMethod}</span></div>
        <div className="flex justify-between"><span>Tendered</span><span>₱{receipt.tendered.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>Change</span><span>₱{receipt.change.toFixed(2)}</span></div>
        <hr className="border-dashed my-2" />
        <p className="text-center text-xs">Thank you for shopping! Please come again.</p>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 border rounded-md py-2 font-sans">× Close</button>
          <button onClick={() => window.print()} className="flex-1 bg-green-700 text-white rounded-md py-2 font-sans">🖨 Print</button>
        </div>
      </div>
    </div>
  );
}
