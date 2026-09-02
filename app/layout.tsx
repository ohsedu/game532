import type { Metadata, Viewport } from "next";
import { Fredoka, Jua } from "next/font/google";
import Confetti from "@/components/Confetti";
import "./globals.css";

// Jua is a rounded Korean display face - the "cute" in the whole design comes
// from it, so it carries both Korean and Latin UI text.
const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
  display: "swap",
});

// Fredoka's numerals are round and even-width, which keeps score columns tidy.
const fredoka = Fredoka({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-fredoka",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ARCADE — 키보드 미니게임 3종",
  description:
    "방향키만으로 즐기는 아케이드 미니게임 3종. 총알 피하기, 똥 피하기, 방향 사수. 점수를 기록하고 랭킹에 도전하세요.",
};

export const viewport: Viewport = {
  themeColor: "#f4f5f8",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${jua.variable} ${fredoka.variable} h-full`}>
      <body className="relative min-h-full flex flex-col antialiased">
        <Confetti />
        {children}
      </body>
    </html>
  );
}
