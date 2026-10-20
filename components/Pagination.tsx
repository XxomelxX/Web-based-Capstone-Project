'use client';

// One shared pagination bar for the client-paged lists (products, inventory,
// POS grid, items, transactions, orders). Newest records always sort to the
// top of each list, so page 1 holds the most recently added data — this bar
// just walks the pages. It renders nothing until the data set actually
// spans more than one page, so small stores see no change at all.

interface PaginationProps {
  /** Current page (1-based). */
  page: number;
  pageCount: number;
  /** Items in the currently filtered set. */
  total: number;
  /** First visible item (1-based, inclusive). */
  pageStart: number;
  /** Last visible item (1-based, inclusive). */
  pageEnd: number;
  /** Optional noun, e.g. "products", "transactions". */
  label?: string;
  onPage: (page: number) => void;
  /** 'dark' = default slate (admin pages); 'light' = white POS card. */
  tone?: 'dark' | 'light';
}

const TONES = {
  dark: {
    bar: 'border-t border-slate-800',
    range: 'text-slate-500',
    pageLabel: 'text-slate-400',
    button: 'border-slate-700 text-slate-300 hover:bg-slate-800',
  },
  light: {
    bar: 'border-t border-gray-200',
    range: 'text-gray-500',
    pageLabel: 'text-gray-500',
    button: 'border-gray-300 text-gray-600 hover:bg-gray-50',
  },
} as const;

export function Pagination({ page, pageCount, total, pageStart, pageEnd, label, onPage, tone = 'dark' }: PaginationProps) {
  if (total === 0 || pageCount <= 1) return null;
  const t = TONES[tone];
  return (
    <div className={`flex justify-between items-center gap-2 ${t.bar} pt-2 mt-3 flex-wrap`}>
      <span className={`text-xs ${t.range}`}>
        {pageStart}–{pageEnd} of {total}
        {label ? ` ${label}` : ''}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={`border rounded-md px-2.5 py-1 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${t.button}`}
        >
          ← Prev
        </button>
        <span className={`text-xs ${t.pageLabel}`}>
          Page {page} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className={`border rounded-md px-2.5 py-1 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${t.button}`}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

/**
 * Derive a page window for a paged list. Clamps the raw page state so a
 * shrinking filtered set can never render an empty page.
 */
export function pageWindow(listLength: number, rawPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(listLength / pageSize));
  const page = Math.min(Math.max(1, rawPage), pageCount);
  const pageStart = listLength === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, listLength);
  return { page, pageCount, pageStart, pageEnd };
}
