'use server';

import { redirect } from 'next/navigation';
import { adminLogin, adminLogout } from '@/lib/admin/auth';

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const res = await adminLogin(String(form.get('secret') ?? ''));
  if (!res.ok) return { error: res.error };
  redirect('/admin');
}

export async function logoutAction() {
  await adminLogout();
  redirect('/admin');
}
