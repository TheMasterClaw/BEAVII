'use client';

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { ThreePieChart } from '@/components/3d/ThreePieChart';
import { ThreeOrbitalView } from '@/components/3d/ThreeOrbitalView';
import { ThreeBarChart } from '@/components/3d/ThreeBarChart';
import { ThreeNetworkGraph } from '@/components/3d/ThreeNetworkGraph';
import { TransitionWrapper } from "@/components/ui/transition-wrapper";

// ITF data interface
interface ITFData {
  name: string;
  description: string;
  icon: string;
  influencerImage: string;
  expenseRatio: string;
  aum: string;
  performance30D: string;
  bio?: string;
  socialMedia?: {
    twitter?: string;
    youtube?: string;
    telegram?: string;
    discord?: string;
  };
  holdings: Array<{ symbol: string; weight: string }>;
}

// Generate performance data based on ITF characteristics
const generatePerformanceData = (itf: ITFData) => {
  const baseValue = 100;
  const performance = parseFloat(itf.performance30D.replace(/[^0-9.-]/g, ''));
  const volatility = Math.abs(performance) * 0.3; // Higher performance = higher volatility
  
  const daily = [];
  for (let i = 0; i < 30; i++) {
    const dayVariation = (Math.random() - 0.5) * volatility;
    const trend = (performance / 30) * i; // Gradual trend over 30 days
    const value = baseValue + trend + dayVariation;
    daily.push({
      date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      value: Math.max(50, Math.round(value * 100) / 100)
    });
  }
  
  return daily;
};

// Generate asset allocation data from ITF holdings
const generateAssetAllocationData = (itf: ITFData) => {
  const colors = ['#FF6B9D', '#4ECDC4', '#FFE66D', '#FF6B6B', '#A8E6CF', '#9B59B6', '#3498DB', '#E67E22'];
  
  let holdings = itf.holdings.map(h => ({ ...h, weight: parseFloat(h.weight) }));
  const totalWeight = holdings.reduce((sum, h) => sum + h.weight, 0);
  
  if (totalWeight > 0 && Math.abs(totalWeight - 100) > 0.01) {
    const normalizationFactor = 100 / totalWeight;
    holdings = holdings.map(h => ({ ...h, weight: h.weight * normalizationFactor }));
  }

  return holdings.map((holding, index) => ({
    category: holding.symbol,
    percentage: holding.weight,
    color: colors[index % colors.length],
    icon: `/baevii-logo.png`, // Default icon, could be enhanced with token-specific icons
    index,
  }));
};

// Base-only app: every ITF lives on Base, so the chain distribution is a single slice
const BASE_CHAIN_DISTRIBUTION = [
  { category: 'Base', chain: 'Base', percentage: 100, color: '#0052FF', icon: '/sandwave.png' },
];

const generateChainDistributionData = (_itf: ITFData) => BASE_CHAIN_DISTRIBUTION;

// How value moves inside Base: wallet -> vault -> stock tokens, with the agent syncing NAV and rebalancing
const BASE_NETWORK_FLOW = {
  nodes: [
    { id: 'wallet', label: 'Wallet', icon: '/baevii-logo.png', color: '#45B7D1', position: [-2, 0, -2] as [number, number, number] },
    { id: 'vault', label: 'ITF Vault', icon: '/sandwave.png', color: '#0052FF', position: [2, 0, -2] as [number, number, number] },
    { id: 'stocks', label: 'Stock Tokens', icon: '/tornado.png', color: '#4ECDC4', position: [2, 0, 2] as [number, number, number] },
    { id: 'agent', label: 'Agent', icon: '/jellyfish.png', color: '#FFE66D', position: [-2, 0, 2] as [number, number, number] },
  ],
  flows: [
    { from: 'wallet', to: 'vault', color: '#45B7D1' },
    { from: 'vault', to: 'stocks', color: '#0052FF' },
    { from: 'agent', to: 'vault', color: '#FFE66D' },
    { from: 'vault', to: 'wallet', color: '#4ECDC4' },
  ],
};

const generateNetworkFlowData = (_chainDistribution: unknown[]) => BASE_NETWORK_FLOW;

export interface AnalyticsChartProps {
  selectedTab?: string;
  timeframe?: string;
  itfData?: ITFData; // New prop for ITF data
}

