import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext 适配器配置。
 *
 * 这里刻意保持默认（不接 R2 增量缓存）：这个应用是「一进一出」的实时计算，
 * 页面本身不需要 ISR，接了缓存反而增加心智负担。等以后有静态内容页再开。
 */
export default defineCloudflareConfig();
