import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

/**
 * Development-only service worker cleanup. Runs in <head>, BEFORE any app
 * bundle is fetched, so a stale production worker cannot serve a cached
 * (previous-compile) dev chunk to this page.
 *
 * Why this is needed: a browser that once ran the production build on this
 * origin keeps the generated /sw.js registered. next-pwa is disabled in dev,
 * so nothing replaces it, and the old worker caches the dev server's
 * unhashed chunk URLs - their content changes on every recompile while the
 * URL stays the same. The page then runs a mix of old and new React code and
 * React throws "Rendered more hooks than during the previous render".
 */
const DEV_SW_GUARD = `(function(){
if (!('serviceWorker' in navigator)) return;
var KEY = 'sari-dev-sw-cleanup';
function reload() { try { location.reload(); } catch (e) {} }
function purgeCaches() {
  try {
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) { return caches.delete(key); }));
    });
  } catch (e) { return Promise.resolve(); }
}
function unregisterAll() {
  try {
    return navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
    });
  } catch (e) { return Promise.resolve(); }
}
navigator.serviceWorker.addEventListener('message', function (event) {
  var data = event && event.data;
  if (data && data.type === 'SARI_SW_DISABLED') reload();
});
var wasControlled = !!navigator.serviceWorker.controller;
Promise.all([unregisterAll(), purgeCaches()]).then(function () {
  // A controlling worker means this document - and the chunks it references -
  // may have come from the cache. Reload once so the page runs fresh bundles.
  if (!wasControlled) return;
  var now = Date.now();
  var last = 0;
  try { last = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0; } catch (e) {}
  if (now - last < 10000) return;
  try { sessionStorage.setItem(KEY, String(now)); } catch (e) {}
  reload();
});
})();`;

export const metadata: Metadata = {
  title: "J & J Merchandise Store",
  description: "Simple. Efficient. Reliable. Manage your store better every day.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "J & J Merchandise Store",
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
        {process.env.NODE_ENV !== 'production' && (
          <script dangerouslySetInnerHTML={{ __html: DEV_SW_GUARD }} />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              if(!('caches'in window)||!('serviceWorker'in navigator))return;
              caches.keys().then(function(names){
                names.forEach(function(n){
                  if(n==='pages'||n==='pages-cache-v1'||n==='pages-cache-v2')caches.delete(n);
                });
              });
              if(!navigator.onLine)return;
              var tries=0;
              function warm(){
                tries++;
                if(!navigator.serviceWorker.controller){if(tries<15)setTimeout(warm,2000);return;}
                var id=null;
                try{id=localStorage.getItem('sari-pos-identity');}catch(e){}
                // Never warm module pages pre-login: unauthenticated fetches
                // redirect to /login, and caching that redirect under the module
                // key poisons the offline shell.
                var pages=id?['/pos','/dashboard','/products','/inventory']:['/login','/offline'];
                // Pages are read by the SW runtime rules from pages-cache-v3;
                // the old pages-cache-v2 writer was dead storage nothing served.
                caches.open('pages-cache-v3').then(function(cache){
                  pages.forEach(function(url){
                    cache.match(url,{ignoreVary:true}).then(function(hit){
                      if(hit)return;
                      fetch(url,{cache:'no-store',credentials:'same-origin'}).then(function(r){
                        if(!r||!r.ok||r.redirected||r.type!=='basic')return;
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
              window.addEventListener('online',function(){tries=0;warm();});
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
