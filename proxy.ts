import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

const ADMIN_ONLY_PATHS = [
  '/products',
  '/categories',
  '/users',
  '/reports',
  '/expenses',
  '/transaction-log',
  '/item-log',
];

const authMiddleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    const isAdminOnly = ADMIN_ONLY_PATHS.some((p) => path.startsWith(p));
    if (isAdminOnly && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export function proxy(request: NextRequest, event: NextFetchEvent) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authMiddleware as any)(request, event);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/pos/:path*',
    '/products/:path*',
    '/categories/:path*',
    '/lowstock/:path*',
    '/orders/:path*',
    '/utang/:path*',
    '/transaction-log/:path*',
    '/item-log/:path*',
    '/expenses/:path*',
    '/reports/:path*',
    '/users/:path*',
    '/settings/:path*',
  ],
};