export function AnalyticsChart({ selectedTab = 'performance', timeframe = '1w', itfData }: AnalyticsChartProps) {
  const [chartType, setChartType] = useState(selectedTab);
  const [period, setPeriod] = useState(timeframe);

  useEffect(() => {
    setChartType(selectedTab);
  }, [selectedTab]);
  
  // Generate chart data based on ITF data
  const chartData = useMemo(() => {
    if (!itfData) {
      // Fallback to mock data if no ITF data provided
      return {
        daily: [
          { date: '2023-04-01', value: 100 },
          { date: '2023-04-02', value: 102 },
          { date: '2023-04-03', value: 99 },
          { date: '2023-04-04', value: 101 },
          { date: '2023-04-05', value: 104 },
          { date: '2023-04-06', value: 103 },
          { date: '2023-04-07', value: 105 },
          { date: '2023-04-08', value: 108 },
          { date: '2023-04-09', value: 107 },
          { date: '2023-04-10', value: 110 },
          { date: '2023-04-11', value: 112 },
          { date: '2023-04-12', value: 115 },
        ],
        assetAllocation: [
          { category: 'DeFi', percentage: 35, icon: '/sandwave.png', color: '#FF6B9D', index: 0 },
          { category: 'Layer 1', percentage: 25, icon: '/tornado.png', color: '#4ECDC4', index: 1 },
          { category: 'NFT & Gaming', percentage: 15, icon: '/cactus.png', color: '#FFE66D', index: 2 },
          { category: 'Infrastructure', percentage: 15, icon: '/jellowchurch.png', color: '#FF6B6B', index: 3 },
          { category: 'Stablecoins', percentage: 10, icon: '/donut.png', color: '#A8E6CF', index: 4 }
        ],
        chainDistribution: BASE_CHAIN_DISTRIBUTION,
        networkNodes: BASE_NETWORK_FLOW.nodes,
        networkFlows: BASE_NETWORK_FLOW.flows
      };
    }
    
    const daily = generatePerformanceData(itfData);
    const assetAllocation = generateAssetAllocationData(itfData);
    const chainDistribution = generateChainDistributionData(itfData);
    const { nodes: networkNodes, flows: networkFlows } = generateNetworkFlowData(chainDistribution);
    
    return {
      daily,
      assetAllocation,
      chainDistribution,
      networkNodes,
      networkFlows
    };
  }, [itfData]);
  
  // Render different charts based on chartType
  const renderChart = () => {
    switch (chartType) {
      case 'performance':
        return (
          <TransitionWrapper transitionType="card-appear">
            <div className="w-full flex flex-col items-center justify-center p-2" role="img" aria-label={`Performance chart for ${itfData?.name || 'Portfolio'} over ${period} timeframe`}>
              <div className="w-full max-w-2xl">
                <div className="mb-4 bg-muted/30 p-4 rounded-lg">
                  <p className="font-medium mb-2 text-center text-sm">
                    {itfData ? `${itfData.name} Performance` : 'Portfolio Performance'}
                  </p>
                  <div className="w-full h-64">
                    <ThreeBarChart data={chartData.daily} />
                  </div>
                </div>
              </div>
            </div>
          </TransitionWrapper>
        );
      case 'allocation':
        return (
          <TransitionWrapper transitionType="card-appear">
            <div className="w-full h-full" role="region" aria-label="Asset Allocation">
              <ThreePieChart data={chartData.assetAllocation} />
            </div>
          </TransitionWrapper>
        );
      case 'chains':
        return (
          <TransitionWrapper transitionType="card-appear">
            <div className="w-full h-full flex items-center justify-center" role="region" aria-label="Chain Distribution">
              <ThreeOrbitalView data={chartData.chainDistribution} />
            </div>
          </TransitionWrapper>
        );
      case 'history':
        return (
          <TransitionWrapper transitionType="card-appear">
            <div className="w-full flex flex-col items-center justify-center p-2" role="region" aria-label="Base Network Activity">
              <div className="w-full max-w-2xl">
                <div className="w-full h-64">
                  <ThreeNetworkGraph
                    nodes={chartData.networkNodes}
                    flows={chartData.networkFlows}
                  />
                </div>
              </div>
            </div>
          </TransitionWrapper>
        );
      case 'network':
        return (
          <TransitionWrapper transitionType="card-appear">
            <div className="w-full p-2" role="region" aria-label="Network Flow">
              <div className="w-full h-[400px] bg-slate-900/50 rounded-lg">
                <ThreeNetworkGraph
                  nodes={chartData.networkNodes}
                  flows={chartData.networkFlows}
                />
              </div>
            </div>
          </TransitionWrapper>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center">
      {renderChart()}
    </div>
  );
} 