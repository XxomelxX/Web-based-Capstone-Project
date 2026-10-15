import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/server/prisma';

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
        if (
          typeof credentials?.username !== 'string' ||
          typeof credentials.password !== 'string'
        ) {
          return null;
        }

        const username = credentials.username.trim();
        if (!username || !credentials.password) return null;

        const users = await prisma.user.findMany({
          where: {
            username: { equals: username, mode: 'insensitive' },
          },
          take: 2,
        });

        if (users.length !== 1) return null;

        const user = users[0];
        if (user.status !== 'active') return null;

        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: String(user.id),
          name: user.fullName,
          email: user.email,
          role: user.role,
        } as { id: string; name: string; email: string; role: string };
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
