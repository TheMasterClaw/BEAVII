'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Loader2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';
import { xLinkMessage, type XLinkAction } from '@/lib/x-verification/message';

type Status = { verified: false } | { verified: true; username: string; name: string; verifiedAt: string };

export default function VerifyPage() {
  const { account, connect, getSigner } = useInjectedWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Result of the redirect back from X (?x=success|error&message=...), shown once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const x = q.get('x');
    if (!x) return;
    if (x === 'success') setNotice('Your X account is now linked to this wallet.');
    else setError(q.get('message') || 'X verification failed');
    window.history.replaceState(null, '', '/verify');
  }, []);

  const load = useCallback(async () => {
    if (!account) return setStatus(null);
    try {
      const res = await fetch(`/api/verify-x/status/${account}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setStatus(body);
    } catch (e) {
      setError(txErrorMessage(e));
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  const signed = async (action: XLinkAction) => {
    const signer = await getSigner();
    const issuedAt = new Date().toISOString();
    const signature = await signer.signMessage(xLinkMessage({ action, address: account, issuedAt }));
    return { address: account, issuedAt, signature };
  };

  const link = async () => {
    setBusy('link');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/verify-x/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await signed('link')),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.location.assign(body.url); // off to x.com; we come back via /api/verify-x/callback
    } catch (e) {
      setError(txErrorMessage(e));
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy('unlink');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/verify-x/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await signed('unlink')),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNotice('The link was deleted.');
      await load();
    } catch (e) {
      setError(txErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="container mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Link your X account</CardTitle>
          <CardDescription>
            Prove that you control both this wallet and an X account. You sign a message with your wallet (free, no
            transaction), then sign in with X. We only read your X id, handle and display name.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!account ? (
            <Button onClick={connect}>Connect wallet</Button>
          ) : status === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </p>
          ) : status.verified ? (
            <div className="flex items-start gap-3 rounded-md border p-4">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <p>
                  Linked to{' '}
                  <a href={`https://x.com/${status.username}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                    @{status.username}
                  </a>{' '}
                  ({status.name})
                </p>
                <p className="text-muted-foreground">Verified {new Date(status.verifiedAt).toLocaleString()}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No X account is linked to this wallet yet.</p>
          )}

          {notice && <p className="text-sm text-green-600" role="status">{notice}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>

        {account && status && (
          <CardFooter className="flex flex-wrap gap-2">
            <Button onClick={link} disabled={busy !== null}>
              {busy === 'link' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {status.verified ? 'Link a different X account' : 'Verify with X'}
            </Button>
            {status.verified && (
              <Button variant="outline" onClick={unlink} disabled={busy !== null}>
                {busy === 'unlink' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}
                Remove link
              </Button>
            )}
          </CardFooter>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Anyone can look up which X handle is linked to a wallet. You can remove the link at any time. See our{' '}
        <Link href="/privacy" className="underline underline-offset-2">Privacy Notice</Link>.
      </p>
    </main>
  );
}
