import { clearStoredAdminToken, getStoredAdminToken } from "./auth";
import type {
  AdminAiUsageBreakdownRow,
  AdminAiUsageBucket,
  AdminAiUsageDetail,
  AdminAiUsageOverview,
  AdminAiUsageRequest,
  AdminAiUsageSummary,
  AdminComputer,
  AdminComputerDetail,
  AdminFeedbackReport,
  AdminMachineIdentity,
  AdminOverview,
  AdminRelease,
  AdminUser,
  AdminUserDetail,
  AdminUserSummary,
  AiUsageBucketGranularity,
  AiUsageGroupBy,
  AiUsageStatus,
  FeedbackReportStatus,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiBase = (() => {
  const base = import.meta.env.BASE_URL ?? "/admin-dashboard/";
  return base.endsWith("/") ? base.slice(0, -1) : base;
})();

const buildUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (path.startsWith("/admin") || path.startsWith("/auth") || path.startsWith("/health")) {
    return path;
  }

  return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
};

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly token?: string;
}

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const token = options.token ?? getStoredAdminToken();

  if (token === null || token.length === 0) {
    throw new ApiError(401, "UNAUTHORIZED", "Admin token is missing");
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  };

  const response = await fetch(buildUrl(path), init);
  const text = await response.text();
  const parsed = text.length === 0 ? {} : safeJson(text);

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAdminToken();
    }

    const error = (parsed as { readonly error?: { readonly code?: string; readonly message?: string } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? `Request failed with ${String(response.status)}`,
    );
  }

  return parsed as T;
};

