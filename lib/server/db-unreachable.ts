// Detects Prisma/network errors that mean "the database server itself is
// unreachable" (P1001/P1002/P1011/P1017, TCP refused/reset/timeout, and the
// shutdown/startup window). Routes use this to answer 503 with a friendly
// message instead of leaking raw engine text.
const DB_UNREACHABLE_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Operation timed out because the server or network is unavailable
  'P1011', // Error opening a TCP connection
  'P1017', // Server has closed the connection (pool connections die on shutdown)
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
]);

const DB_UNREACHABLE_PATTERN =
  /can't reach database server|server has closed the connection|error opening a tcp connection|database system is shutting down|database system is starting up|connection refused|connection timed out|econnrefused|econnreset|etimedout|p1001|p1002|p1011|p1017/i;

export function isDbUnreachable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && DB_UNREACHABLE_CODES.has(code)) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return DB_UNREACHABLE_PATTERN.test(message);
}

export const DB_UNAVAILABLE_MESSAGE =
  'Database temporarily unavailable. Please retry in a moment.';
