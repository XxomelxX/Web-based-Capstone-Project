'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface PaymentData {
  method: string;
  count: number;
  total: number;
}

const COLORS: Record<string, string> = {
  cash: '#22d3ee',
  gcash: '#f59e0b',
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PaymentData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
      <p className="text-xs uppercase tracking-wider text-slate-400">{d.method}</p>
      <p className="mt-1 text-sm font-semibold text-white">₱{d.total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
      <p className="text-xs text-slate-500">{d.count} transaction{d.count !== 1 ? 's' : ''}</p>
    </div>
  );
}

export default function PaymentMethodChart({ data }: { data: PaymentData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-slate-400">No payment data available.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width="60%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="method"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell key={entry.method} fill={COLORS[entry.method] ?? '#64748b'} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-4">
        {data.map((entry) => (
          <div key={entry.method} className="flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: COLORS[entry.method] ?? '#64748b' }}
            />
            <div>
              <p className="text-sm font-medium text-slate-200 capitalize">{entry.method}</p>
              <p className="text-xs text-slate-500">{entry.count} txn{entry.count !== 1 ? 's' : ''}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
