import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 min-w-0 bg-slate-950 p-4 lg:p-8 overflow-x-auto">{children}</main>
    </div>
  );
}
