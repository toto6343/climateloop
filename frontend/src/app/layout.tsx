import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClimateLoop — 인터랙티브 기후·에너지 시뮬레이터",
  description:
    "지역과 기상 시나리오를 고르고 에너지 믹스를 조정하면 탄소배출·전력망 안정성·지속가능성 지수가 즉시 재계산되는 체험형 기상·기후 교육 시뮬레이터.",
};

/*
 * next/font 로 내려받는 웹폰트가 없다.
 *
 * 한동안 Geist / Geist Mono 를 next/font/google 로 자체 호스팅해 두었는데, 실제로는
 * 둘 다 화면에 나타나지 않았다 — globals.css 의 body 규칙이 font-family 를 Arial 로
 * 덮고 있었고, --font-sans / --font-mono 를 참조하는 font-sans·font-mono 유틸리티도
 * 어디에도 붙어 있지 않았다. 두 벌의 폰트 파일을 받아 놓고 한 글자도 쓰지 않은 셈이다.
 *
 * 게다가 이 화면은 글자의 대부분이 한글인데 Geist 도 Arial 도 한글 글리프가 없다.
 * 무엇으로 그려질지가 규칙에 적혀 있지 않았다는 뜻이라, 지금은 globals.css 의
 * --font-app-sans 한 곳에서 Pretendard → 각 OS 한글 UI 글꼴 순서로 명시한다.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
