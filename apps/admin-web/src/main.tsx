import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';

import {
  approveReview,
  createSkill,
  createSkillVersion,
  encodeMockAuthToken,
  getAdminSkillDetail,
  listAdminReviewQueue,
  listAdminSkillOptions,
  listAdminSkills,
  resolveDefaultAdminConfig,
  submitSkillReview,
  type AdminSkillEditorOptionsResponse,
  type AdminReviewQueueItem,
  type AdminSkillDetailResponse,
  type AdminSkillListItem,
  type PackageFormat,
  type ReviewStatus,
  type SkillStatus,
  type VisibilityType
} from './api-client';
import './styles.css';

type Config = { apiBaseUrl: string; authToken: string };
type Filters = { search: string; skillStatus: SkillStatus | 'all'; reviewStatus: ReviewStatus | 'all' };

const CONFIG_KEY = 'prime-admin.config.v1';
const FILTER_KEY = 'prime-admin.filters.v1';

const defaultVersionDraft = () => ({
  version: '',
  format: 'zip' as PackageFormat,
  aiTools: 'cursor',
  installMode: '{\n  "scope": "project"\n}',
  manifest: '{}',
  readmeText: '',
  changelog: '',
  entryPath: 'SKILL.md',
  entryContent: '# 新版本\n\n请补充最小可用内容。'
});

const defaultSkillDraft = () => ({
  skillKey: '',
  name: '',
  summary: '',
  description: '',
  visibilityType: 'department' as VisibilityType,
  categoryId: '',
  tagIds: [] as number[]
});

function restore<T>(key: string, fallback: T) {
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function fmtDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '未记录';
}

