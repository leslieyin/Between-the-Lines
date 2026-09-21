import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultView } from "@/components/ResultView";
import { isValidSlug } from "@/lib/slug";
import { getByShareSlug } from "@/server/db/repo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "有人给你看了一段对话的解读 · 话外音",
    description: "逐句算出真实意图、她需要什么、危险等级，由 Jev 模型计算。",
    robots: { index: false, follow: false, nocache: true },
    alternates: { canonical: `/s/${slug}` },
  };
}

/**
 * 分享页。
 *
 * 直接在服务端读库，不绕一圈自己的 API —— 页面渲染和「公开读接口」是两件事，
 * 没必要为了少写一个函数而把同一份数据走两遍网络。
 *
 * 刻意不返回、也不展示她的备注名和关系背景：拿链接的人只需要看见结论。
 */
export default async function SharePage({ params }: Props) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();

  const record = await getByShareSlug(slug);
  if (!record) notFound();

  return (
    <div className="space-y-6">
      <header>
        <p className="font-display mb-3 text-[10px] tracking-[0.3em] text-gold-quiet uppercase">
          分享的解读 · 话外音
        </p>
        <h1 className="font-display text-[26px] leading-[1.35] sm:text-[32px]" style={{ color: "var(--color-ink)" }}>
          有人把一段对话
          <br />
          喂给了 AI
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-soft)" }}>
          一共 {record.herLines} 句她的话，逐句算了真实意图和危险等级。下面就是算出来的结果。
        </p>
      </header>

      <ResultView record={record} showActions={false} shared />

      <section className="cardback rounded-[var(--radius-card)] p-5 text-center">
        <p className="text-[14px]" style={{ color: "var(--color-ink-soft)" }}>
          想看看你自己的那段对话？
        </p>
        <Link
          href="/"
          className="font-display mt-4 inline-flex h-12 items-center justify-center rounded-[10px] px-6 text-[15px]"
          style={{ background: "var(--color-gold)", color: "#241a05" }}
        >
          贴一段算一遍
        </Link>
      </section>
    </div>
  );
}
