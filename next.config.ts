import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// 只在 `next dev` 时启动 wrangler 的本地绑定代理，让本机能直接用 D1（本地 SQLite 模拟）。
// 构建期不启动，避免 `opennextjs-cloudflare build` 白白拉起一个代理进程。
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

/**
 * 安全头 + 基础收敛。
 * 刻意不配 CORS：所有接口只被本站同源页面调用，开放跨域只会扩大攻击面。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
