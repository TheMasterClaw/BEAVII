'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ImprovedSidebarNav } from '@/components/dashboard/improved-sidebar-nav';
import { PageTransition } from '@/components/ui/page-transition';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useSidebar } from '@/components/SidebarProvider';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
}

export function DashboardLayoutClient({ children }: DashboardLayoutClientProps) {
  const { isSidebarOpen, setIsSidebarOpen } = useSidebar();
  const pathname = usePathname();

  // Close the mobile drawer after navigating.
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname, setIsSidebarOpen]);

  // Close on Escape and lock background scroll while the mobile drawer is open.
  useEffect(() => {
    if (!isSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsSidebarOpen(false);
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const prevOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isSidebarOpen, setIsSidebarOpen]);

  return (
    <div className="flex w-full min-w-0">
      {/* Mobile backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setIsSidebarOpen(false)}
        className={`fixed inset-0 top-16 z-30 bg-black/40 backdrop-blur-[1px] transition-opacity md:hidden ${
          isSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Sidebar: off-canvas drawer on mobile, sticky column from md up */}
      <aside
        className={`fixed left-0 top-16 z-40 h-[calc(100dvh-4rem)] w-72 max-w-[85vw] shrink-0 overflow-y-auto border-r bg-background transition-transform duration-300 ease-in-out md:sticky md:z-auto md:w-64 md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col py-4">
          <div className="mb-2 flex justify-end px-3 md:hidden">
            <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setIsSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex-1">
            <ImprovedSidebarNav isCollapsed={false} />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
          <PageTransition className="flex-1 p-4 md:p-6 lg:p-8">
            {children}
          </PageTransition>
        </div>
      </main>
    </div>
  );
}
