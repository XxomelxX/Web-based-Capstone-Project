'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface DataPoint {
  date: string;
  revenue: number;
  transactions: number;
}

function formatDate(dateStr: string, range: string) {
  const d = new Date(dateStr + 'T00:00:00');
  if (range === 'week') {
    return d.toLocaleDateString('en-PH', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-emerald-300">₱{payload[0].value.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
    </div>
  );
}

export default function RevenueChart({ data, range }: { data: DataPoint[]; range: string }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p className="text-sm text-slate-400">No revenue data for this period.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tickFormatter={(d) => formatDate(d, range)}
          stroke="#475569"
          fontSize={12}
          tickLine={false}
        />
        <YAxis
          stroke="#475569"
          fontSize={12}
          tickLine={false}
          tickFormatter={(v) => `₱${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#34d399"
          strokeWidth={2}
          fill="url(#revenueGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
