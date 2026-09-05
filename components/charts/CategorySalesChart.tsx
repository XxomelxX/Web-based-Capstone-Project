'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface CategoryData {
  category: string;
  revenue: number;
  items: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400">{d.category}</p>
      <p className="mt-1 text-sm font-semibold text-emerald-300">₱{d.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
      <p className="text-xs text-slate-500">{d.items} items sold</p>
    </div>
  );
}

export default function CategorySalesChart({ data }: { data: CategoryData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-slate-400">No category data available.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis dataKey="category" stroke="#475569" fontSize={11} tickLine={false} />
        <YAxis stroke="#475569" fontSize={12} tickLine={false} tickFormatter={(v) => `₱${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="revenue" fill="#34d399" radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
