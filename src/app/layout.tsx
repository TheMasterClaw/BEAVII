import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import "./animations.css";
import "./modern-card.css";
import { RootLayoutContent } from '@/components/RootLayoutContent';
import { ReownProvider } from "@/components/ReownProvider";

// Metadata for the site
export const metadata: Metadata = {
  title: 'BAEVII - Tokenized Stock ITFs on Base',
  description: 'Buy, launch and manage tokenized-stock ITFs on Base',
  applicationName: 'BAEVII',
  keywords: ['ITF', 'Base', 'Crypto', 'DeFi', 'Finance', 'AI', 'Blockchain', 'Portfolio Management'],
  authors: [{ name: 'BAEVII Team' }],
  creator: 'BAEVII',
  publisher: 'BAEVII',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
  ],
};

// Define Inter font variables
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

// Outfit backs the Tailwind font-sans stack. Self-hosted by next/font (variable font, one file)
// instead of a render-blocking Google Fonts @import in globals.css.
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${outfit.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved/system theme before first paint to avoid a white flash.
            Mirrors the logic in SidebarProvider. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'&&t!=='color-blind'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;d.classList.add(t);d.style.colorScheme=t==='dark'?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className={inter.className}>
        {/* HydrationFix and SidebarProvider are mounted inside RootLayoutContent */}
        <ReownProvider>
          <RootLayoutContent>{children}</RootLayoutContent>
        </ReownProvider>
      </body>
    </html>
  );
}
