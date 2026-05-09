"use client";

export interface CloudUser {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CloudSession {
  readonly token: string;
  readonly expiresAt: string;
}

export interface CloudComputer {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly kind: "cloud" | "local" | string;
  readonly status: string;
  readonly providerMetadata: unknown;
  readonly capabilities: unknown;
  readonly machineServerVersion: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly tunnelConnected?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthResponse {
  readonly user: CloudUser;
  readonly session: CloudSession;
}

export interface MeResponse {
  readonly user: CloudUser;
}

export interface ComputersResponse {
  readonly computers: CloudComputer[];
}

export interface ComputerResponse {
  readonly computer: CloudComputer;
}

export interface ComputerAccessSession {
  readonly id: string;
  readonly computerId: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface ComputerAccessSessionResponse {
  readonly accessSession: ComputerAccessSession;
  readonly routes: {
    readonly filesystemWebSocketUrl: string;
    readonly agentBaseUrl: string;
    readonly capabilitiesWebSocketUrl?: string;
  };
}

export class CloudApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
  }
}

export class CloudClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  login(input: { readonly email: string; readonly password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
  }

  me(token: string): Promise<MeResponse> {
    return this.request<MeResponse>("/auth/me", {
      headers: this.authHeaders(token),
    });
  }

  logout(token: string): Promise<{ readonly ok: boolean }> {
    return this.request<{ readonly ok: boolean }>("/auth/logout", {
      method: "POST",
      headers: this.authHeaders(token),
    });
  }

  listComputers(token: string): Promise<ComputersResponse> {
    return this.request<ComputersResponse>("/computers", {
      headers: this.authHeaders(token),
    });
  }

  getComputer(token: string, computerId: string): Promise<ComputerResponse> {
    return this.request<ComputerResponse>(
      `/computers/${encodeURIComponent(computerId)}`,
      {
        headers: this.authHeaders(token),
      },
    );
  }

  createComputer(token: string, input: { readonly name: string }): Promise<ComputerResponse> {
    return this.request<ComputerResponse>("/computers", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        ...this.authHeaders(token),
        "content-type": "application/json",
      },
    });
  }

  startComputer(token: string, computerId: string): Promise<ComputerResponse> {
    return this.request<ComputerResponse>(
      `/computers/${encodeURIComponent(computerId)}/start`,
      {
        method: "POST",
        headers: this.authHeaders(token),
      },
    );
  }

  createComputerAccessSession(token: string, computerId: string): Promise<ComputerAccessSessionResponse> {
    return this.request<ComputerAccessSessionResponse>(
      `/computers/${encodeURIComponent(computerId)}/access-session`,
      {
        method: "POST",
        headers: this.authHeaders(token),
      },
    );
  }

  private authHeaders(token: string): HeadersInit {
    return { authorization: `Bearer ${token}` };
  }

  private async request<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const body = await readJson(response);

    if (!response.ok) {
      const error = readError(body);
      throw new CloudApiError(response.status, error.code, error.message);
    }

    return body as TResponse;
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const readError = (body: unknown): { readonly code: string; readonly message: string } => {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null
  ) {
    const error = body.error as { readonly code?: unknown; readonly message?: unknown };

    return {
      code: typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      message: typeof error.message === "string" ? error.message : "Request failed.",
    };
  }

  return { code: "REQUEST_FAILED", message: "Request failed." };
};
