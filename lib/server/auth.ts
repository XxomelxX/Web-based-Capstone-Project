import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/server/prisma';
import { isRateLimited } from '@/lib/server/rate-limit';

// Dummy bcrypt hash so unknown usernames take the same time as real ones
// (no timing oracle for account enumeration). Cost 10 matches user hashes.
const DUMMY_HASH = '$2b$10$C6UzMDM.H6dfI/f/IKcEeOHi1X3rJ5v5VZ5v5VZ5v5VZ5v5VZ5u';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  // 8h cap: deactivated/demoted users lose access at most 8h after the change
  // (was the 30-day default). Middleware re-checks status on top of this.
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (
          typeof credentials?.username !== 'string' ||
          typeof credentials.password !== 'string'
        ) {
          return null;
        }

        const identifier = credentials.username.trim();
        if (!identifier || !credentials.password) return null;

        // Per-username throttle (5 attempts / 10 min): unknown-user probes and
        // password guessing share the same bucket so neither can be brute-forced.
        const attemptKey = `login:${identifier.toLowerCase()}`;
        if (isRateLimited(attemptKey, 5, 10 * 60 * 1000)) {
          throw new Error('Too many login attempts. Please try again later.');
        }

        try {
          const users = await prisma.user.findMany({
            where: {
              OR: [
                { username: { equals: identifier, mode: 'insensitive' } },
                { email: { equals: identifier, mode: 'insensitive' } },
              ],
            },
            take: 2,
          });

          // Dummy compare keeps unknown-user timing identical to a real check.
          if (users.length !== 1) {
            await compare(credentials.password, DUMMY_HASH).catch(() => false);
            return null;
          }

          const user = users[0];
          if (user.status !== 'active') {
            await compare(credentials.password, DUMMY_HASH).catch(() => false);
            return null;
          }

          const isValid = await compare(credentials.password, user.passwordHash);
          if (!isValid) return null;

          return {
            id: String(user.id),
            name: user.fullName,
            email: user.email,
            role: user.role,
          } as { id: string; name: string; email: string; role: string };
        } catch (error) {
          console.error('Authentication database error:', error);
          throw new Error('Database unavailable. Please try again later.');
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { id: string; role: string; name: string; email: string };
        token.role = u.role;
        token.id = u.id;
        token.name = u.name;
        token.email = u.email;
        // Fresh stamp: re-validate status/role against the DB below at most
        // every 5 minutes (not on every request — authorize runs per page).
        token.checkedAt = 0;
        return token;
      }

      // Re-check a live session's status/role: a user deactivated or demoted
      // after sign-in must lose access without waiting for the 8h JWT expiry.
      // Throttled to once per 5 min per token; fail-open on DB errors (the
      // token itself is still cryptographically valid) so a DB blip can't
      // log out the whole store.
      const checkedAt = typeof token.checkedAt === 'number' ? token.checkedAt : 0;
      if (Date.now() - checkedAt > 5 * 60 * 1000 && token.id) {
        try {
          const live = await prisma.user.findUnique({
            where: { id: Number(token.id) },
            select: { status: true, role: true, fullName: true, email: true },
          });
          if (!live || live.status !== 'active') {
            // Poison the token: session callback below will drop the user and
            // requireSession/middleware will bounce to login.
            token.role = 'revoked';
            token.checkedAt = Date.now();
            return token;
          }
          token.role = live.role;
          token.name = live.fullName;
          token.email = live.email;
        } catch {
          // DB unreachable — keep the existing token (fail-open).
        }
        token.checkedAt = Date.now();
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // Revoked marker from jwt(): present no user so guards bounce to login.
        if (token.role === 'revoked') {
          session.user = undefined as unknown as typeof session.user;
          return session;
        }
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.id as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
};
