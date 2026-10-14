import { prisma } from '@/lib/server/prisma';

// Shared-drawer model: the store has one physical cash drawer, and the drawer
// float is whatever the admin's open shift declares. A cashier's own shift
// float (₱0 for instant-opened shifts) is only a fallback for when no admin
// shift is open. Admins always reconcile against their own shift float.

export async function getAdminOpenFloat(): Promise<number | null> {
  const adminShift = await prisma.shift.findFirst({
    where: { status: 'open', cashier: { role: 'admin' } },
    orderBy: { openedAt: 'desc' },
    select: { openingFloat: true },
  });
  return adminShift ? adminShift.openingFloat : null;
}

export async function getDrawerFloat(ownerRole: string, ownFloat: number): Promise<number> {
  if (ownerRole === 'admin') return ownFloat;
  const adminFloat = await getAdminOpenFloat();
  return adminFloat ?? ownFloat;
}
