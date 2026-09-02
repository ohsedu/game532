import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARCADE — 키보드 미니게임 3종",
  description:
    "방향키만으로 즐기는 아케이드 미니게임 3종. 총알 피하기, 똥 피하기, 방향 사수. 점수를 기록하고 랭킹에 도전하세요.",
};

export const viewport: Viewport = {
  themeColor: "#07080d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
