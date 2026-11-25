import Link from 'next/link';

/** Site-wide notice: testnet demo, valueless tokens, not an offer or advice. */
export function TestnetNotice() {
  return (
    <div
      role="note"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-900 dark:text-amber-200 sm:text-sm"
    >
      <strong>Testnet demo.</strong> Every token here is on Base Sepolia and has no value. Test stocks are simulated
      mirrors, not shares, and are not issued by or affiliated with Coinbase, Base or the listed companies. ITFs are not
      registered funds. Nothing here is an offer or investment advice.{' '}
      <Link href="/terms" className="underline underline-offset-2">
        Terms
      </Link>
    </div>
  );
}
