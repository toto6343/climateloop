import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClimateLoop — 인터랙티브 기후·에너지 시뮬레이터",
  description:
    "지역과 기상 시나리오를 고르고 에너지 믹스를 조정하면 탄소배출·전력망 안정성·지속가능성 지수가 즉시 재계산되는 체험형 기상·기후 교육 시뮬레이터.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
