'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface ExpenseData {
  type: string;
  amount: number;
}

const PALETTE = ['#f43f5e', '#f59e0b', '#06b6d4', '#8b5cf6', '#10b981', '#ec4899', '#6366f1'];

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ExpenseData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400">{d.type}</p>
      <p className="mt-1 text-sm font-semibold text-rose-300">₱{d.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
    </div>
  );
}

export default function ExpenseChart({ data }: { data: ExpenseData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-slate-400">No expense data available.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width="60%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="type"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            strokeWidth={0}
          >
            {data.map((_, index) => (
              <Cell key={data[index].type} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-3">
        {data.map((entry, index) => (
          <div key={entry.type} className="flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
            />
            <div>
              <p className="text-sm font-medium text-slate-200">{entry.type}</p>
              <p className="text-xs text-slate-500">₱{entry.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
