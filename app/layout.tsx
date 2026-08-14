import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Sari-Sari POS",
  description: "Inventory & Sales management system",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Sari-Sari POS",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#15803d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100 relative">
        <div 
          className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat bg-fixed"
          style={{ backgroundImage: "url('/mountain.png')" }}
        />
        <div className="fixed inset-0 z-0 bg-slate-950/45 backdrop-blur-[2px]" />
        <div className="relative z-10 flex flex-col min-h-screen">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
