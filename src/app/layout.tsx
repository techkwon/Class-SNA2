import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";

const SITE_URL = "https://class-sna-2.vercel.app";
const SITE_NAME = "Class-SNA 2.0";
const SITE_TITLE = "Class-SNA 2.0 | 학급 네트워크 분석";
const SITE_DESCRIPTION =
  "CSV 설문 기반 학급 사회관계망 분석 도구. 학생 관계 정규화, 2D/3D 그래프 시각화, 심화 코칭 리포트와 엑셀 내보내기를 지원합니다.";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | Class-SNA 2.0",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  referrer: "origin-when-cross-origin",
  keywords: [
    "Class-SNA",
    "학급 네트워크 분석",
    "사회관계망 분석",
    "SNA",
    "교우관계 분석",
    "교실 데이터 분석",
    "학생 관계 분석",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: SITE_TITLE,
    siteName: SITE_NAME,
    description: SITE_DESCRIPTION,
    locale: "ko_KR",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "Class-SNA 2.0",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/icon.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
