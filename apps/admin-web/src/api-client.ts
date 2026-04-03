export type SkillStatus = 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type ReviewTaskStatus = 'created' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'closed';
export type VisibilityType = 'public' | 'department' | 'private';
export type PackageFormat = 'zip' | 'legacy_json';

export interface AdminArtifactSummary {
  packageSource: 'external' | 'internal';
  packageUri: string;
  checksum: string;
  packageFormat?: PackageFormat;
  fileName?: string;
  byteSize?: number;
  entryCount?: number;
}

export interface AdminReviewTaskSummary {
  reviewTaskId: number;
  skillVersionId: number;
  version: string;
  reviewStatus: ReviewStatus;
  taskStatus: ReviewTaskStatus;
  reviewRound: number;
  submitterId: number;
  submitterDisplayName?: string;
  reviewerId?: number;
  reviewerDisplayName?: string;
  comment?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface AdminSkillVersionSummary {
  skillVersionId: number;
  version: string;
  reviewStatus: ReviewStatus;
  packageUri: string;
  checksum: string;
  publishedAt?: string;
  createdAt: string;
  artifact: AdminArtifactSummary;
}

export interface AdminSkillListItem {
  skillId: number;
  skillKey: string;
  name: string;
  summary?: string;
  status: SkillStatus;
  visibilityType: VisibilityType;
  ownerUserId: number;
  ownerDisplayName?: string;
  ownerDepartmentId?: number;
  ownerDepartmentName?: string;
  categoryName?: string;
  updatedAt: string;
  currentVersion?: AdminSkillVersionSummary;
  activeReviewTask?: AdminReviewTaskSummary;
}

export interface AdminSkillDetailResponse {
  skillId: number;
  skillKey: string;
  name: string;
  summary?: string;
  description?: string;
  status: SkillStatus;
  visibilityType: VisibilityType;
  ownerUserId: number;
  ownerDisplayName?: string;
  ownerDepartmentId?: number;
  ownerDepartmentName?: string;
  categoryName?: string;
  tags: Array<{ tagId: number; name: string }>;
  versions: AdminSkillVersionSummary[];
  reviewTasks: AdminReviewTaskSummary[];
  updatedAt: string;
}

export interface AdminSkillOptionItem {
  id: number;
  name: string;
}

export interface AdminSkillEditorOptionsResponse {
  categories: AdminSkillOptionItem[];
  tags: AdminSkillOptionItem[];
}

export interface AdminReviewQueueItem extends AdminReviewTaskSummary {
  skillId: number;
  skillKey: string;
  skillName: string;
  skillStatus: SkillStatus;
  ownerDepartmentId?: number;
  ownerDepartmentName?: string;
  artifact: AdminArtifactSummary;
}

export interface CreateSkillVersionInput {
  version: string;
  readmeText?: string;
  changelog?: string;
  aiToolsJson?: string[];
  installModeJson?: Record<string, unknown>;
  manifestJson?: Record<string, unknown>;
  signature?: string;
  artifact: {
    format: PackageFormat;
    entries: Array<{ path: string; content: string }>;
  };
}

export interface CreateSkillInput {
  skillKey: string;
  name: string;
  summary?: string;
  description?: string;
  categoryId?: number;
  visibilityType: VisibilityType;
  tagIds?: number[];
}

export interface CreateSkillResponse {
  skillId: number;
  status: 'draft';
}

export interface CreateSkillVersionResponse {
  skillVersionId: number;
  reviewStatus: 'pending';
  stage1IndexStatus: 'pending';
  stage2IndexStatus: 'pending';
  packageUri: string;
  checksum: string;
  packageSource: 'external' | 'internal';
}

export interface SubmitSkillReviewInput {
  skillVersionId: number;
  reviewerId?: number;
  comment?: string;
}

export interface SubmitSkillReviewResponse {
  reviewTaskId: number;
  status: 'created' | 'assigned';
  reviewRound: number;
}

export interface ApproveReviewResponse {
  reviewTaskId: number;
  skillId: number;
  skillVersionId: number;
  skillStatus: 'published';
  reviewStatus: 'approved';
  stage1JobId: string;
}

const defaultApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:3000';
const defaultAuthToken = import.meta.env.VITE_ADMIN_AUTH_TOKEN?.trim() || '';

function trimBaseUrl(apiBaseUrl: string) {
  return apiBaseUrl.trim().replace(/\/+$/, '');
}

function buildHeaders(authToken: string) {
  const trimmedToken = authToken.trim();
  if (!trimmedToken) {
    throw new Error('请先填写 Bearer Token');
  }

  return {
    'content-type': 'application/json',
    authorization: `Bearer ${trimmedToken}`
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

    throw new Error(detail ? `接口返回 ${response.status}：${detail}` : `接口返回 ${response.status}`);
  }

  return (await response.json()) as T;
}

export function resolveDefaultAdminConfig() {
  return {
    apiBaseUrl: trimBaseUrl(defaultApiBaseUrl),
    authToken: defaultAuthToken
  };
}

export function encodeMockAuthToken(payload: {
  userId: number;
  clientDeviceId: number;
  departmentIds: number[];
  roleCodes: string[];
}) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function listAdminSkills(input: {
  apiBaseUrl: string;
  authToken: string;
  search?: string;
  skillStatus?: SkillStatus | 'all';
  reviewStatus?: ReviewStatus | 'all';
  limit?: number;
}) {
  const url = new URL(`${trimBaseUrl(input.apiBaseUrl)}/api/admin/skills`);

  if (input.search?.trim()) {
    url.searchParams.set('search', input.search.trim());
  }
  if (input.skillStatus && input.skillStatus !== 'all') {
    url.searchParams.set('skillStatus', input.skillStatus);
  }
  if (input.reviewStatus && input.reviewStatus !== 'all') {
    url.searchParams.set('reviewStatus', input.reviewStatus);
  }
  url.searchParams.set('limit', String(input.limit ?? 50));

  return readJson<{ items: AdminSkillListItem[] }>(url, {
    headers: buildHeaders(input.authToken)
  });
}

export async function getAdminSkillDetail(input: { apiBaseUrl: string; authToken: string; skillId: number }) {
  return readJson<AdminSkillDetailResponse>(`${trimBaseUrl(input.apiBaseUrl)}/api/admin/skills/${input.skillId}`, {
    headers: buildHeaders(input.authToken)
  });
}

export async function listAdminSkillOptions(input: { apiBaseUrl: string; authToken: string }) {
  return readJson<AdminSkillEditorOptionsResponse>(`${trimBaseUrl(input.apiBaseUrl)}/api/admin/skill-options`, {
    headers: buildHeaders(input.authToken)
  });
}

export async function listAdminReviewQueue(input: { apiBaseUrl: string; authToken: string; limit?: number }) {
  const url = new URL(`${trimBaseUrl(input.apiBaseUrl)}/api/admin/reviews/queue`);
  url.searchParams.set('limit', String(input.limit ?? 50));

  return readJson<{ items: AdminReviewQueueItem[] }>(url, {
    headers: buildHeaders(input.authToken)
  });
}

export async function createSkillVersion(input: {
  apiBaseUrl: string;
  authToken: string;
  skillId: number;
  body: CreateSkillVersionInput;
}) {
  return readJson<CreateSkillVersionResponse>(`${trimBaseUrl(input.apiBaseUrl)}/api/skills/${input.skillId}/versions`, {
    method: 'POST',
    headers: buildHeaders(input.authToken),
    body: JSON.stringify(input.body)
  });
}

export async function createSkill(input: {
  apiBaseUrl: string;
  authToken: string;
  body: CreateSkillInput;
}) {
  return readJson<CreateSkillResponse>(`${trimBaseUrl(input.apiBaseUrl)}/api/skills`, {
    method: 'POST',
    headers: buildHeaders(input.authToken),
    body: JSON.stringify(input.body)
  });
}

export async function submitSkillReview(input: {
  apiBaseUrl: string;
  authToken: string;
  skillId: number;
  body: SubmitSkillReviewInput;
}) {
  return readJson<SubmitSkillReviewResponse>(
    `${trimBaseUrl(input.apiBaseUrl)}/api/skills/${input.skillId}/submit-review`,
    {
      method: 'POST',
      headers: buildHeaders(input.authToken),
      body: JSON.stringify(input.body)
    }
  );
}

export async function approveReview(input: {
  apiBaseUrl: string;
  authToken: string;
  reviewTaskId: number;
  comment?: string;
}) {
  return readJson<ApproveReviewResponse>(`${trimBaseUrl(input.apiBaseUrl)}/api/reviews/${input.reviewTaskId}/approve`, {
    method: 'POST',
    headers: buildHeaders(input.authToken),
    body: JSON.stringify({
      comment: input.comment?.trim() || undefined
    })
  });
}
