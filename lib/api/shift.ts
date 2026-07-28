export interface ShiftDetails {
  id: number;
  cashierId: number;
  openingFloat: number;
  closingCash: number | null;
  expectedCash: number | null;
  cashSales: number | null;
  gcashSales: number | null;
  overageShortage: number | null;
  status: 'open' | 'closed';
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
  totalSales?: number;
  transactionCount?: number;
  cashier?: {
    fullName: string;
    username: string;
  };
}

export interface ZReadSummary {
  openedAt: string;
  closedAt: string;
  openingFloat: number;
  cashSales: number;
  gcashSales: number;
  totalSales: number;
  transactionCount: number;
  expectedCash: number;
  closingCash: number;
  overageShortage: number;
}

export async function fetchActiveShift(): Promise<ShiftDetails | null> {
  try {
    const res = await fetch('/api/shift');
    if (!res.ok) return null;
    const data = await res.json();
    return data.activeShift ?? null;
  } catch (error) {
    console.error('Error fetching active shift:', error);
    return null;
  }
}

export async function openShift(openingFloat: number, notes?: string): Promise<{ success: boolean; shift?: ShiftDetails; error?: string }> {
  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', openingFloat, notes }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to open shift' };
    }
    return { success: true, shift: data.shift };
  } catch (error) {
    console.error('Error opening shift:', error);
    return { success: false, error: 'Network error opening shift' };
  }
}

export async function closeShift(
  closingCash: number,
  notes?: string
): Promise<{ success: boolean; shift?: ShiftDetails; summary?: ZReadSummary; error?: string }> {
  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', closingCash, notes }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to close shift' };
    }
    return { success: true, shift: data.shift, summary: data.summary };
  } catch (error) {
    console.error('Error closing shift:', error);
    return { success: false, error: 'Network error closing shift' };
  }
}

export async function fetchShiftHistory(): Promise<ShiftDetails[]> {
  try {
    const res = await fetch('/api/shift/history');
    if (!res.ok) return [];
    const data = await res.json();
    return data.shifts ?? [];
  } catch (error) {
    console.error('Error fetching shift history:', error);
    return [];
  }
}
