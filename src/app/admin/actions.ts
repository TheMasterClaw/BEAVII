'use server';

import { redirect } from 'next/navigation';
import { adminChallenge, adminLogout, adminSignIn } from '@/lib/admin/auth';

export async function challengeAction(address: string) {
  return adminChallenge(address);
}

export async function signInAction(message: string, signature: string) {
  const res = await adminSignIn(message, signature);
  if (!res.ok) return res;
  redirect('/admin');
}

export async function logoutAction() {
  await adminLogout();
  redirect('/admin');
}
