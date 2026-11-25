import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Terms of Use - BAEVII' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="November 25, 2026">
      <p>
        BAEVII is an experimental demo running on the Base Sepolia test network. By using it you agree to these terms. If
        you do not agree, do not use it.
      </p>

      <h2>Eligibility</h2>
      <ul>
        <li>You must be at least 18 years old, or the age of majority where you live if that is higher.</li>
        <li>
          You may not use the app if you are on a sanctions list or in a sanctioned region, or where using it would be
          against the law.
        </li>
      </ul>

      <h2>1. Test network only</h2>
      <ul>
        <li>Every token in the app (tUSDC, test stocks and ITF shares) exists only on Base Sepolia and has no monetary value.</li>
        <li>Test tokens cannot be exchanged for money, real securities or any mainnet asset, and we will never offer to do so.</li>
        <li>Do not send real funds or mainnet assets to any address shown in the app.</li>
      </ul>

      <h2>2. Not securities, not funds</h2>
      <ul>
        <li>
          Test stocks are simulated mirrors that use public company names and tickers for illustration only. They are not
          shares, do not represent any interest in a company, and are not issued, endorsed or sponsored by Coinbase, Base or
          any listed company.
        </li>
        <li>
          ITFs (index token funds) are smart-contract baskets on a test network. They are not exchange-traded funds or
          registered investment funds of any kind. &quot;Managers&quot; and &quot;fees&quot; are simulated.
        </li>
        <li>Nothing in the app is an offer to sell or a solicitation to buy any security or financial product.</li>
      </ul>

      <h2>3. No advice</h2>
      <p>
        Prices, NAVs, analytics and AI or agent output are for demonstration. They may be delayed, estimated, wrong or
        sample data. They are not investment, legal or tax advice. Do not use them to make real financial decisions.
      </p>

      <h2>4. Market data</h2>
      <p>
        Reference prices come from third-party sources and are shown for demonstration only. We make no claim about their
        accuracy or completeness, and they may not be redistributed.
      </p>

      <h2>5. Your responsibilities</h2>
      <ul>
        <li>You are responsible for your wallet, your keys and every transaction you sign.</li>
        <li>Do not abuse the faucet, try to disrupt the service, or use the app for anything unlawful.</li>
        <li>If you connect an AI agent, you are responsible for what it does with its key.</li>
      </ul>

      <h2>6. No warranty, limited liability</h2>
      <p>
        The app and its smart contracts are experimental and unaudited, and are provided &quot;as is&quot; without warranties of
        any kind. Contracts, balances and data may be reset, changed or removed at any time. To the fullest extent the law
        allows, BAEVII and its contributors are not liable for any loss arising from your use of the app.
      </p>

      <h2>7. Trademarks</h2>
      <p>
        Company names, tickers, Coinbase and Base belong to their owners. We use them only to identify what a test token
        mirrors, and that use does not imply any affiliation or endorsement.
      </p>

      {/* TODO(owner): add a governing-law/venue clause once the legal entity and jurisdiction are decided. */}
      <h2>8. Contact</h2>
      <p>
        For questions about these terms or your data, open an issue on the project&apos;s{' '}
        <a href="https://github.com/TheMasterClaw/BEAVII/issues" className="underline underline-offset-2">
          GitHub repository
        </a>
        .
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update these terms at any time. Continuing to use the app means you accept the updated terms. See also our{' '}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Notice
        </Link>
        .
      </p>
    </LegalPage>
  );
}
