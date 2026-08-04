import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IPMS — מערכת לניהול תיק השקעות",
  description: "IPMS: מערכת לניהול תיק השקעות. השקעה לפי הקצאה, לא לפי רגש.",
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
