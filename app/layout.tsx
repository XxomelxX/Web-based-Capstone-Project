import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Web-Based POS Inventory and Sales System for Sari-Sari Store",
  description: "Simple. Efficient. Reliable. Manage your store better every day.",
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
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sari-sari-theme');var d=t==='light'||t==='dark'?t:'dark';document.documentElement.setAttribute('data-theme',d);}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              if(!navigator.onLine||!('caches'in window)||!('serviceWorker'in navigator))return;
              function warm(){
                if(!navigator.serviceWorker.controller)return void setTimeout(warm,2000);
                var pages=['/login','/pos','/dashboard','/orders','/credit','/products','/categories','/expenses','/reports','/users','/settings','/lowstock','/transaction-log','/item-log'];
                caches.open('pages-cache').then(function(cache){
                  pages.forEach(function(url){
                    cache.match(url,{ignoreVary:true}).then(function(hit){
                      if(hit)return;
                      fetch(url,{cache:'no-store',credentials:'same-origin'}).then(function(r){
                        if(!r||!r.ok||r.type!=='basic')return;
                        var ct=r.headers.get('content-type')||'';
                        if(ct.indexOf('text/html')===-1)return;
                        return r.text().then(function(body){
                          if(!body||body.length<500)return;
                          cache.put(url,new Response(body,{status:200,statusText:'OK',headers:{'Content-Type':'text/html;charset=utf-8'}})).catch(function(){});
                        });
                      }).catch(function(){});
                    }).catch(function(){});
                  });
                });
              }
              if(document.readyState==='complete')warm();
              else window.addEventListener('load',function(){setTimeout(warm,3000);});
            })();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              if(!('serviceWorker'in navigator))return;
              window.addEventListener('load',function(){
                navigator.serviceWorker.getRegistrations().then(function(regs){
                  regs.forEach(function(reg){reg.update()});
                });
              });
            })();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-slate-100 relative">
        <div className="relative z-10 flex flex-col min-h-screen">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
