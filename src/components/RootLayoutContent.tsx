'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import ClientLayout from '@/components/ClientLayout';
import { ToastProvider } from '@/components/ui/use-toast';
// import { PrivyWalletProvider } from '@/components/PrivyWalletProvider';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { Menu } from 'lucide-react';
import { BASE_SEPOLIA } from '@/config/base-sepolia';
import { SidebarProvider, useSidebar } from './SidebarProvider';

interface RootLayoutContentProps {
  children: React.ReactNode;
}

function RootLayoutInner({ children }: RootLayoutContentProps) {
  const { theme, setTheme, toggleSidebar } = useSidebar();
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'color-blind' : 'light';
  const themeIcon = theme === 'light' ? '🌞' : theme === 'dark' ? '🌚' : theme === 'color-blind' ? '👁️' : null;

  return (
    <ClientLayout>
      <ToastProvider>
        {/* Always show header on all pages */}
        <header className="fixed w-full bg-background/80 backdrop-blur-sm z-50 border-b text-foreground">
          <div className="container mx-auto flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open sidebar"
                className="md:hidden"
                onClick={toggleSidebar}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <Link href="/">
                <Image 
                  src="/baevii-logo.png" 
                  alt="BAEVII Logo" 
                  width={32} 
                  height={32} 
                  className="h-8 w-auto cursor-pointer"
                />
              </Link>
              <span className="font-semibold text-lg text-foreground">BAEVII</span>
            </div>

            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Link href="/dashboard/create">
                <Button size="sm">Create ITF</Button>
              </Link>
              
              {/* Network: Base only */}
              <div
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                title={`${BASE_SEPOLIA.name} (chain ${BASE_SEPOLIA.chainId})`}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden="true" />
                <span className="hidden sm:inline">{BASE_SEPOLIA.name}</span>
              </div>

              <WalletConnectButton />
              {theme !== null && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle theme"
                  onClick={() => {
                    const newTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'color-blind' : 'light';
                    setTheme(newTheme);
                  }}
                  className="text-xl text-foreground"
                >
                  {themeIcon}
                  <span className="sr-only">Switch to {nextTheme} mode</span>
                </Button>
              )}
            </div>
          </div>
        </header>
        
        <div className="pt-16">
          {children}
        </div>
        
        <footer className="py-8 border-t mt-auto">
          <div className="container mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-center">
              <div className="flex items-center gap-2 mb-4 md:mb-0">
                <Image 
                  src="/baevii-logo.png" 
                  alt="BAEVII Logo" 
                  width={32} 
                  height={32} 
                  className="h-8 w-auto"
                />
                <span className="font-semibold text-foreground">BAEVII</span>
              </div>
              <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} BAEVII Labs. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </ToastProvider>
    </ClientLayout>
  );
}

export function RootLayoutContent({ children }: RootLayoutContentProps) {
  return (
    <SidebarProvider>
      <RootLayoutInner>{children}</RootLayoutInner>
    </SidebarProvider>
  );
} 