import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tax-Loss Sentinel Sandbox",
  description: "Frontend-only sandbox for the Tax-Loss Sentinel demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
