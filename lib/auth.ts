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

          const user = await prisma.user.findUnique({
            where: { username: credentials.username },
          });

          if (!user || user.status !== 'active') return null;

          const isValid = await compare(credentials.password, user.passwordHash);
          if (!isValid) return null;

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

      if (!user && token?.id) {
        const dbUser = await prisma.user.findUnique({ where: { id: Number(token.id) } });
        if (dbUser) {
          token.role = dbUser.role;
          token.name = dbUser.fullName;
          token.email = dbUser.email;
        }
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
