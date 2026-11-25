/**
 * The exact text a wallet signs to link or unlink an X account. Shared by the verify page (signs) and the server
 * (rebuilds it and checks the signature), so it must stay client-safe.
 */
export type XLinkAction = 'link' | 'unlink';

export function xLinkMessage(p: { action: XLinkAction; address: string; issuedAt: string }) {
  return [
    p.action === 'link' ? 'BEAVII: link my X account to this wallet' : 'BEAVII: remove the X account linked to this wallet',
    `Wallet: ${p.address.toLowerCase()}`,
    'Chain: 84532',
    `Issued: ${p.issuedAt}`,
  ].join('\n');
}
