'use client';

import { Card, CardContent } from "@/components/ui/card";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { explorerUrl } from '@/config/base-sepolia';

export default function TransactionsPage() {
  const { isAuthenticated, user } = useWalletAuth();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transaction History</h1>
          <p className="text-muted-foreground">
            View the transaction history of your connected wallet
          </p>
          {user && (
            <div className="mt-4 p-4 bg-muted/20 rounded-lg">
              <p className="text-sm">
                <span className="font-medium">Wallet Address:</span> <span className="font-mono">{user.address}</span>
              </p>
            </div>
          )}
        </div>
        {!isAuthenticated && <WalletConnectButton />}
      </div>

      <Card>
        <CardContent className="p-6">
          <Button
            onClick={() => user && window.open(explorerUrl(user.address), '_blank')}
            disabled={!user}
            className="w-full md:w-auto"
            variant="outline"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            View Transactions on Basescan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
