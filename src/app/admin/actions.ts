'use server';

import { redirect } from 'next/navigation';
import { adminLogout, requestAdminCode, verifyAdminCode } from '@/lib/admin/auth';

export type LoginState = { stage: 'email' | 'code'; email?: string; error?: string; info?: string } | undefined;

export async function loginAction(prev: LoginState, form: FormData): Promise<LoginState> {
  const intent = String(form.get('intent') ?? 'send');
  const email = String(form.get('email') ?? prev?.email ?? '').trim();

  if (intent === 'verify') {
    const res = await verifyAdminCode(email, String(form.get('code') ?? ''));
    if (!res.ok) return { stage: 'code', email, error: res.error };
    redirect('/admin');
  }
  if (intent === 'restart') return { stage: 'email' };

  const res = await requestAdminCode(email);
  if (!res.ok) return { stage: prev?.stage ?? 'email', email, error: res.error };
  return { stage: 'code', email, info: 'If this address can open admin, a sign-in email is on its way. Enter the code, or open the link in this browser.' };
}

export async function logoutAction() {
  await adminLogout();
  redirect('/admin');
}
