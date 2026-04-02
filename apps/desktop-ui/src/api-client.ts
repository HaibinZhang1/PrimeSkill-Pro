export interface BackendHealth {
  ok: boolean;
  service: string;
}

export interface MarketplaceSkill {
  skillId: number;
  skillVersionId: number;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  whyMatched: string;
  supportedTools: string[];
  visibilityReason: string;
  recommendedInstallMode: 'global' | 'project';
  installCount: number;
  confidenceScore: number;
}

export interface MarketplaceSearchResponse {
  degraded: boolean;
  degradedReason?: string;
  mode: 'featured' | 'search';
  source: 'database' | 'demo_catalog';
  items: MarketplaceSkill[];
}

export interface SearchMarketplaceInput {
  query: string;
  page?: number;
  pageSize?: number;
  toolContext?: string[];
  workspaceContext?: {
    workspaceRegistryId?: number;
  };
}

export interface CreateInstallTicketInput {
  skillId: number;
  skillVersionId: number;
  operationType: 'install' | 'upgrade' | 'uninstall' | 'rollback';
  targetScope: 'global' | 'project';
  toolInstanceId: number;
  workspaceRegistryId?: number;
  idempotencyKey: string;
}

export interface InstallTicketPayload {
  ticketId: string;
  installRecordId: number;
  consumeMode: 'one_time' | 'idempotent_retry';
  retryToken?: string;
  expiresAt: string;
}

const defaultApiBaseUrl = 'http://127.0.0.1:3000';
const defaultAuthPayload = {
  userId: 1,
  clientDeviceId: 10,
  departmentIds: [1],
  roleCodes: ['normal_user']
};

export function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return defaultApiBaseUrl;
  }

  return configuredBaseUrl.replace(/\/+$/, '');
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function resolveDesktopAuthToken() {
  const configuredToken = import.meta.env.VITE_DESKTOP_AUTH_TOKEN?.trim();

  if (configuredToken) {
    return configuredToken;
  }

  return encodeBase64Url(JSON.stringify(defaultAuthPayload));
}

function buildApiHeaders() {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${resolveDesktopAuthToken()}`
  };
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`backend responded with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function loadBackendHealth(): Promise<BackendHealth> {
  return readJson<BackendHealth>(`${resolveApiBaseUrl()}/health`);
}

export async function searchMarketplaceSkills(input: SearchMarketplaceInput): Promise<MarketplaceSearchResponse> {
  return readJson<MarketplaceSearchResponse>(`${resolveApiBaseUrl()}/api/desktop/search/skills`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify({
      query: input.query,
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 6,
      toolContext: input.toolContext ?? [],
      workspaceContext: input.workspaceContext
    })
  });
}

export async function createInstallTicket(input: CreateInstallTicketInput): Promise<InstallTicketPayload> {
  return readJson<InstallTicketPayload>(`${resolveApiBaseUrl()}/api/desktop/install-tickets`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify(input)
  });
}
