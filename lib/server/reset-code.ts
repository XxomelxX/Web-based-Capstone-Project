import { createHash } from 'crypto';

// Reset codes are stored as sha256 hashes — a DB read never reveals a live code.
// Shared by forgot-password (write) and reset-password (compare).
export function hashResetCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