function fmtBytes(value?: number) {
  if (!value) return '未记录';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function parseJsonObject(text: string, fieldName: string) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${fieldName} 需要是合法 JSON 对象`);
  }
}

function statusClass(status: string) {
  return `status-pill ${status}`;
}

function AdminApp() {
  const [config, setConfig] = useState<Config>(() => restore(CONFIG_KEY, resolveDefaultAdminConfig()));
  const [filters, setFilters] = useState<Filters>(() => restore(FILTER_KEY, { search: '', skillStatus: 'all', reviewStatus: 'all' }));
  const [tokenBuilder, setTokenBuilder] = useState({ userId: '1', clientDeviceId: '100', departmentIds: '1', roleCodes: 'platform_admin' });
  const [skills, setSkills] = useState<AdminSkillListItem[]>([]);
  const [queue, setQueue] = useState<AdminReviewQueueItem[]>([]);
  const [options, setOptions] = useState<AdminSkillEditorOptionsResponse>({ categories: [], tags: [] });
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminSkillDetailResponse | null>(null);
  const [skillDraft, setSkillDraft] = useState(defaultSkillDraft);
  const [versionDraft, setVersionDraft] = useState(defaultVersionDraft);
  const [submitDraft, setSubmitDraft] = useState({ skillVersionId: '', reviewerId: '', comment: '请协助完成最小发布审核。' });
  const [busy, setBusy] = useState({ list: false, detail: false, queue: false, options: false, skill: false, version: false, submit: false, approveId: 0 });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config)), [config]);
  useEffect(() => window.localStorage.setItem(FILTER_KEY, JSON.stringify(filters)), [filters]);

  async function loadList(preferredSkillId?: number) {
    setBusy((v) => ({ ...v, list: true }));
    try {
      const res = await listAdminSkills({ ...config, ...filters });
      setSkills(res.items);
      setSelectedSkillId((current) => {
        if (preferredSkillId) return preferredSkillId;
        if (current && res.items.some((item) => item.skillId === current)) return current;
        return res.items[0]?.skillId ?? null;
      });
    } finally {
      setBusy((v) => ({ ...v, list: false }));
    }
  }

  async function loadQueue() {
    setBusy((v) => ({ ...v, queue: true }));
    try {
      const res = await listAdminReviewQueue(config);
      setQueue(res.items);
    } finally {
      setBusy((v) => ({ ...v, queue: false }));
    }
  }

  async function loadOptions() {
    setBusy((v) => ({ ...v, options: true }));
    try {
      const res = await listAdminSkillOptions(config);
      setOptions(res);
    } finally {
      setBusy((v) => ({ ...v, options: false }));
    }
  }

  async function refresh(preferredSkillId?: number) {
    if (!config.authToken.trim()) {
      setMessage({ type: 'error', text: '请先填写 Bearer Token。' });
      return;
    }
    setMessage(null);
    try {
      await Promise.all([loadList(preferredSkillId), loadQueue(), loadOptions()]);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '刷新失败' });
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSkillId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setBusy((v) => ({ ...v, detail: true }));
    getAdminSkillDetail({ ...config, skillId: selectedSkillId })
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setSubmitDraft((current) => ({ ...current, skillVersionId: current.skillVersionId || String(res.versions[0]?.skillVersionId ?? '') }));
      })
      .catch((error) => !cancelled && setMessage({ type: 'error', text: error instanceof Error ? error.message : '读取详情失败' }))
      .finally(() => !cancelled && setBusy((v) => ({ ...v, detail: false })));
    return () => {
      cancelled = true;
    };
  }, [config, selectedSkillId]);

  const summary = useMemo(
    () => ({
      total: skills.length,
      pending: skills.filter((item) => item.status === 'pending_review').length,
      published: skills.filter((item) => item.status === 'published').length,
      queue: queue.length
    }),
    [queue.length, skills]
  );

  function toggleTag(tagId: number) {
    setSkillDraft((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((value) => value !== tagId)
        : [...current.tagIds, tagId]
    }));
  }

  async function onCreateSkill(event: React.FormEvent) {
    event.preventDefault();
    setBusy((v) => ({ ...v, skill: true }));
    setMessage(null);
    try {
      const res = await createSkill({
        ...config,
        body: {
          skillKey: skillDraft.skillKey.trim(),
          name: skillDraft.name.trim(),
          summary: skillDraft.summary.trim() || undefined,
          description: skillDraft.description.trim() || undefined,
          categoryId: skillDraft.categoryId ? Number(skillDraft.categoryId) : undefined,
          visibilityType: skillDraft.visibilityType,
          tagIds: skillDraft.tagIds.length > 0 ? skillDraft.tagIds : undefined
        }
      });
      setSkillDraft(defaultSkillDraft());
      setMessage({ type: 'success', text: `Skill 已创建，skillId=${res.skillId}。` });
      await loadList(res.skillId);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '创建 Skill 失败' });
    } finally {
      setBusy((v) => ({ ...v, skill: false }));
    }
  }

  async function onCreateVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSkillId) return setMessage({ type: 'error', text: '请先选择一个 Skill。' });
    setBusy((v) => ({ ...v, version: true }));
    setMessage(null);
    try {
      const res = await createSkillVersion({
        ...config,
        skillId: selectedSkillId,
        body: {
          version: versionDraft.version.trim(),
          readmeText: versionDraft.readmeText.trim() || undefined,
          changelog: versionDraft.changelog.trim() || undefined,
          aiToolsJson: versionDraft.aiTools.split(',').map((v) => v.trim()).filter(Boolean),
          installModeJson: parseJsonObject(versionDraft.installMode, '安装模式'),
          manifestJson: parseJsonObject(versionDraft.manifest, 'Manifest'),
          artifact: {
            format: versionDraft.format,
            entries: [{ path: versionDraft.entryPath.trim(), content: versionDraft.entryContent }]
          }
        }
      });
      setSubmitDraft((current) => ({ ...current, skillVersionId: String(res.skillVersionId) }));
      setVersionDraft(defaultVersionDraft());
      setMessage({ type: 'success', text: `版本已创建，skillVersionId=${res.skillVersionId}。` });
      await loadList(selectedSkillId);
      const nextDetail = await getAdminSkillDetail({ ...config, skillId: selectedSkillId });
      setDetail(nextDetail);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '创建版本失败' });
    } finally {
      setBusy((v) => ({ ...v, version: false }));
    }
  }

  async function onSubmitReview(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSkillId) return setMessage({ type: 'error', text: '请先选择一个 Skill。' });
    setBusy((v) => ({ ...v, submit: true }));
    setMessage(null);
    try {
      const res = await submitSkillReview({
        ...config,
        skillId: selectedSkillId,
        body: {
          skillVersionId: Number(submitDraft.skillVersionId),
          reviewerId: submitDraft.reviewerId.trim() ? Number(submitDraft.reviewerId) : undefined,
          comment: submitDraft.comment.trim() || undefined
        }
      });
      setMessage({ type: 'success', text: `提审成功，reviewTaskId=${res.reviewTaskId}。` });
      await refresh(selectedSkillId);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '提审失败' });
    } finally {
      setBusy((v) => ({ ...v, submit: false }));
    }
  }

  async function onApprove(item: AdminReviewQueueItem) {
    setBusy((v) => ({ ...v, approveId: item.reviewTaskId }));
    setMessage(null);
    try {
      const res = await approveReview({ ...config, reviewTaskId: item.reviewTaskId, comment: '通过 admin-web 最小审核页批准发布。' });
      setMessage({ type: 'success', text: `审核通过，skillVersionId=${res.skillVersionId}，stage1JobId=${res.stage1JobId}。` });
      await refresh(item.skillId);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '审核通过失败' });
    } finally {
      setBusy((v) => ({ ...v, approveId: 0 }));
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <section className="panel hero">
          <div className="hero-top">
            <div>
              <p className="hero-eyebrow">PrimeSkill Pro</p>
              <h1>最小发布与审核台</h1>
              <p>当前只覆盖列表、详情、审核队列，以及基于 inline artifact 的最小版本创建与提审入口。</p>
            </div>
            <button className="button primary" type="button" onClick={() => void refresh(selectedSkillId ?? undefined)}>刷新后台数据</button>
          </div>
          <div className="hero-grid">
            <section className="config-card">
              <div className="field-grid">
                <div className="field-wide"><label>Backend 地址</label><input value={config.apiBaseUrl} onChange={(e) => setConfig((v) => ({ ...v, apiBaseUrl: e.target.value }))} /></div>
                <div className="field-wide"><label>Bearer Token</label><textarea value={config.authToken} onChange={(e) => setConfig((v) => ({ ...v, authToken: e.target.value }))} /></div>
                <div className="field"><label>用户 ID</label><input value={tokenBuilder.userId} onChange={(e) => setTokenBuilder((v) => ({ ...v, userId: e.target.value }))} /></div>
                <div className="field"><label>客户端设备 ID</label><input value={tokenBuilder.clientDeviceId} onChange={(e) => setTokenBuilder((v) => ({ ...v, clientDeviceId: e.target.value }))} /></div>
                <div className="field"><label>部门 ID</label><input value={tokenBuilder.departmentIds} onChange={(e) => setTokenBuilder((v) => ({ ...v, departmentIds: e.target.value }))} /></div>
                <div className="field"><label>角色</label><input value={tokenBuilder.roleCodes} onChange={(e) => setTokenBuilder((v) => ({ ...v, roleCodes: e.target.value }))} /></div>
              </div>
              <div className="action-row" style={{ marginTop: 12 }}>
                <button
                  className="button subtle"
                  type="button"
                  onClick={() =>
                    setConfig((v) => ({
                      ...v,
                      authToken: encodeMockAuthToken({
                        userId: Number(tokenBuilder.userId),
                        clientDeviceId: Number(tokenBuilder.clientDeviceId),
                        departmentIds: tokenBuilder.departmentIds.split(',').map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0),
                        roleCodes: tokenBuilder.roleCodes.split(',').map((v) => v.trim()).filter(Boolean)
                      })
                    }))
                  }
                >
                  生成测试令牌
                </button>
              </div>
            </section>
            <aside className="summary-card">
              <h2>当前概览</h2>
              <div className="summary-metric">
                <div className="metric-box"><strong>{summary.total}</strong><span className="muted">已加载 Skill</span></div>
                <div className="metric-box"><strong>{summary.pending}</strong><span className="muted">待审核 Skill</span></div>
                <div className="metric-box"><strong>{summary.queue}</strong><span className="muted">审核队列</span></div>
              </div>
              <div className="summary-metric">
                <div className="metric-box"><strong>{summary.published}</strong><span className="muted">已发布 Skill</span></div>
                <div className="metric-box"><strong>{busy.list || busy.detail || busy.queue ? '…' : '就绪'}</strong><span className="muted">页面状态</span></div>
                <div className="metric-box"><strong>{detail?.versions.length ?? 0}</strong><span className="muted">当前详情版本数</span></div>
              </div>
            </aside>
          </div>
          {message ? <div className={message.type === 'error' ? 'error-banner' : 'success-banner'}>{message.text}</div> : null}
        </section>

        <section className="layout-grid">
          <section className="column">
            <section className="panel card">
              <div className="card-head"><div><h2>创建 Skill</h2><p className="card-desc">先补最小 Skill 创建入口，分类和标签直接读 backend 当前真实数据。</p></div><span className={statusClass(busy.skill || busy.options ? 'in_review' : 'approved')}>{busy.skill ? '创建中' : busy.options ? '加载选项中' : '可提交'}</span></div>
              <form onSubmit={onCreateSkill}>
                <div className="field-grid">
                  <div className="field"><label>skillKey</label><input value={skillDraft.skillKey} onChange={(e) => setSkillDraft((v) => ({ ...v, skillKey: e.target.value }))} placeholder="sample_skill_key" /></div>
                  <div className="field"><label>名称</label><input value={skillDraft.name} onChange={(e) => setSkillDraft((v) => ({ ...v, name: e.target.value }))} placeholder="最小 Skill 名称" /></div>
                  <div className="field"><label>可见性</label><select value={skillDraft.visibilityType} onChange={(e) => setSkillDraft((v) => ({ ...v, visibilityType: e.target.value as VisibilityType }))}><option value="department">department</option><option value="public">public</option><option value="private">private</option></select></div>
                  <div className="field"><label>分类</label><select value={skillDraft.categoryId} onChange={(e) => setSkillDraft((v) => ({ ...v, categoryId: e.target.value }))}><option value="">未选择</option>{options.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                  <div className="field-wide"><label>摘要</label><textarea value={skillDraft.summary} onChange={(e) => setSkillDraft((v) => ({ ...v, summary: e.target.value }))} /></div>
                  <div className="field-wide"><label>描述</label><textarea value={skillDraft.description} onChange={(e) => setSkillDraft((v) => ({ ...v, description: e.target.value }))} /></div>
                </div>
                <div className="section-divider" />
                <div className="card-head"><div><h3>标签</h3><p className="card-desc">可多选；如果后端还没 seed，这里会为空。</p></div></div>
                {options.tags.length === 0 ? <div className="empty-state">当前没有可用标签。</div> : <div className="tag-row">{options.tags.map((tag) => <button key={tag.id} className={`button ${skillDraft.tagIds.includes(tag.id) ? 'subtle' : ''}`} type="button" onClick={() => toggleTag(tag.id)}>{skillDraft.tagIds.includes(tag.id) ? '已选' : '选择'} {tag.name}</button>)}</div>}
                <div className="action-row" style={{ marginTop: 12 }}><button className="button primary" type="submit" disabled={busy.skill}>{busy.skill ? '创建中…' : '创建 Skill'}</button></div>
              </form>
            </section>

            <section className="panel card">
              <div className="card-head"><div><h2>Skill 列表</h2><p className="card-desc">只读列表，支持筛选。</p></div><span className={statusClass(busy.list ? 'in_review' : 'approved')}>{busy.list ? '加载中' : '已同步'}</span></div>
              <div className="toolbar">
                <div className="field-wide"><label>搜索</label><input value={filters.search} onChange={(e) => setFilters((v) => ({ ...v, search: e.target.value }))} placeholder="skill key / 名称 / 摘要" /></div>
                <div className="field"><label>Skill 状态</label><select value={filters.skillStatus} onChange={(e) => setFilters((v) => ({ ...v, skillStatus: e.target.value as Filters['skillStatus'] }))}><option value="all">全部</option><option value="draft">草稿</option><option value="pending_review">待审核</option><option value="approved">已批准</option><option value="published">已发布</option><option value="rejected">已驳回</option><option value="archived">已归档</option></select></div>
                <div className="field"><label>版本审核状态</label><select value={filters.reviewStatus} onChange={(e) => setFilters((v) => ({ ...v, reviewStatus: e.target.value as Filters['reviewStatus'] }))}><option value="all">全部</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option></select></div>
                <div className="action-row"><button className="button subtle" type="button" onClick={() => void refresh()}>应用筛选</button></div>
              </div>
              <div className="section-divider" />
              {skills.length === 0 ? <div className="empty-state">暂无 Skill。若数据库为空，可先运行 `pnpm --filter @prime/backend seed:phase1-samples`。</div> : <div className="list">{skills.map((item) => <button key={item.skillId} type="button" className={`list-item ${item.skillId === selectedSkillId ? 'active' : ''}`} onClick={() => setSelectedSkillId(item.skillId)}><strong>{item.name}</strong><div className="pill-row"><span className={statusClass(item.status)}>{item.status}</span><span className="pill">{item.skillKey}</span><span className="pill">{item.visibilityType}</span></div><p className="muted">{item.summary || '暂无摘要。'}</p><div className="meta-grid"><div className="meta-box"><span>当前版本</span><strong>{item.currentVersion?.version ?? '未创建'}</strong></div><div className="meta-box"><span>更新时间</span><strong>{fmtDate(item.updatedAt)}</strong></div></div></button>)}</div>}
            </section>
          </section>

          <section className="column">
            <section className="panel card">
              <div className="card-head"><div><h2>Skill 详情</h2><p className="card-desc">查看版本、制品与审核历史。</p></div><span className={statusClass(busy.detail ? 'in_review' : detail?.status ?? 'draft')}>{busy.detail ? '读取中' : detail?.status ?? '未选择'}</span></div>
              {!detail ? <div className="empty-state">从左侧选择一个 Skill 后，这里会展示详情。</div> : <>
                <div className="pill-row"><span className="pill">{detail.skillKey}</span><span className={statusClass(detail.status)}>{detail.status}</span><span className="pill">{detail.visibilityType}</span>{detail.categoryName ? <span className="pill">{detail.categoryName}</span> : null}</div>
                <p style={{ fontSize: 22, fontWeight: 700, margin: '16px 0 8px' }}>{detail.name}</p>
                <p className="muted">{detail.summary || detail.description || '暂无详情说明。'}</p>
                <div className="meta-grid">
                  <div className="meta-box"><span>Owner</span><strong>{detail.ownerDisplayName || `用户 ${detail.ownerUserId}`}</strong></div>
                  <div className="meta-box"><span>部门</span><strong>{detail.ownerDepartmentName || '未记录'}</strong></div>
                  <div className="meta-box"><span>版本数</span><strong>{detail.versions.length}</strong></div>
                  <div className="meta-box"><span>更新时间</span><strong>{fmtDate(detail.updatedAt)}</strong></div>
                </div>
                <div className="section-divider" />
                <h3>版本记录</h3>
                <div className="timeline">{detail.versions.length === 0 ? <div className="empty-state">还没有版本。</div> : detail.versions.map((version) => <div key={version.skillVersionId} className="timeline-item"><div className="pill-row"><span className="pill">v{version.version}</span><span className={statusClass(version.reviewStatus)}>{version.reviewStatus}</span><span className="pill">{version.artifact.packageFormat || 'external'}</span><span className="pill">{version.artifact.packageSource}</span></div><p>skillVersionId={version.skillVersionId} · 文件 {version.artifact.fileName || '未记录'} · 大小 {fmtBytes(version.artifact.byteSize)}</p><div className="mini-actions"><button className="button" type="button" onClick={() => setSubmitDraft((v) => ({ ...v, skillVersionId: String(version.skillVersionId) }))}>设为提审版本</button><a href={version.packageUri} target="_blank" rel="noreferrer">打开制品</a></div></div>)}</div>
                <div className="section-divider" />
                <h3>审核历史</h3>
                <div className="timeline">{detail.reviewTasks.length === 0 ? <div className="empty-state">还没有审核记录。</div> : detail.reviewTasks.map((task) => <div key={task.reviewTaskId} className="timeline-item"><div className="pill-row"><span className="pill">任务 {task.reviewTaskId}</span><span className={statusClass(task.taskStatus)}>{task.taskStatus}</span><span className={statusClass(task.reviewStatus)}>{task.reviewStatus}</span></div><p>版本 v{task.version} · 提交人 {task.submitterDisplayName || task.submitterId} · 审核人 {task.reviewerDisplayName || task.reviewerId || '未指派'}</p><p>{task.comment || '无备注。'}</p></div>)}</div>
              </>}
            </section>

            <section className="panel card">
              <div className="card-head"><div><h2>创建版本与提审</h2><p className="card-desc">优先复用 inline artifact，不扩到更多流程。</p></div><span className={statusClass(selectedSkillId ? 'approved' : 'archived')}>{selectedSkillId ? '可提交' : '需先选中 Skill'}</span></div>
              <form onSubmit={onCreateVersion}>
                <div className="field-grid">
                  <div className="field"><label>版本号</label><input value={versionDraft.version} onChange={(e) => setVersionDraft((v) => ({ ...v, version: e.target.value }))} placeholder="1.0.0" /></div>
                  <div className="field"><label>Artifact 格式</label><select value={versionDraft.format} onChange={(e) => setVersionDraft((v) => ({ ...v, format: e.target.value as PackageFormat }))}><option value="zip">zip</option><option value="legacy_json">legacy_json</option></select></div>
                  <div className="field"><label>AI Tools</label><input value={versionDraft.aiTools} onChange={(e) => setVersionDraft((v) => ({ ...v, aiTools: e.target.value }))} placeholder="cursor,opencode" /></div>
                  <div className="field"><label>文件路径</label><input value={versionDraft.entryPath} onChange={(e) => setVersionDraft((v) => ({ ...v, entryPath: e.target.value }))} /></div>
                  <div className="field-wide"><label>README 文本</label><textarea value={versionDraft.readmeText} onChange={(e) => setVersionDraft((v) => ({ ...v, readmeText: e.target.value }))} /></div>
                  <div className="field-wide"><label>变更说明</label><textarea value={versionDraft.changelog} onChange={(e) => setVersionDraft((v) => ({ ...v, changelog: e.target.value }))} /></div>
                  <div className="field-wide"><label>安装模式 JSON</label><textarea value={versionDraft.installMode} onChange={(e) => setVersionDraft((v) => ({ ...v, installMode: e.target.value }))} /></div>
                  <div className="field-wide"><label>Manifest JSON</label><textarea value={versionDraft.manifest} onChange={(e) => setVersionDraft((v) => ({ ...v, manifest: e.target.value }))} /></div>
                  <div className="field-wide"><label>文件内容</label><textarea value={versionDraft.entryContent} onChange={(e) => setVersionDraft((v) => ({ ...v, entryContent: e.target.value }))} /></div>
                </div>
                <div className="action-row" style={{ marginTop: 12 }}><button className="button primary" type="submit" disabled={!selectedSkillId || busy.version}>{busy.version ? '创建中…' : '创建版本'}</button></div>
              </form>
              <div className="section-divider" />
              <form onSubmit={onSubmitReview}>
                <div className="field-grid">
                  <div className="field"><label>skillVersionId</label><input value={submitDraft.skillVersionId} onChange={(e) => setSubmitDraft((v) => ({ ...v, skillVersionId: e.target.value }))} /></div>
                  <div className="field"><label>审核人 ID</label><input value={submitDraft.reviewerId} onChange={(e) => setSubmitDraft((v) => ({ ...v, reviewerId: e.target.value }))} /></div>
                  <div className="field-wide"><label>备注</label><textarea value={submitDraft.comment} onChange={(e) => setSubmitDraft((v) => ({ ...v, comment: e.target.value }))} /></div>
                </div>
                <div className="action-row" style={{ marginTop: 12 }}><button className="button primary" type="submit" disabled={!selectedSkillId || busy.submit}>{busy.submit ? '提交中…' : '提交审核'}</button></div>
              </form>
            </section>
          </section>

          <section className="panel card">
            <div className="card-head"><div><h2>审核队列</h2><p className="card-desc">只展示活动 review task；具备 reviewer/admin 权限时可直接通过。</p></div><span className={statusClass(busy.queue ? 'in_review' : 'pending')}>{busy.queue ? '同步中' : `${queue.length} 条`}</span></div>
            {queue.length === 0 ? <div className="empty-state">当前没有活动中的审核任务。</div> : <div className="queue-list">{queue.map((item) => <article key={item.reviewTaskId} className="queue-card"><div className="pill-row"><span className="pill">{item.skillName}</span><span className={statusClass(item.taskStatus)}>{item.taskStatus}</span><span className={statusClass(item.reviewStatus)}>{item.reviewStatus}</span></div><p>{item.skillKey} · v{item.version} · skillVersionId={item.skillVersionId}</p><p>审核人 {item.reviewerDisplayName || item.reviewerId || '未指派'} · 提交人 {item.submitterDisplayName || item.submitterId}</p><p>artifact: {item.artifact.packageFormat || 'external'} / {item.artifact.packageSource} / {fmtBytes(item.artifact.byteSize)}</p><small className="small">创建于 {fmtDate(item.createdAt)}</small><div className="action-row" style={{ marginTop: 12 }}><button className="button" type="button" onClick={() => setSelectedSkillId(item.skillId)}>查看详情</button><a href={item.artifact.packageUri} target="_blank" rel="noreferrer">打开制品</a><button className="button primary" type="button" disabled={busy.approveId === item.reviewTaskId} onClick={() => void onApprove(item)}>{busy.approveId === item.reviewTaskId ? '通过中…' : '通过审核'}</button></div></article>)}</div>}
            <div className="section-divider" />
            <div className="notice">当前页面仍刻意保持收敛：不补本地安装、不补 Cline/Codex/global，也不尝试绕过 browser preview 限制。</div>
          </section>
        </section>
      </div>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('管理后台根容器不存在');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