const requestBlob = async (path: string, options: RequestOptions = {}): Promise<{
  readonly blob: Blob;
  readonly filename: string | null;
}> => {
  const token = options.token ?? getStoredAdminToken();

  if (token === null || token.length === 0) {
    throw new ApiError(401, "UNAUTHORIZED", "Admin token is missing");
  }

  const response = await fetch(buildUrl(path), {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAdminToken();
    }

    const text = await response.text();
    const parsed = text.length === 0 ? {} : safeJson(text);
    const error = (parsed as { readonly error?: { readonly code?: string; readonly message?: string } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? `Request failed with ${String(response.status)}`,
    );
  }

  return {
    blob: await response.blob(),
    filename: readContentDispositionFilename(response.headers.get("content-disposition")),
  };
};

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

export const adminApi = {
  authCheck: (token: string) => request<{ readonly ok: true }>("/admin/auth-check", { token }),
  getOverview: () => request<AdminOverview>("/admin/overview"),
  listUsers: () => request<{ readonly users: AdminUserSummary[] }>("/admin/users"),
  createUser: (input: { readonly email: string; readonly username: string; readonly password: string }) =>
    request<{ readonly user: AdminUser }>("/admin/users", { method: "POST", body: input }),
  getUserDetail: (userId: string) => request<AdminUserDetail>(`/admin/users/${encodeURIComponent(userId)}`),
  deleteUser: (userId: string) =>
    request<{ readonly ok: true }>(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  setUserPassword: (userId: string, password: string) =>
    request<{ readonly user: AdminUser }>(`/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "POST",
      body: { password },
    }),
  revokeAllUserSessions: (userId: string) =>
    request<{ readonly revokedCount: number }>(
      `/admin/users/${encodeURIComponent(userId)}/sessions/revoke-all`,
      { method: "POST" },
    ),
  listComputers: () => request<{ readonly computers: AdminComputer[] }>("/admin/computers"),
  getComputerDetail: (computerId: string) =>
    request<AdminComputerDetail>(`/admin/computers/${encodeURIComponent(computerId)}`),
  renameComputer: (computerId: string, name: string) =>
    request<{ readonly computer: AdminComputer }>(`/admin/computers/${encodeURIComponent(computerId)}`, {
      method: "PATCH",
      body: { name },
    }),
  deleteComputer: (computerId: string) =>
    request<{ readonly ok: true }>(`/admin/computers/${encodeURIComponent(computerId)}`, { method: "DELETE" }),
  startComputer: (computerId: string) =>
    request<{ readonly computer: AdminComputer }>(`/admin/computers/${encodeURIComponent(computerId)}/start`, {
      method: "POST",
    }),
  stopComputer: (computerId: string) =>
    request<{ readonly computer: AdminComputer }>(`/admin/computers/${encodeURIComponent(computerId)}/stop`, {
      method: "POST",
    }),
  restartComputer: (computerId: string) =>
    request<{ readonly computer: AdminComputer }>(`/admin/computers/${encodeURIComponent(computerId)}/restart`, {
      method: "POST",
    }),
  revokeMachineIdentity: (computerId: string, identityId: string) =>
    request<{ readonly identity: AdminMachineIdentity }>(
      `/admin/computers/${encodeURIComponent(computerId)}/identities/${encodeURIComponent(identityId)}/revoke`,
      { method: "POST" },
    ),
  upsertDesktopRelease: (input: {
    readonly channel: string;
    readonly platform: string;
    readonly version: string;
    readonly downloadUrl: string;
    readonly signatureUrl?: string | null;
    readonly notes?: string | null;
  }) =>
    request<{ readonly release: AdminRelease }>("/admin/releases/desktop", {
      method: "POST",
      body: input,
    }),
  upsertMachineServerRelease: (input: {
    readonly channel: string;
    readonly version: string;
    readonly downloadUrl?: string | null;
    readonly dockerImage?: string | null;
    readonly metadata?: unknown;
    readonly notes?: string | null;
  }) =>
    request<{ readonly release: AdminRelease }>("/admin/releases/machine-server", {
      method: "POST",
      body: input,
    }),
  deleteRelease: (releaseId: string) =>
    request<{ readonly ok: true }>(`/admin/releases/${encodeURIComponent(releaseId)}`, { method: "DELETE" }),
  listAiUsage: (params: AiUsageListParams = {}) =>
    request<{ readonly usage: AdminAiUsageRequest[] }>(buildPath("/admin/ai-usage", params)),
  summarizeAiUsage: (params: AiUsageFilterParams = {}) =>
    request<{ readonly summary: AdminAiUsageSummary }>(buildPath("/admin/ai-usage/summary", params)),
  bucketAiUsage: (params: AiUsageBucketParams) =>
    request<{ readonly buckets: AdminAiUsageBucket[] }>(buildPath("/admin/ai-usage/buckets", params)),
  breakdownAiUsage: (params: AiUsageBreakdownParams) =>
    request<{ readonly groupBy: AiUsageGroupBy; readonly groups: AdminAiUsageBreakdownRow[] }>(
      buildPath("/admin/ai-usage/breakdown", params),
    ),
  getAiUsageDetail: (usageId: string) =>
    request<AdminAiUsageDetail>(`/admin/ai-usage/${encodeURIComponent(usageId)}`),
  getUserAiUsage: (userId: string, params: AiUsageRangeParams = {}) =>
    request<AdminAiUsageOverview>(
      buildPath(`/admin/users/${encodeURIComponent(userId)}/ai-usage`, params),
    ),
  getComputerAiUsage: (computerId: string, params: AiUsageRangeParams = {}) =>
    request<AdminAiUsageOverview>(
      buildPath(`/admin/computers/${encodeURIComponent(computerId)}/ai-usage`, params),
    ),
  listFeedback: (params: FeedbackListParams = {}) =>
    request<{ readonly feedback: AdminFeedbackReport[] }>(buildPath("/admin/feedback", params)),
  downloadFeedbackArchive: (feedbackId: string) =>
    requestBlob(`/admin/feedback/${encodeURIComponent(feedbackId)}/download`),
};

interface FeedbackListParams {
  readonly userId?: string;
  readonly computerId?: string;
  readonly status?: FeedbackReportStatus;
  readonly before?: string | Date;
  readonly limit?: number;
}

interface AiUsageFilterParams {
  readonly userId?: string;
  readonly computerId?: string;
  readonly model?: string;
  readonly status?: AiUsageStatus;
  readonly from?: string | Date;
  readonly to?: string | Date;
}

interface AiUsageListParams extends AiUsageFilterParams {
  readonly before?: string | Date;
  readonly limit?: number;
}

interface AiUsageBucketParams extends AiUsageFilterParams {
  readonly bucket: AiUsageBucketGranularity;
}

interface AiUsageBreakdownParams extends AiUsageFilterParams {
  readonly groupBy: AiUsageGroupBy;
  readonly limit?: number;
}

interface AiUsageRangeParams {
  readonly from?: string | Date;
  readonly to?: string | Date;
  readonly bucket?: AiUsageBucketGranularity;
  readonly breakdownLimit?: number;
}

const buildPath = (basePath: string, params: object): string => {
  const search = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    if (rawValue instanceof Date) {
      search.set(key, rawValue.toISOString());
    } else if (typeof rawValue === "string" || typeof rawValue === "number") {
      search.set(key, String(rawValue));
    }
  }
  const query = search.toString();
  return query.length === 0 ? basePath : `${basePath}?${query}`;
};

const readContentDispositionFilename = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/iu.exec(value);
  if (utf8Match?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const fallbackMatch = /filename="([^"]+)"/iu.exec(value) ?? /filename=([^;]+)/iu.exec(value);
  return fallbackMatch?.[1] ?? null;
};
