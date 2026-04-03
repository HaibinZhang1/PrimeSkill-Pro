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

export interface RegisterClientDeviceInput {
  deviceFingerprint: string;
  deviceName: string;
  osType: string;
  osVersion?: string;
  desktopAppVersion?: string;
  nativeCoreVersion?: string;
}

export interface RegisterClientDeviceResponse {
  clientDeviceId: number;
  deviceFingerprint: string;
  status: 'active' | 'revoked' | 'offline';
  lastSeenAt: string;
}

export interface MyToolInstance {
  toolInstanceId: number;
  clientDeviceId: number;
  toolCode: string;
  toolName: string;
  toolVersion?: string;
  osType: string;
  detectedInstallPath?: string;
  detectedConfigPath?: string;
  discoveredTargets: string[];
  detectionSource: 'auto' | 'manual' | 'imported';
  trustStatus: 'detected' | 'verified' | 'disabled';
  lastScannedAt?: string;
}

export interface ReportToolInstancesInput {
  items: Array<{
    toolCode: string;
    toolVersion?: string;
    osType: string;
    detectedInstallPath?: string;
    detectedConfigPath?: string;
    discoveredTargets?: string[];
    detectionSource?: 'auto' | 'manual' | 'imported';
    trustStatus?: 'detected' | 'verified' | 'disabled';
  }>;
}

export interface MyWorkspace {
  workspaceRegistryId: number;
  clientDeviceId: number;
  workspaceName?: string;
  workspacePath: string;
  projectFingerprint: string;
  repoRemote?: string;
  repoBranch?: string;
  lastUsedAt?: string;
  updatedAt: string;
}

export interface ReportWorkspacesInput {
  items: Array<{
    workspaceName?: string;
    workspacePath: string;
    projectFingerprint: string;
    repoRemote?: string;
    repoBranch?: string;
  }>;
}

export interface MyInstall {
  bindingId: number;
  installRecordId: number;
  skillId: number;
  skillVersionId: number;
  skillKey: string;
  skillName: string;
  skillVersion: string;
  toolInstanceId?: number;
  toolCode?: string;
  toolName?: string;
  targetScope: 'global' | 'project';
  workspaceRegistryId?: number;
  workspaceName?: string;
  workspacePath?: string;
  resolvedTargetPath: string;
  installStatus: string;
  installedAt: string;
  lastVerifiedAt?: string;
  state: 'active' | 'removed' | 'drifted';
}

export interface MyInstallDetail extends MyInstall {
  operationType: 'install' | 'upgrade' | 'uninstall' | 'rollback';
  traceId?: string;
  manifest?: {
    ticketId?: string;
    templateCode?: string;
    packagingMode?: string;
    contentManagementMode?: string;
    targetPathTemplate?: string;
    filenameTemplate?: string;
    packageUri?: string;
  };
}

export interface ReportInstallVerificationInput {
  verificationStatus: 'verified' | 'drifted';
  resolvedTargetPath?: string;
  driftReasons?: string[];
  payload?: Record<string, unknown>;
  traceId: string;
}

export interface ReportInstallVerificationResponse {
  bindingId: number;
  installRecordId: number;
  state: 'active' | 'drifted';
  lastVerifiedAt: string;
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
    let detail = '';
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      detail = body.message ?? body.code ?? '';
    } catch {
      detail = '';
    }
    throw new Error(detail ? `backend responded with ${response.status}: ${detail}` : `backend responded with ${response.status}`);
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

export async function registerClientDevice(
  input: RegisterClientDeviceInput
): Promise<RegisterClientDeviceResponse> {
  return readJson<RegisterClientDeviceResponse>(`${resolveApiBaseUrl()}/api/client-devices/register`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify(input)
  });
}

export async function reportToolInstances(input: ReportToolInstancesInput): Promise<{ items: MyToolInstance[] }> {
  return readJson<{ items: MyToolInstance[] }>(`${resolveApiBaseUrl()}/api/tool-instances/report`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify(input)
  });
}

export async function reportWorkspaces(input: ReportWorkspacesInput): Promise<{ items: MyWorkspace[] }> {
  return readJson<{ items: MyWorkspace[] }>(`${resolveApiBaseUrl()}/api/workspaces/report`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify(input)
  });
}

export async function listMyToolInstances(): Promise<{ items: MyToolInstance[] }> {
  return readJson<{ items: MyToolInstance[] }>(`${resolveApiBaseUrl()}/api/my/tool-instances`, {
    headers: buildApiHeaders()
  });
}

export async function listMyWorkspaces(): Promise<{ items: MyWorkspace[] }> {
  return readJson<{ items: MyWorkspace[] }>(`${resolveApiBaseUrl()}/api/my/workspaces`, {
    headers: buildApiHeaders()
  });
}

export async function listMyInstalls(): Promise<{ items: MyInstall[] }> {
  return readJson<{ items: MyInstall[] }>(`${resolveApiBaseUrl()}/api/my/installs`, {
    headers: buildApiHeaders()
  });
}

export async function getMyInstallDetail(bindingId: number): Promise<MyInstallDetail> {
  return readJson<MyInstallDetail>(`${resolveApiBaseUrl()}/api/my/installs/${bindingId}`, {
    headers: buildApiHeaders()
  });
}

export async function reportInstallVerification(
  bindingId: number,
  input: ReportInstallVerificationInput
): Promise<ReportInstallVerificationResponse> {
  return readJson<ReportInstallVerificationResponse>(`${resolveApiBaseUrl()}/api/my/installs/${bindingId}/verify`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify(input)
  });
}
