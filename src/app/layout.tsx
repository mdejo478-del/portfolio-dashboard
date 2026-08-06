import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans_Hebrew({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IPMS — מערכת לניהול תיק השקעות",
  description: "IPMS: מערכת לניהול תיק השקעות. השקעה לפי הקצאה, לא לפי רגש.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before first paint to avoid a flash of the wrong theme: reads the
// user's saved preference (or falls back to their OS-level preference) and
// sets it as a data attribute the CSS in tokens.css keys off of. Kept
// client-side/localStorage-only (not a cookie) so this presentational,
// per-device preference stays fully decoupled from session/auth state.
const THEME_INIT_SCRIPT =
  "(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){}})();";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT below sets data-theme on
    // this element synchronously before React hydrates, so the client's
    // actual attributes never match what the server rendered (the server
    // has no way to know the visitor's stored theme preference) - this is
    // the standard, narrowly-scoped opt-out for that expected, intentional
    // mismatch, not a blanket "ignore hydration issues" switch.
    <html lang="he" dir="rtl" className={`h-full ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">
        {children}
      </body>
    </html>
  );
}
