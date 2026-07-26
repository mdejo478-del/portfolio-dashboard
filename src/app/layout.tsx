import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ניהול סיכונים ותיק השקעות",
  description: "דשבורד מקצועי לניהול תיק השקעות ויומן מסחר",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className="h-full">
      <body className="min-h-full bg-[#0A0E13] text-[#E8EDF2] antialiased">
        {children}
      </body>
    </html>
  );
}
