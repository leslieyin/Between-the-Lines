"use client";

/**
 * 前端 API 客户端。
 *
 * 三条规则（对应「前端边界」的约定）：
 *  1. 4xx 不重试 —— 用户的问题重试一百次还是一样，直接告诉他哪里不对。
 *  2. 5xx / 网络抖动自动重试，最多 3 次，指数退避。
 *  3. 所有错误都映射成能直接显示的中文文案。界面里永远不该出现 "fetch failed" 这种东西。
 */

import type {
  AnalysisRecord,
  AnalysisSummary,
  RelationshipProfile,
} from "@/features/analyze/types";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; requestId?: string } };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(message: string, options: { code: string; status: number; requestId?: string }) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(path, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        credentials: "same-origin",
      });

      const payload = (await response.json().catch(() => null)) as Envelope<T> | null;

      if (response.ok && payload?.ok) return payload.data;

      const status = response.status;
      const message =
        payload && payload.ok === false
          ? payload.error.message
          : status >= 500
            ? "服务器出了点问题，稍后再试一次。"
            : "请求没成功，检查一下输入再试。";
      const code = payload && payload.ok === false ? payload.error.code : `HTTP_${status}`;
      const requestId = payload && payload.ok === false ? payload.error.requestId : undefined;

      if (RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(400 * 2 ** attempt);
        continue;
      }

      throw new ApiError(message, { code, status, requestId });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
    }
  }

  throw new ApiError(
    typeof navigator !== "undefined" && navigator.onLine === false
      ? "网断了，连上以后再点一次。"
      : "网没连上，再点一次试试。",
    { code: "NETWORK", status: 0 },
  );
}

// ── 具体接口 ────────────────────────────────────────────────────────────────

export type AnalyzeRequestBody = {
  raw: string;
  herName: string | null;
  youAre: string | null;
  relation: string | null;
  extra: string | null;
};

export function analyze(body: AnalyzeRequestBody): Promise<AnalysisRecord> {
  return request<AnalysisRecord>("/api/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listAnalyses(): Promise<{ items: AnalysisSummary[] }> {
  return request<{ items: AnalysisSummary[] }>("/api/analyses");
}

export function getAnalysis(id: string): Promise<AnalysisRecord> {
  return request<AnalysisRecord>(`/api/analyses/${encodeURIComponent(id)}`);
}

export function removeAnalysis(id: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/analyses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function clearAnalyses(): Promise<{ removed: number }> {
  return request<{ removed: number }>("/api/analyses", { method: "DELETE" });
}

export function createShareLink(id: string): Promise<{ slug: string; path: string }> {
  return request<{ slug: string; path: string }>(
    `/api/analyses/${encodeURIComponent(id)}/share`,
    { method: "POST" },
  );
}

export function getProfile(): Promise<RelationshipProfile> {
  return request<RelationshipProfile>("/api/profile");
}

export function saveProfile(input: {
  herName: string | null;
  relation: string | null;
  extra: string | null;
}): Promise<RelationshipProfile> {
  return request<RelationshipProfile>("/api/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
