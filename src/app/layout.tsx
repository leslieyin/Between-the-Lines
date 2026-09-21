import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "话外音 · AI 恋爱翻译器",
  description:
    "粘贴一段聊天记录，每一句给你翻一张牌 —— 真实意图概率、她需要什么、危险等级，由 Jev 模型算出来，不是话术。",
  applicationName: "话外音",
  openGraph: {
    title: "话外音 · AI 恋爱翻译器",
    description: "她说「随便」「没事」的时候，心里在想什么。逐句算给你看。",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#110c22",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="relative min-h-dvh">
        {/* 直接用 link 而不是 next/font：next/font 会在构建时下载字体文件，
            国内网络下会让 build 直接失败。link + display=swap 更稳。
            React 19 会自动把这些 link 提升到 head。 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Noto+Serif+SC:wght@400;500;700&display=swap"
        />
        <div className="relative z-10 mx-auto w-full max-w-[680px] px-4 pb-24 pt-8 sm:pt-14">
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="mb-8 flex items-center justify-between gap-4">
      <Link href="/" className="group flex items-baseline gap-2">
        <span
          className="font-display text-[11px] tracking-[0.34em] transition-colors group-hover:text-gold-bright"
          style={{ color: "var(--color-gold)" }}
        >
          话外音
        </span>
        <span className="font-display text-[9px] tracking-[0.24em] text-ink-faint uppercase">
          Between the Lines
        </span>
      </Link>
      <nav className="flex items-center gap-4 text-[12.5px]">
        <Link href="/history" className="text-ink-faint transition-colors hover:text-gold">
          历史
        </Link>
        <a
          href="https://docs.typesafe.ai"
          target="_blank"
          rel="noreferrer noopener"
          className="text-ink-faint transition-colors hover:text-gold"
        >
          关于
        </a>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-20">
      <div className="gold-rule mb-4" />
      <p className="text-[12px] leading-relaxed text-ink-faint">
        结论由 Jev 模型（TypeSafe System One）计算，选项提前定死，模型只负责给概率。
        <br />
        它只算，不陪你聊，也没法替你去爱一个人。
      </p>
    </footer>
  );
}
