import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.username || !credentials?.password) return null;

if (process.env.NODE_ENV !== 'production') {
        console.log('[AUTH] authorize credentials:', credentials);
      }

      const user = await prisma.user.findUnique({
        where: { username: credentials.username },
      });

      if (!user) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[AUTH] authorize failed: user not found', credentials.username);
        }
        return null;
      }

      if (user.status !== 'active') {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[AUTH] authorize failed: user inactive', user.status);
        }
        return null;
      }

      const isValid = await compare(credentials.password, user.passwordHash);
      if (!isValid) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[AUTH] authorize failed: invalid password for', credentials.username);
        }
        return null;
      }

          return {
            id: String(user.id),
            name: user.fullName,
            email: user.email,
            role: user.role,
          } as { id: string; name: string; email: string; role: string };
        } catch (error) {
          console.error('[AUTH] authorize error:', error);
          return null;
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
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.id as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
};
