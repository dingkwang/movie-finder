import { createHash, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'movie_finder_admin';
export const SESSION_MAX_AGE = 60 * 60 * 12;

export function adminPassword() {
  return process.env.ADMIN_PASSWORD ?? process.env.ADMIN_TOKEN ?? '';
}

export function sessionValue() {
  const secret = adminPassword();
  return createHash('sha256').update(`movie-finder-admin:${secret}`).digest('hex');
}

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function isAuthorized() {
  const secret = adminPassword();
  if (!secret) return false;
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_COOKIE)?.value ?? '';
  return safeEquals(value, sessionValue());
}
