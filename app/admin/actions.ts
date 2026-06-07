'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, SESSION_MAX_AGE, adminPassword, sessionValue } from './auth';

export async function login(formData: FormData) {
  const secret = adminPassword();
  const password = String(formData.get('password') ?? '');
  if (!secret || password !== secret) {
    redirect('/admin?login=failed');
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, sessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/admin',
    maxAge: SESSION_MAX_AGE,
  });
  redirect('/admin');
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  redirect('/admin');
}
