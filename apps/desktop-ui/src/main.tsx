import './styles.css';

import React, { startTransition, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

import {
  createInstallTicket,
  getMyInstallDetail,
  listMyInstalls,
  listMyToolInstances,
  listMyWorkspaces,
  loadBackendHealth,
  registerClientDevice,
  reportInstallVerification,
  reportToolInstances,
  reportWorkspaces,
  resolveApiBaseUrl,
  resolveDesktopAuthToken,
  searchMarketplaceSkills,
  type BackendHealth,
  type InstallTicketPayload,
  type MarketplaceSearchResponse,
  type MarketplaceSkill,
  type MyInstallDetail,
  type MyInstall,
  type MyToolInstance,
  type MyWorkspace,
  type ReportInstallVerificationResponse
} from './api-client';
import { commandNamespace } from './ipc-client';
import {
  applyInstallTicketNative,
  getInstallationDetailNative,
  hasTauriRuntime,
  listenInstallProgressNative,
  listToolInstancesNative,
  loadNativeBootstrapStatus,
  previewInstallTargetNative,
  rollbackInstallationNative,
  selectWorkspaceNative,
  tauriRuntimeLabel,
  uninstallInstallationNative,
  verifyInstallationNative,
  type NativeApplyInstallTicketResult,
  type NativeBootstrapStatus,
  type NativeInstallationDetail,
  type NativeInstallationVerification,
  type NativePreviewInstallTarget
} from './tauri-client';

const defaultToolContext = ['cursor', 'opencode'];
const resultPageSize = 6;

function statusLabel(ok: boolean, readyText: string, fallbackText: string) {
  return ok ? readyText : fallbackText;
}

function formatConfidence(score: number) {
  return `${Math.round(score * 100)}%`;
}

function scopeLabel(scope: string) {
  return scope === 'project' ? '项目级' : scope === 'global' ? '全局' : scope;
}

function installStatusLabel(status: string) {
  switch (status) {
    case 'idle':
      return '待开始';
    case 'ticket_issued':
      return '已签发安装票据';
    case 'downloading':
      return '下载中';
    case 'staging':
      return '准备写入';
    case 'verifying':
      return '校验中';
    case 'committing':
      return '提交中';
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'rolled_back':
      return '已回滚';
    case 'drifted':
      return '已漂移';
    case 'verified':
      return '校验通过';
    default:
      return status;
  }
}

function formatDateTime(value?: string) {
  if (!value) {
    return '暂无';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function SkillCard({ skill, onClick }: { skill: MarketplaceSkill; onClick?: (skill: MarketplaceSkill) => void }) {
  return (
    <article className="skill-card" onClick={() => onClick?.(skill)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="skill-card__meta">
        <span className="eyebrow">{skill.category}</span>
        <span className="pill pill--muted">匹配度 {formatConfidence(skill.confidenceScore)}</span>
      </div>
      <h3>{skill.name}</h3>
      <p className="skill-card__summary">{skill.summary}</p>
      <p className="skill-card__reason">{skill.whyMatched}</p>
      <div className="tag-row">
        {skill.tags.map((tag) => (
          <span key={`${skill.skillId}-${tag}`} className="pill pill--ghost">
            {tag}
          </span>
        ))}
      </div>
      <div className="skill-card__footer">
        <div>
          <strong>{skill.installCount}</strong>
          <span> 次安装</span>
        </div>
        <div>
          <strong>{scopeLabel(skill.recommendedInstallMode)}</strong>
          <span> 范围</span>
        </div>
      </div>
      <div className="tool-row">
        {skill.supportedTools.map((tool) => (
          <span key={`${skill.skillVersionId}-${tool}`} className="tool-chip">
            {tool}
          </span>
        ))}
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className="card-grid">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={`loading-${index}`} className="skill-card skill-card--loading">
          <div className="skeleton skeleton--sm" />
          <div className="skeleton skeleton--lg" />
          <div className="skeleton skeleton--md" />
          <div className="skeleton skeleton--md" />
          <div className="skeleton skeleton--chips" />
        </div>
      ))}
    </div>
  );
}

function InstalledSection({
  installs,
  onViewInstall
}: {
  installs: MyInstall[];
  onViewInstall: (install: MyInstall) => void;
}) {
  return (
    <section className="results-section" id="installs">
      <div className="results-section__header">
        <div>
          <span className="eyebrow">我的安装</span>
          <h2>当前桌面已安装</h2>
        </div>
        <p>数据来自当前设备的 `GET /api/my/installs` 与 `local_install_binding`。</p>
      </div>

      {installs.length === 0 ? (
        <div className="feedback-card">
          <strong>还没有已安装 Skill。</strong>
          <p>从支持的 Cursor 或 OpenCode Skill 卡片进入安装向导，即可创建第一条本地安装绑定。</p>
        </div>
      ) : (
        <div className="installed-grid">
          {installs.map((install) => (
            <article key={install.bindingId} className="installed-card">
              <div className="skill-card__meta">
                <span className="eyebrow">{install.toolName ?? install.toolCode ?? '工具'}</span>
                <span className={`pill ${install.state === 'drifted' ? 'pill--warn' : 'pill--good'}`}>
                  {install.state === 'drifted' ? '已漂移' : installStatusLabel(install.installStatus)}
                </span>
              </div>
              <h3>{install.skillName}</h3>
              <p className="skill-card__summary">{install.skillKey}</p>
              <div className="installed-card__facts">
                <span>{scopeLabel(install.targetScope)}</span>
                <span>{install.workspaceName ?? install.workspacePath ?? '暂无工作区'}</span>
              </div>
              <p className="skill-card__reason">{install.resolvedTargetPath}</p>
              <div className="installed-card__meta">
                <span>v{install.skillVersion}</span>
                <span>{formatDateTime(install.installedAt)}</span>
                <span>最近校验 {formatDateTime(install.lastVerifiedAt)}</span>
              </div>
              <div className="wizard-actions">
                <button type="button" className="button button--secondary" onClick={() => onViewInstall(install)}>
                  查看详情
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPanel({
  nativeStatus,
  nativeError,
  backendHealth,
  backendError,
  runtimeSyncState,
  runtimeSyncError,
  toolCount,
  workspaceCount,
  installCount,
  marketplace
}: {
  nativeStatus: NativeBootstrapStatus | null;
  nativeError: string | null;
  backendHealth: BackendHealth | null;
  backendError: string | null;
  runtimeSyncState: 'idle' | 'syncing' | 'ready' | 'fallback' | 'failed';
  runtimeSyncError: string | null;
  toolCount: number;
  workspaceCount: number;
  installCount: number;
  marketplace: MarketplaceSearchResponse | null;
}) {
  const nativeReady = Boolean(nativeStatus);
  const backendReady = Boolean(backendHealth?.ok);

  return (
    <aside className="status-panel">
      <div className="status-panel__header">
        <span className="eyebrow">运行环境</span>
        <h2>本地链路状态</h2>
      </div>
      <div className="status-grid">
        <div className="status-card">
          <span className={`pill ${nativeReady ? 'pill--good' : 'pill--warn'}`}>
            {statusLabel(nativeReady, 'Native 已就绪', 'Native 降级模式')}
          </span>
          <strong>{tauriRuntimeLabel()}</strong>
          <p>{nativeReady ? nativeStatus?.sampleTargetPath : nativeError ?? '当前运行在浏览器预览模式。'}</p>
        </div>
        <div className="status-card">
          <span className={`pill ${backendReady ? 'pill--good' : 'pill--warn'}`}>
            {statusLabel(backendReady, 'Backend 已就绪', 'Backend 不可达')}
          </span>
          <strong>{resolveApiBaseUrl()}</strong>
          <p>{backendReady ? `服务：${backendHealth?.service}` : backendError ?? '等待后端健康检查结果。'}</p>
        </div>
        <div className="status-card">
          <span className={`pill ${runtimeSyncState === 'ready' ? 'pill--good' : 'pill--muted'}`}>
            运行时同步
          </span>
          <strong>{installStatusLabel(runtimeSyncState)}</strong>
          <p>
            {runtimeSyncError
              ? runtimeSyncError
              : `已通过后端 API 同步 ${toolCount} 个工具、${workspaceCount} 个工作区、${installCount} 条安装记录。`}
          </p>
        </div>
        <div className="status-card">
          <span className="pill pill--muted">市场数据源</span>
          <strong>{marketplace ? (marketplace.source === 'database' ? '数据库' : '演示目录') : '等待中'}</strong>
          <p>
            {marketplace
              ? marketplace.source === 'database'
                ? '搜索结果正在读取真实后端目录数据。'
                : '数据库仍为空，当前使用内置演示目录返回搜索结果。'
              : '正在从后端拉取市场卡片数据。'}
          </p>
        </div>
      </div>
      <div className="status-footer">
        <span>IPC 命名空间：{commandNamespace()}</span>
      </div>
    </aside>
  );
}

function SkillDetailDrawer({
  skill,
  deviceToken,
  toolInstances,
  workspaces,
  onRequestWorkspace,
  onInstallCompleted,
  onClose
}: {
  skill: MarketplaceSkill;
  deviceToken: string | null;
  toolInstances: MyToolInstance[];
  workspaces: MyWorkspace[];
  onRequestWorkspace: () => Promise<MyWorkspace | null>;
  onInstallCompleted: () => Promise<void>;
  onClose: () => void;
}) {
  const supportedTools = toolInstances.filter(
    (item) =>
      item.trustStatus === 'verified' &&
      (item.toolCode === 'cursor' || item.toolCode === 'opencode') &&
      skill.supportedTools.includes(item.toolCode)
  );

  const [toolInstanceId, setToolInstanceId] = useState<number>(supportedTools[0]?.toolInstanceId ?? 0);
  const [workspaceRegistryId, setWorkspaceRegistryId] = useState<number>(workspaces[0]?.workspaceRegistryId ?? 0);
  const [targetScope] = useState<'project'>('project');
  const [preview, setPreview] = useState<NativePreviewInstallTarget | null>(null);
  const [ticketResult, setTicketResult] = useState<InstallTicketPayload | null>(null);
  const [applyResult, setApplyResult] = useState<NativeApplyInstallTicketResult | null>(null);
  const [currentStage, setCurrentStage] = useState<string>('idle');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!toolInstanceId && supportedTools[0]) {
      setToolInstanceId(supportedTools[0].toolInstanceId);
    }
  }, [supportedTools, toolInstanceId]);

  useEffect(() => {
    if (!workspaceRegistryId && workspaces[0]) {
      setWorkspaceRegistryId(workspaces[0].workspaceRegistryId);
    }
  }, [workspaceRegistryId, workspaces]);

  const selectedTool = supportedTools.find((item) => item.toolInstanceId === toolInstanceId) ?? supportedTools[0];
  const selectedWorkspace =
    workspaces.find((item) => item.workspaceRegistryId === workspaceRegistryId) ?? workspaces[0] ?? null;

  const runPreview = async () => {
    if (!selectedTool || !selectedWorkspace) {
      throw new Error('请先选择已验证的工具实例和工作区');
    }

    setIsPreviewing(true);
    setError(null);
    try {
      const nextPreview = await previewInstallTargetNative({
        toolCode: selectedTool.toolCode,
        scopeType: targetScope,
        skillKey: skill.name.toLowerCase().replace(/\s+/g, '-'),
        workspacePath: selectedWorkspace.workspacePath
      });
      setPreview(nextPreview);
      return nextPreview;
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!selectedTool || !selectedWorkspace) {
      setError('必须先选择已验证的工具实例和工作区');
      return;
    }

    setIsCreatingTicket(true);
    setError(null);
    setApplyResult(null);

    try {
      if (!preview) {
        await runPreview();
      }

      const result = await createInstallTicket({
        skillId: skill.skillId,
        skillVersionId: skill.skillVersionId,
        operationType: 'install',
        targetScope,
        toolInstanceId: selectedTool.toolInstanceId,
        workspaceRegistryId: selectedWorkspace.workspaceRegistryId,
        idempotencyKey: `idem_${selectedTool.toolCode}_${selectedWorkspace.workspaceRegistryId}_${Date.now()}`
      });
      setTicketResult(result);
      setCurrentStage('ticket_issued');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建安装票据失败');
    } finally {
      setIsCreatingTicket(false);
    }
  };

  const handleApplyTicket = async () => {
    if (!ticketResult) {
      setError('请先创建安装票据');
      return;
    }
    if (!deviceToken) {
      setError('应用安装票据前需要先完成设备注册');
      return;
    }

    setIsApplying(true);
    setError(null);
    setApplyResult(null);

    const unlisten = await listenInstallProgressNative((event) => {
      if (event.ticketId === ticketResult.ticketId) {
        setCurrentStage(event.stage);
      }
    });

    try {
      const result = await applyInstallTicketNative({
        apiBaseUrl: resolveApiBaseUrl(),
        authToken: resolveDesktopAuthToken(),
        deviceToken,
        ticketId: ticketResult.ticketId,
        traceId: `trace_install_${ticketResult.installRecordId}_${Date.now()}`
      });
      setApplyResult(result);
      setCurrentStage(result.finalStatus);
      await onInstallCompleted();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Native Core 应用安装票据失败');
      setCurrentStage('failed');
    } finally {
      unlisten();
      setIsApplying(false);
    }
  };

  const handleAddWorkspace = async () => {
    try {
      const created = await onRequestWorkspace();
      if (created) {
        setWorkspaceRegistryId(created.workspaceRegistryId);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '登记工作区失败');
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer__header">
          <h2>{skill.name}</h2>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭详情">
            &times;
          </button>
        </header>

        <div className="drawer__content">
          <div className="skill-card__meta">
            <span className="eyebrow">{skill.category}</span>
            <span className="pill pill--muted">匹配度 {formatConfidence(skill.confidenceScore)}</span>
          </div>
          <p className="skill-card__summary">{skill.summary}</p>
          <p className="skill-card__reason">{skill.whyMatched}</p>

          <div className="wizard-card">
            <div className="wizard-card__header">
              <div>
                <span className="eyebrow">项目安装向导</span>
                <h3>仅限已验证路径</h3>
              </div>
              <span className="pill pill--good">{scopeLabel(targetScope)}</span>
            </div>

            <div className="install-form__field">
              <label>已验证工具实例</label>
              <select value={toolInstanceId} onChange={(event) => setToolInstanceId(Number(event.target.value))}>
                {supportedTools.length === 0 ? <option value={0}>未发现可用的已验证工具</option> : null}
                {supportedTools.map((item) => (
                  <option key={item.toolInstanceId} value={item.toolInstanceId}>
                    {item.toolName} {item.toolVersion ? `(${item.toolVersion})` : ''} - {item.toolCode}
                  </option>
                ))}
              </select>
            </div>

            <div className="install-form__field">
              <label>工作区</label>
              <select
                value={workspaceRegistryId}
                onChange={(event) => setWorkspaceRegistryId(Number(event.target.value))}
              >
                {workspaces.length === 0 ? <option value={0}>还没有已登记工作区</option> : null}
                {workspaces.map((item) => (
                  <option key={item.workspaceRegistryId} value={item.workspaceRegistryId}>
                    {item.workspaceName ?? item.workspacePath}
                  </option>
                ))}
              </select>
              <button type="button" className="button button--secondary" onClick={handleAddWorkspace}>
                通过 Tauri 选择工作区
              </button>
            </div>

            <div className="wizard-actions">
              <button type="button" className="button button--secondary" onClick={() => void runPreview()} disabled={isPreviewing}>
                {isPreviewing ? '预览中...' : '预览目标路径'}
              </button>
              <button type="button" className="button button--secondary" onClick={() => void handleCreateTicket()} disabled={isCreatingTicket || supportedTools.length === 0}>
                {isCreatingTicket ? '创建中...' : '创建安装票据'}
              </button>
              <button type="button" className="button" onClick={() => void handleApplyTicket()} disabled={isApplying || !ticketResult}>
                {isApplying ? '应用中...' : '在 Native Core 中安装'}
              </button>
            </div>

            {preview ? (
              <div className="wizard-output">
                <strong>目标预览</strong>
                <p>{preview.templateCode}</p>
                <p>{preview.resolvedTargetPath}</p>
              </div>
            ) : null}

            {ticketResult ? (
              <div className="wizard-output">
                <strong>安装票据</strong>
                <p>{ticketResult.ticketId}</p>
                <p>记录 #{ticketResult.installRecordId}</p>
                <p>过期时间 {formatDateTime(ticketResult.expiresAt)}</p>
              </div>
            ) : null}

            <div className="wizard-output">
              <strong>当前阶段</strong>
              <p>{installStatusLabel(currentStage)}</p>
            </div>

            {applyResult ? (
              <div className="wizard-output wizard-output--success">
                <strong>最终结果</strong>
                <p>{installStatusLabel(applyResult.finalStatus)}</p>
                <p>{applyResult.resolvedTargetPath}</p>
                <p>{applyResult.localRegistryPath}</p>
              </div>
            ) : null}

            {error ? (
              <div className="feedback-card feedback-card--error">
                <strong>安装流程失败</strong>
                <p>{error}</p>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="drawer__footer">
          <button type="button" className="button button--secondary" onClick={onClose}>
            关闭
          </button>
        </footer>
      </aside>
    </div>
  );
}

function InstallDetailDrawer({
  install,
  detail,
  localDetail,
  loading,
  loadError,
  deviceToken,
  onInstallChanged,
  onClose
}: {
  install: MyInstall;
  detail: MyInstallDetail | null;
  localDetail: NativeInstallationDetail | null;
  loading: boolean;
  loadError: string | null;
  deviceToken: string | null;
  onInstallChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [ticketResult, setTicketResult] = useState<InstallTicketPayload | null>(null);
  const [applyResult, setApplyResult] = useState<NativeApplyInstallTicketResult | null>(null);
  const [verificationResult, setVerificationResult] = useState<NativeInstallationVerification | null>(null);
  const [verificationReport, setVerificationReport] = useState<ReportInstallVerificationResponse | null>(null);
  const [currentStage, setCurrentStage] = useState<string>('idle');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [activeActionLabel, setActiveActionLabel] = useState<'卸载' | '回滚' | '校验'>('卸载');
  const [error, setError] = useState<string | null>(null);
  const effectiveBindingState = verificationReport?.state ?? detail?.state ?? install.state;
  const effectiveLastVerifiedAt = verificationReport?.lastVerifiedAt ?? detail?.lastVerifiedAt;

  const handleRemoval = async (operationType: 'uninstall' | 'rollback') => {
    if (!detail) {
      setError('安装详情仍在加载中');
      return;
    }
    if (!detail.toolInstanceId) {
      setError(`${operationType === 'rollback' ? '回滚' : '卸载'}前需要已验证的工具实例`);
      return;
    }
    if (!deviceToken) {
      setError(`${operationType === 'rollback' ? '回滚' : '卸载'}前需要先完成设备注册`);
      return;
    }

    const actionLabel = operationType === 'rollback' ? '回滚' : '卸载';
    setActiveActionLabel(actionLabel);
    if (operationType === 'rollback') {
      setIsRollingBack(true);
    } else {
      setIsUninstalling(true);
    }
    setError(null);
    setApplyResult(null);
    setVerificationResult(null);
    setVerificationReport(null);

    try {
      const ticket = await createInstallTicket({
        skillId: detail.skillId,
        skillVersionId: detail.skillVersionId,
        operationType,
        targetScope: detail.targetScope,
        toolInstanceId: detail.toolInstanceId,
        workspaceRegistryId: detail.workspaceRegistryId,
        idempotencyKey: `idem_${operationType}_${detail.installRecordId}_${Date.now()}`
      });
      setTicketResult(ticket);
      setCurrentStage('ticket_issued');

      const unlisten = await listenInstallProgressNative((event) => {
        if (event.ticketId === ticket.ticketId) {
          setCurrentStage(event.stage);
        }
      });

      try {
        const nativeAction =
          operationType === 'rollback' ? rollbackInstallationNative : uninstallInstallationNative;
        const result = await nativeAction({
          apiBaseUrl: resolveApiBaseUrl(),
          authToken: resolveDesktopAuthToken(),
          deviceToken,
          ticketId: ticket.ticketId,
          traceId: `trace_${operationType}_${ticket.installRecordId}_${Date.now()}`
        });
        setApplyResult(result);
        setCurrentStage(result.finalStatus);
        await onInstallChanged();
        onClose();
      } finally {
        unlisten();
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : `${operationType === 'rollback' ? '回滚' : '卸载'}安装失败`
      );
      setCurrentStage('failed');
    } finally {
      if (operationType === 'rollback') {
        setIsRollingBack(false);
      } else {
        setIsUninstalling(false);
      }
    }
  };

  const handleUninstall = async () => handleRemoval('uninstall');
  const handleRollback = async () => handleRemoval('rollback');

  const handleVerify = async () => {
    if (!detail) {
      setError('安装详情仍在加载中');
      return;
    }

    setActiveActionLabel('校验');
    setIsVerifying(true);
    setError(null);
    setTicketResult(null);
    setApplyResult(null);
    setVerificationResult(null);
    setVerificationReport(null);
    setCurrentStage('verifying');

    try {
      const nativeResult = await verifyInstallationNative(detail.installRecordId);
      setVerificationResult(nativeResult);

      const report = await reportInstallVerification(detail.bindingId, {
        verificationStatus: nativeResult.verificationStatus,
        resolvedTargetPath: nativeResult.resolvedTargetPath,
        driftReasons: nativeResult.driftReasons,
        payload: {
          verifiedAt: nativeResult.verifiedAt,
          files: nativeResult.files
        },
        traceId: `trace_verify_${detail.installRecordId}_${Date.now()}`
      });
      setVerificationReport(report);
      setCurrentStage(nativeResult.verificationStatus);
      await onInstallChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '校验安装结果失败');
      setCurrentStage('failed');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer__header">
          <div>
            <h2>{install.skillName}</h2>
            <p className="skill-card__reason">{install.resolvedTargetPath}</p>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭安装详情">
            &times;
          </button>
        </header>

        <div className="drawer__content">
          {loading ? (
            <div className="feedback-card">
              <strong>正在加载安装详情...</strong>
            </div>
          ) : null}

          {loadError ? (
            <div className="feedback-card feedback-card--error">
              <strong>加载详情失败</strong>
              <p>{loadError}</p>
            </div>
          ) : null}

          {detail ? (
            <div className="wizard-card">
              <div className="wizard-card__header">
                <div>
                  <span className="eyebrow">后端详情</span>
                  <h3>{detail.skillKey}</h3>
                </div>
                <span className={`pill ${effectiveBindingState === 'drifted' ? 'pill--warn' : 'pill--good'}`}>
                  {installStatusLabel(effectiveBindingState)}
                </span>
              </div>
              <div className="wizard-output">
                <p>绑定 #{detail.bindingId}</p>
                <p>{detail.toolName ?? detail.toolCode ?? '暂无工具信息'}</p>
                <p>{detail.workspaceName ?? detail.workspacePath ?? '暂无工作区'}</p>
                <p>{detail.operationType === 'rollback' ? '回滚' : detail.operationType === 'uninstall' ? '卸载' : '安装'}</p>
                <p>安装状态 {installStatusLabel(detail.installStatus)}</p>
                <p>{detail.manifest?.templateCode ?? '暂无模板信息'}</p>
                <p>{detail.manifest?.contentManagementMode ?? '暂无内容写入模式'}</p>
                <p>最近校验 {formatDateTime(effectiveLastVerifiedAt)}</p>
              </div>
            </div>
          ) : null}

          {localDetail ? (
            <div className="wizard-card">
              <div className="wizard-card__header">
                <div>
                  <span className="eyebrow">本地注册表</span>
                  <h3>{localDetail.install.fileCount} 个受管文件</h3>
                </div>
                <span className="pill pill--muted">{installStatusLabel(localDetail.install.finalStatus)}</span>
              </div>
              <div className="wizard-output">
                <p>{localDetail.install.targetRootPath}</p>
                <p>{localDetail.install.packageUri}</p>
                <p>{localDetail.install.contentManagementMode}</p>
              </div>
              {localDetail.files.map((file) => (
                <div key={file.filePath} className="wizard-output">
                  <strong>{file.relativePath}</strong>
                  <p>{file.filePath}</p>
                  <p>{file.contentManagementMode}</p>
                  <p>{file.existedBefore ? '卸载或回滚时会恢复原内容' : '该文件由本次安装创建'}</p>
                </div>
              ))}
            </div>
          ) : null}

          {verificationResult ? (
            <div
              className={`wizard-card ${
                verificationResult.verificationStatus === 'verified' ? 'wizard-output--success' : ''
              }`}
            >
              <div className="wizard-card__header">
                <div>
                  <span className="eyebrow">校验结果</span>
                  <h3>{installStatusLabel(verificationResult.verificationStatus)}</h3>
                </div>
                <span
                  className={`pill ${
                    verificationResult.verificationStatus === 'verified' ? 'pill--good' : 'pill--warn'
                  }`}
                >
                  {installStatusLabel(verificationResult.verificationStatus)}
                </span>
              </div>
              <div className="wizard-output">
                <p>{verificationResult.resolvedTargetPath}</p>
                <p>校验时间 {formatDateTime(verificationReport?.lastVerifiedAt ?? verificationResult.verifiedAt)}</p>
                <p>
                  {verificationResult.driftReasons.length > 0
                    ? verificationResult.driftReasons.join(', ')
                    : '全部受管文件均通过本地校验'}
                </p>
              </div>
              {verificationResult.files.map((file) => (
                <div key={file.filePath} className="wizard-output">
                  <strong>{file.relativePath}</strong>
                  <p>{installStatusLabel(file.status)}</p>
                  <p>{file.exists ? file.currentSha256 ?? '哈希不可用' : '磁盘上缺失'}</p>
                  <p>
                    {file.managedBlockPresent === undefined
                      ? file.hashMatches
                        ? '内容哈希与注册表一致'
                        : '内容哈希已漂移'
                      : file.managedBlockPresent
                        ? '受管块标记存在'
                        : '受管块标记缺失'}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {ticketResult ? (
            <div className="wizard-output">
              <strong>{activeActionLabel}票据</strong>
              <p>{ticketResult.ticketId}</p>
              <p>记录 #{ticketResult.installRecordId}</p>
              <p>过期时间 {formatDateTime(ticketResult.expiresAt)}</p>
            </div>
          ) : null}

          <div className="wizard-output">
            <strong>当前阶段</strong>
            <p>{installStatusLabel(currentStage)}</p>
          </div>

          {applyResult ? (
            <div className="wizard-output wizard-output--success">
              <strong>最终结果</strong>
              <p>{installStatusLabel(applyResult.finalStatus)}</p>
              <p>{applyResult.resolvedTargetPath}</p>
            </div>
          ) : null}

          {error ? (
            <div className="feedback-card feedback-card--error">
              <strong>{activeActionLabel}失败</strong>
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        <footer className="drawer__footer">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleVerify()}
            disabled={isVerifying || isUninstalling || isRollingBack || loading || !!loadError}
          >
            {isVerifying ? '校验中...' : '校验'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void handleUninstall()}
            disabled={isVerifying || isUninstalling || isRollingBack || loading || !!loadError}
          >
            {isUninstalling ? '卸载中...' : '卸载'}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleRollback()}
            disabled={isVerifying || isUninstalling || isRollingBack || loading || !!loadError}
          >
            {isRollingBack ? '回滚中...' : '回滚'}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DesktopApp() {
  const [query, setQuery] = useState('');
  const [activeTools, setActiveTools] = useState<string[]>(defaultToolContext);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [marketplace, setMarketplace] = useState<MarketplaceSearchResponse | null>(null);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [loadingMarketplace, setLoadingMarketplace] = useState(true);
  const [nativeStatus, setNativeStatus] = useState<NativeBootstrapStatus | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(null);
  const [selectedInstall, setSelectedInstall] = useState<MyInstall | null>(null);
  const [selectedInstallDetail, setSelectedInstallDetail] = useState<MyInstallDetail | null>(null);
  const [selectedLocalInstallDetail, setSelectedLocalInstallDetail] = useState<NativeInstallationDetail | null>(null);
  const [loadingInstallDetail, setLoadingInstallDetail] = useState(false);
  const [installDetailError, setInstallDetailError] = useState<string | null>(null);
  const [toolInstances, setToolInstances] = useState<MyToolInstance[]>([]);
  const [workspaces, setWorkspaces] = useState<MyWorkspace[]>([]);
  const [installs, setInstalls] = useState<MyInstall[]>([]);
  const [runtimeSyncState, setRuntimeSyncState] = useState<'idle' | 'syncing' | 'ready' | 'fallback' | 'failed'>('idle');
  const [runtimeSyncError, setRuntimeSyncError] = useState<string | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  const refreshRuntimeLists = async () => {
    const [tools, workspacesResponse, installsResponse] = await Promise.all([
      listMyToolInstances(),
      listMyWorkspaces(),
      listMyInstalls()
    ]);

    setToolInstances(tools.items);
    setWorkspaces(workspacesResponse.items);
    setInstalls(installsResponse.items);
  };

  const syncRuntimeData = async () => {
    if (!hasTauriRuntime()) {
      setRuntimeSyncState('fallback');
      setRuntimeSyncError('Tauri 运行时不可用，浏览器预览模式下无法使用本地安装命令。');
      return;
    }

    setRuntimeSyncState('syncing');
    setRuntimeSyncError(null);

    try {
      const discovery = await listToolInstancesNative();
      setDeviceToken(discovery.clientDevice.deviceFingerprint);

      await registerClientDevice({
        deviceFingerprint: discovery.clientDevice.deviceFingerprint,
        deviceName: discovery.clientDevice.deviceName,
        osType: discovery.clientDevice.osType,
        desktopAppVersion: discovery.clientDevice.desktopAppVersion,
        nativeCoreVersion: discovery.clientDevice.nativeCoreVersion
      });

      await reportToolInstances({
        items: discovery.items.map((item) => ({
          toolCode: item.toolCode,
          toolVersion: item.toolVersion,
          osType: item.osType,
          detectedInstallPath: item.detectedInstallPath,
          detectedConfigPath: item.detectedConfigPath,
          discoveredTargets: item.discoveredTargets,
          detectionSource: item.detectionSource as 'auto' | 'manual' | 'imported',
          trustStatus: item.trustStatus as 'detected' | 'verified' | 'disabled'
        }))
      });

      await refreshRuntimeLists();
      setRuntimeSyncState('ready');
    } catch (error: unknown) {
      setRuntimeSyncState('failed');
      setRuntimeSyncError(error instanceof Error ? error.message : '运行时同步失败，错误原因未知');
    }
  };

  const handleWorkspaceRequest = async () => {
    const selection = await selectWorkspaceNative();
    const response = await reportWorkspaces({
      items: [
        {
          workspaceName: selection.workspaceName,
          workspacePath: selection.workspacePath,
          projectFingerprint: selection.projectFingerprint,
          repoRemote: selection.repoRemote,
          repoBranch: selection.repoBranch
        }
      ]
    });

    setWorkspaces((current) => {
      const next = current.filter((item) => item.workspaceRegistryId !== response.items[0].workspaceRegistryId);
      return [response.items[0], ...next];
    });

    return response.items[0] ?? null;
  };

  useEffect(() => {
    let active = true;

    loadNativeBootstrapStatus()
      .then((status) => {
        if (!active) {
          return;
        }
        setNativeStatus(status);
        setNativeError(null);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setNativeStatus(null);
        setNativeError(error instanceof Error ? error.message : 'Native 层返回了未知错误');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    loadBackendHealth()
      .then((status) => {
        if (!active) {
          return;
        }
        setBackendHealth(status);
        setBackendError(null);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setBackendHealth(null);
        setBackendError(error instanceof Error ? error.message : 'Backend 返回了未知错误');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void syncRuntimeData();
  }, []);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoadingMarketplace(true);
      searchMarketplaceSkills({
        query,
        pageSize: resultPageSize,
        toolContext: activeTools
      })
        .then((response) => {
          if (!active) {
            return;
          }
          startTransition(() => {
            setMarketplace(response);
            setMarketplaceError(null);
          });
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          startTransition(() => {
            setMarketplace(null);
            setMarketplaceError(error instanceof Error ? error.message : '市场请求失败，错误原因未知');
          });
        })
        .finally(() => {
          if (!active) {
            return;
          }
          setLoadingMarketplace(false);
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query, activeTools, reloadNonce]);

  useEffect(() => {
    if (!selectedInstall) {
      setSelectedInstallDetail(null);
      setSelectedLocalInstallDetail(null);
      setInstallDetailError(null);
      setLoadingInstallDetail(false);
      return;
    }

    let active = true;
    setLoadingInstallDetail(true);
    setInstallDetailError(null);

    Promise.all([
      getMyInstallDetail(selectedInstall.bindingId),
      hasTauriRuntime() ? getInstallationDetailNative(selectedInstall.installRecordId) : Promise.resolve(null)
    ])
      .then(([detail, localDetail]) => {
        if (!active) {
          return;
        }
        setSelectedInstallDetail(detail);
        setSelectedLocalInstallDetail(localDetail);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setSelectedInstallDetail(null);
        setSelectedLocalInstallDetail(null);
        setInstallDetailError(error instanceof Error ? error.message : '安装详情加载失败，错误原因未知');
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setLoadingInstallDetail(false);
      });

    return () => {
      active = false;
    };
  }, [selectedInstall]);

  const sectionTitle = marketplace?.mode === 'search' && query.trim() ? '搜索结果' : '推荐技能';
  const sectionDescription =
    marketplace?.source === 'demo_catalog'
      ? '后端请求已成功，但在数据库尚未填充前，当前仍返回演示目录结果。'
      : '当前展示的是这个桌面客户端可见的真实市场数据。';

  return (
    <main className="shell">
      <div className="shell__backdrop shell__backdrop--one" />
      <div className="shell__backdrop shell__backdrop--two" />
      <section className="shell__frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">PrimeSkill Pro</p>
            <h1>技能市场</h1>
          </div>
          <nav className="topnav" aria-label="Primary">
            <a href="#marketplace">浏览市场</a>
            <a href="#installs">我的安装</a>
            <a href="#status">运行环境</a>
          </nav>
        </header>

        <section className="hero" id="marketplace">
          <div className="hero__content">
            <span className="pill pill--brand">项目安装主链路已打通</span>
            <h2>搜索 Skill、签发安装票据、应用已验证项目模板，并回读“我的安装”。</h2>
            <p>
              当前桌面端已经跑通第一条真实安装链路：桌面 UI 同步已验证工具实例与工作区，后端签发项目级安装票据，
              Native Core 落盘 Cursor 或 OpenCode 目标文件，最后由后端记录本地安装绑定。
            </p>
            <div className="search-panel">
              <label className="search-panel__label" htmlFor="skill-search">
                搜索技能
              </label>
              <div className="search-panel__controls">
                <input
                  id="skill-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="试试：api、prompt、research、frontend"
                />
                <button type="button" className="button button--secondary" onClick={() => setQuery('')}>
                  重置
                </button>
              </div>
              <div className="filter-row">
                {['cursor', 'opencode', 'cline', 'codex'].map((tool) => {
                  const active = activeTools.includes(tool);
                  return (
                    <button
                      key={tool}
                      type="button"
                      className={`tool-toggle ${active ? 'tool-toggle--active' : ''}`}
                      onClick={() =>
                        setActiveTools((current) =>
                          current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool]
                        )
                      }
                    >
                      {tool}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="hero__summary">
            <div className="summary-card">
              <span className="eyebrow">当前范围</span>
              <strong>仅限已验证的项目级安装</strong>
              <p>本轮默认只开放 Cursor 项目规则与 OpenCode 项目技能的安装应用。</p>
            </div>
            <div className="summary-card">
              <span className="eyebrow">当前合约</span>
              <strong>`/api/my/*` + Tauri install commands</strong>
              <p>当前抽屉已使用真实后端运行时 API 与 Tauri 命令，不再依赖之前的 mock 预览路径。</p>
            </div>
          </div>
        </section>

        <section className="results-section">
          <div className="results-section__header">
            <div>
              <span className="eyebrow">{sectionTitle}</span>
              <h2>{query.trim() ? `"${query.trim()}" 的搜索结果` : '精选起步技能'}</h2>
            </div>
            <p>{sectionDescription}</p>
          </div>

          {loadingMarketplace ? <LoadingCards /> : null}

          {!loadingMarketplace && marketplaceError ? (
            <div className="feedback-card feedback-card--error">
              <strong>市场请求失败</strong>
              <p>{marketplaceError}</p>
              <button type="button" className="button" onClick={() => setReloadNonce((current) => current + 1)}>
                重试
              </button>
            </div>
          ) : null}

          {!loadingMarketplace && !marketplaceError && marketplace && marketplace.items.length === 0 ? (
            <div className="feedback-card">
              <strong>没有匹配到相关 Skill。</strong>
              <p>可以尝试更宽泛的关键词，如 `api`、`research`、`frontend`，或者清空搜索词返回推荐列表。</p>
            </div>
          ) : null}

          {!loadingMarketplace && !marketplaceError && marketplace && marketplace.items.length > 0 ? (
            <div className="card-grid">
              {marketplace.items.map((skill) => (
                <SkillCard key={`${skill.skillId}-${skill.skillVersionId}`} skill={skill} onClick={setSelectedSkill} />
              ))}
            </div>
          ) : null}
        </section>

        <InstalledSection installs={installs} onViewInstall={setSelectedInstall} />

        <section id="status">
          <StatusPanel
            nativeStatus={nativeStatus}
            nativeError={nativeError}
            backendHealth={backendHealth}
            backendError={backendError}
            runtimeSyncState={runtimeSyncState}
            runtimeSyncError={runtimeSyncError}
            toolCount={toolInstances.length}
            workspaceCount={workspaces.length}
            installCount={installs.length}
            marketplace={marketplace}
          />
        </section>
      </section>

      {selectedSkill ? (
        <SkillDetailDrawer
          skill={selectedSkill}
          deviceToken={deviceToken}
          toolInstances={toolInstances}
          workspaces={workspaces}
          onRequestWorkspace={handleWorkspaceRequest}
          onInstallCompleted={refreshRuntimeLists}
          onClose={() => setSelectedSkill(null)}
        />
      ) : null}

      {selectedInstall ? (
        <InstallDetailDrawer
          install={selectedInstall}
          detail={selectedInstallDetail}
          localDetail={selectedLocalInstallDetail}
          loading={loadingInstallDetail}
          loadError={installDetailError}
          deviceToken={deviceToken}
          onInstallChanged={refreshRuntimeLists}
          onClose={() => setSelectedInstall(null)}
        />
      ) : null}
    </main>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Desktop root container not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>
);
