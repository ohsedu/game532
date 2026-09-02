import type { Metadata, Viewport } from "next";
import { Fredoka, Jua } from "next/font/google";
import Confetti from "@/components/Confetti";
import "./globals.css";

// Jua is a rounded Korean display face - the "cute" in the whole design comes
// from it, so it carries both Korean and Latin UI text.
//
// "latin" is the only subset next/font exposes for Korean families; the Hangul
// glyphs arrive through the unicode-range split blocks Google returns anyway.
// Verified after build by checking the emitted CSS for U+AC00 ranges.
const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
  display: "swap",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
});

// Fredoka's numerals are round and even-width, which keeps score columns tidy.
const fredoka = Fredoka({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-fredoka",
  display: "swap",
});

const TITLE = "게임532";
const DESCRIPTION =
  "방향키만으로 즐기는 아케이드 미니게임 3종. 총알 피하기, 똥 피하기, 방향 사수. 점수를 기록하고 랭킹에 도전하세요.";

/**
 * Absolute base for og:image and friends.
 *
 * Without metadataBase Next falls back to localhost, so a shared link would
 * point its preview image at the sharer machine and render nothing. Vercel
 * supplies the production host at build time; the literal is the fallback for
 * a plain `next build` elsewhere.
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
    : "https://game.ohsedu.site");

/**
 * Served straight out of public/ rather than through the app/opengraph-image
 * file convention.
 *
 * That convention emits a cache-busted URL — /opengraph-image.png with an
 * ?opengraph-image.<hash>.png query — and KakaoTalk's scraper does not reliably
 * fetch it, which is why a shared link showed the title and description but no
 * picture. A plain path with no query is understood by everything.
 *
 * The file is also a 63KB JPEG rather than a 770KB PNG: scrapers give up on
 * slow images well before any documented size limit.
 */
const OG_IMAGE = {
  url: "/og.jpg",
  // Exactly 2:1. KakaoTalk and Twitter render at 2:1 and so crop nothing;
  // Facebook and LinkedIn want 1.91:1 and trim ~27px off each side, which lands
  // in the gradient margin rather than the artwork. At the old 1200x630 that
  // trim came off the top and bottom instead, cutting into the illustration.
  width: 1200,
  height: 600,
  type: "image/jpeg",
  alt: "게임532 — 총알 피하고, 똥 피하고, 방향을 사수해라!",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: {
    type: "website",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "ko_KR",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
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
