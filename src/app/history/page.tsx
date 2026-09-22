import type { Metadata } from "next";
import { HistoryView } from "@/components/HistoryView";

export const metadata: Metadata = {
  title: "算过的对话 · 懂你",
  robots: { index: false, follow: false },
};

export default function HistoryPage() {
  return <HistoryView />;
}
