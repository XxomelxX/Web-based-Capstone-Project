import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const CSP = "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none';";

// Paths that should NOT get CSP headers (SW assets, APIs, static files)
const CSP_EXEMPT = [
  '/sw.js',
  '/manifest.json',
  '/api/',
  '/_next/',
  '/workbox-',
  '/fallback-',
  '/icons/',
  '/images/',
];

function isCspExempt(pathname: string): boolean {
  return CSP_EXEMPT.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Always let SW assets, icons, manifest, and offline page through without auth
  if (
    pathname === '/sw.js' ||
    pathname === '/manifest.json' ||
    pathname.startsWith('/workbox-') ||
    pathname.startsWith('/fallback-') ||
    pathname.startsWith('/icons/') ||
    pathname === '/offline' ||
    pathname === '/login' ||
    pathname === '/forgot-password'
  ) {
    const response = NextResponse.next();
    if (!isCspExempt(pathname)) {
      response.headers.set('Content-Security-Policy', CSP);
    }
    return response;
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();

  // Set CSP on page responses only (skip APIs, SW, static assets)
  if (!isCspExempt(pathname)) {
    response.headers.set('Content-Security-Policy', CSP);
  }

  return response;
}

export const config = {
  matcher: [
    '/login',
    '/forgot-password',
    '/dashboard/:path*',
    '/pos/:path*',
    '/products/:path*',
    '/categories/:path*',
    '/orders/:path*',
    '/credit/:path*',
    '/expenses/:path*',
    '/reports/:path*',
    '/users/:path*',
    '/settings/:path*',
    '/lowstock/:path*',
    '/transaction-log/:path*',
    '/item-log/:path*',
  ],
};
