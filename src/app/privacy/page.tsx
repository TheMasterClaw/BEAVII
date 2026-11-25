import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Privacy Notice - BAEVII' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Notice" updated="November 25, 2026">
      <p>BAEVII is a testnet demo. We collect as little as we can. This notice explains what is processed and why.</p>

      <h2>What we process</h2>
      <ul>
        <li>
          <strong>Wallet address.</strong> Used to show balances and positions and to send faucet tokens. Transactions you
          sign are public and permanent on the Base Sepolia blockchain. We cannot delete them.
        </li>
        <li>
          <strong>IP address.</strong> The faucet uses it to enforce its cooldown. It is kept only in server memory, for
          about 6 hours, and is not written to a database.
        </li>
        <li>
          <strong>Social handle and post link</strong>, if you use verification. They are used only to process that
          request.
        </li>
        <li>
          <strong>Preferences</strong>, such as theme, stored in your own browser&apos;s local storage.
        </li>
        <li>
          <strong>Server logs.</strong> Our hosting provider may keep standard request logs (IP address, user agent,
          timestamps) for security and operations.
        </li>
      </ul>

      <h2>Third parties</h2>
      <ul>
        <li>
          Wallet connection goes through Reown (WalletConnect) and your wallet provider, under their own policies. Reown&apos;s
          optional analytics is turned off.
        </li>
        <li>Blockchain reads and writes go through public Base Sepolia RPC endpoints.</li>
        <li>The app is hosted on Vercel.</li>
      </ul>
      <p>We do not sell personal data, and we do not use advertising trackers.</p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR or CCPA), you may have the right to access or delete
        your personal data or to object to its use. Data kept only in memory expires on its own. To make a request, contact
        the project maintainers through the repository.
      </p>
    </LegalPage>
  );
}
