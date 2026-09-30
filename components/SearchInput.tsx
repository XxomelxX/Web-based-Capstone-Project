'use client';

import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

/** Full-width dark-theme search with icon + clear (X) button. Filtering/debounce handled by parent. */
export function SearchInput({ value, onChange, placeholder, ariaLabel }: SearchInputProps) {
  return (
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
