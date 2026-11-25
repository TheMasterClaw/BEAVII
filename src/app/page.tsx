'use client';

import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import Link from 'next/link';
import Image from 'next/image';

export default function HomePage() {
  const { isAuthenticated } = useWalletAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="container mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          
        </div>
      </nav>

      {/* Hero Section */}
      <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10 sm:py-16">
        <div className="flex flex-col items-center justify-center">
          <Image
            src="/baevii-logo.png"
            alt="BAEVII Logo"
            width={256}
            height={256}
            className="mb-4 h-32 w-32 drop-shadow-lg sm:h-64 sm:w-64"
            priority
          />
          <h1 className="text-5xl sm:text-6xl font-extrabold text-foreground mb-6 sm:mb-8 tracking-tight">BAEVII</h1>
        </div>
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold text-center bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent animate-fade-in">
            Stock baskets, onchain
          </h1>
          <p className="mt-4 text-lg sm:text-xl md:text-2xl text-center text-muted-foreground max-w-3xl mx-auto animate-fade-in-delay mb-8">
            Buy a basket of tokenized stocks in one transaction, or launch your own ITF on Base and earn its fees.
          </p>

          <div className="mb-12 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/etfs"
              className="rounded-lg bg-primary px-8 py-3 text-lg text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Explore ITFs
            </Link>
            {isAuthenticated ? (
              <Link href="/dashboard" className="rounded-lg border px-8 py-3 text-lg transition-colors hover:bg-muted">
                Your portfolio
              </Link>
            ) : (
              <WalletConnectButton />
            )}
          </div>
          <p className="-mt-8 mb-4 text-sm text-muted-foreground">Testnet demo on Base Sepolia. Test tokens have no value.</p>

          {/* Feature Grid */}
          <div className="grid gap-6 md:grid-cols-3 md:gap-8 mt-10 sm:mt-16">
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Image src="/how-it-works-ai.png" alt="AI" width={32} height={32} />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">Agent-ready</h3>
              <p className="text-muted-foreground">
                Give your own AI agents a scoped account: spending limits, sell caps and rebalancing rights you control.
              </p>
            </div>
            
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Image src="/how-it-works-crosschain.png" alt="Base network" width={32} height={32} />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">Built on Base</h3>
              <p className="text-muted-foreground">
                Every ITF, token and agent action settles on Base, with low fees and fast confirmations.
              </p>
            </div>
            
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Image src="/how-it-works-deposit.png" alt="Deposit" width={32} height={32} />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">Buy and redeem at NAV</h3>
              <p className="text-muted-foreground">
                Pay test USDC to buy, redeem for cash or take the stocks themselves. In-kind redemption always works.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}