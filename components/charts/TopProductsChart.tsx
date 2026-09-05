'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface ProductData {
  name: string;
  revenue: number;
  unitsSold: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ProductData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400">{d.name}</p>
      <p className="mt-1 text-sm font-semibold text-emerald-300">₱{d.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
      <p className="text-xs text-slate-500">{d.unitsSold} units sold</p>
    </div>
  );
}

export default function TopProductsChart({ data }: { data: ProductData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-slate-400">No product data available.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
        <XAxis type="number" stroke="#475569" fontSize={12} tickLine={false} tickFormatter={(v) => `₱${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
        <YAxis type="category" dataKey="name" stroke="#475569" fontSize={11} tickLine={false} width={100} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="revenue" fill="#f59e0b" radius={[0, 6, 6, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
