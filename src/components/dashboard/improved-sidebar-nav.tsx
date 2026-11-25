'use client';

import { useViewTransitions } from './use-view-transitions';
import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { TransitionWrapper } from '@/components/ui/transition-wrapper';
import { BASE_SEPOLIA } from '@/config/base-sepolia';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface ImprovedSidebarNavProps {
  items?: {
    title: string;
    href: string;
    icon: string;
    description?: string;
    /** Items with a section are grouped under that heading after the main items. */
    section?: string;
  }[];
  className?: string;
  isCollapsed?: boolean;
}

// Main journey first (see, buy, launch), then the tools around it.
const defaultItems = [
  { title: 'Portfolio', href: '/dashboard', icon: '📊', description: 'Your holdings and the ITFs you manage' },
  { title: 'Explore ITFs', href: '/dashboard/etfs', icon: '💼', description: 'Browse community stock baskets' },
  { title: 'Launch ITF', href: '/dashboard/create', icon: '➕', description: 'Build a stock basket and earn its fees' },
  { title: 'Tokenized Stocks', href: '/dashboard/stocks', icon: '📈', description: 'Catalog, live prices and test funds' },
  { title: 'Your Agents', href: '/dashboard/agents', icon: '🔌', description: 'Give AI agents scoped accounts and permissions' },
  { title: 'Protocol Agent', href: '/dashboard/agent', icon: '🤖', description: 'Price-sync agent status', section: 'Developer' },
  { title: 'Network & Contracts', href: '/dashboard/settings', icon: '⚙️', description: 'Addresses and network details', section: 'Developer' },
];


export function ImprovedSidebarNav({ items = defaultItems, className, isCollapsed = false }: ImprovedSidebarNavProps) {
  const pathname = usePathname();
  
  return (
    <div className={cn("px-3 py-2 w-full h-full", className)}>
      {!isCollapsed && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold">ITF Manager</h2>
        </div>
      )}
      
      <nav className="flex flex-col space-y-1">
        {items.map((item, i) => {
          const heading = item.section && item.section !== items[i - 1]?.section ? item.section : null;
          // Check if this item is active
          // Match whole path segments, so /dashboard/agents doesn't light up /dashboard/agent
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
          
          return (
            <div key={item.href}>
            {heading && !isCollapsed && (
              <h3 className="mb-1 mt-5 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{heading}</h3>
            )}
            <TransitionWrapper
              className="w-full"
              transitionType={isActive ? 'slide-up' : undefined}
            >
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 md:py-2 text-sm font-medium transition-colors w-full",
                  isActive 
                    ? "bg-accent text-accent-foreground" 
                    : "hover:bg-accent/50 hover:text-accent-foreground/90",
                  isCollapsed && "justify-center"
                )}
                aria-current={isActive ? 'page' : undefined}
                title={isCollapsed ? item.title : item.description}
              >
                <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-lg" aria-hidden="true">
                  {item.icon}
                </div>
                {!isCollapsed && <span>{item.title}</span>}
              </Link>
            </TransitionWrapper>
            </div>
          );
        })}
      </nav>
      
      {!isCollapsed && (
        <div className="mt-6 pt-6 border-t space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Network</h3>
            <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
              <div className="w-3 h-3 rounded-full bg-blue-600"></div>
              <span className="text-sm">{BASE_SEPOLIA.name}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 