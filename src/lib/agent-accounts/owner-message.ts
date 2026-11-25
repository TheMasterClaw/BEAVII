/**
 * The exact text an owner's wallet signs to manage their agents. Shared by the dashboard (signs) and the
 * server (rebuilds the same text from the request and checks the signature), so it must stay client-safe.
 */
export type OwnerAction = 'create' | 'revoke' | 'rotate' | 'limits' | 'withdraw';

export function ownerMessage(p: { action: OwnerAction; owner: string; agent: string; details?: Record<string, unknown>; issuedAt: string }) {
  const details = p.details ? JSON.stringify(sortKeys(p.details)) : '{}';
  return [
    'BEAVII agent account',
    `Action: ${p.action}`,
    `Owner: ${p.owner.toLowerCase()}`,
    `Agent: ${p.agent}`,
    `Details: ${details}`,
    'Chain: 84532',
    `Issued: ${p.issuedAt}`,
  ].join('\n');
}

function sortKeys(o: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}
