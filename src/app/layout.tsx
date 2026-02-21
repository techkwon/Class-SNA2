import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Class-SNA | 학급 네트워크 분석",
  description: "교실 소셜 네트워크 분석 도구",
  icons: {
    icon: [
      { url: "/icon.png?v=2", type: "image/png", sizes: "64x64" },
      { url: "/favicon.png?v=2", type: "image/png", sizes: "64x64" },
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
    ],
    shortcut: [{ url: "/favicon.png?v=2", type: "image/png" }],
    apple: [{ url: "/icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
