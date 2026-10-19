import { TopNavbar } from '@/components/TopNavbar';
import { MobileTopBar } from '@/components/MobileTopBar';
import { BottomTabBar } from '@/components/BottomTabBar';
import { OfflineShellWarmer } from '@/components/offline-shell-warmer';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <TopNavbar />
      <MobileTopBar />
      <main className="p-4 md:p-8 pb-24 md:pb-8">{children}</main>
      <BottomTabBar />
      <OfflineShellWarmer />
    </div>
  );
}
