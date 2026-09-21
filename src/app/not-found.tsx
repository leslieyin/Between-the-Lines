import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="font-display text-[11px] tracking-[0.3em] text-gold-quiet uppercase">404</p>
      <h1
        className="font-display mt-4 text-[26px] leading-snug"
        style={{ color: "var(--color-ink)" }}
      >
        这条链接不在了
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-soft)" }}>
        分享出去的记录被创建者删掉之后，链接就会失效。
      </p>
      <Link
        href="/"
        className="font-display mt-7 inline-flex h-12 items-center rounded-[10px] px-6 text-[15px]"
        style={{ background: "var(--color-gold)", color: "#241a05" }}
      >
        回去贴一段算一遍
      </Link>
    </div>
  );
}
