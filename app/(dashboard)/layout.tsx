import { TopNavbar } from '@/components/TopNavbar';
import { MobileTopBar } from '@/components/MobileTopBar';
import { BottomTabBar } from '@/components/BottomTabBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TopNavbar />
      <MobileTopBar />
      <main className="p-4 md:p-8 pb-24 md:pb-8">{children}</main>
      <BottomTabBar />
    </div>
  );
}
