'use client';

import { AgentMonitoringClient } from "@/components/etf/agent-monitoring-client";

export default function AgentMonitoringPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Agent Monitoring</h2>
          <p className="text-muted-foreground">
            Monitor and manage ITF agent operations on Base Sepolia
          </p>
        </div>
      </div>
      
      <AgentMonitoringClient onSuccess={() => console.log('Agent operation completed successfully')} />
      
      <div className="p-4 bg-muted/30 rounded-lg text-sm">
        <h3 className="font-medium mb-2">About ITF Agents</h3>
        <p className="mb-3">
          ITF Agents are specialized smart contract wallets that handle rebalancing, NAV price syncs, 
          deposits, withdrawals, and other operations on behalf of ITF vault contracts.
        </p>
        
        <h4 className="font-medium mb-1">Agent Capabilities</h4>
        <ul className="list-disc list-inside mb-3 space-y-1">
          <li>Execute batched operations on ITF vaults</li>
          <li>Push live Coinbase NAV prices onchain</li>
          <li>Manage fee collection and distribution</li>
        </ul>
        
        <h4 className="font-medium mb-1">Security Considerations</h4>
        <p className="mb-3">
          Agent wallets have limited permissions and can only execute operations authorized by the ITF vault owner.
          All operations are logged and can be monitored through this dashboard.
        </p>
      </div>
    </div>
  );
} 