import './styles.css';

import React, { startTransition, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

import {
  createInstallTicket,
  listMyInstalls,
  listMyToolInstances,
  listMyWorkspaces,
  loadBackendHealth,
  registerClientDevice,
  reportToolInstances,
  reportWorkspaces,
  resolveApiBaseUrl,
  resolveDesktopAuthToken,
  searchMarketplaceSkills,
  type BackendHealth,
  type InstallTicketPayload,
  type MarketplaceSearchResponse,
  type MarketplaceSkill,
  type MyInstall,
  type MyToolInstance,
  type MyWorkspace
} from './api-client';
import { commandNamespace } from './ipc-client';
import {
  applyInstallTicketNative,
  hasTauriRuntime,
  listenInstallProgressNative,
  listToolInstancesNative,
  loadNativeBootstrapStatus,
  previewInstallTargetNative,
  selectWorkspaceNative,
  tauriRuntimeLabel,
  type NativeApplyInstallTicketResult,
  type NativeBootstrapStatus,
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

function formatDateTime(value?: string) {
  if (!value) {
    return 'n/a';
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
        <span className="pill pill--muted">{formatConfidence(skill.confidenceScore)} match</span>
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
          <span> installs</span>
        </div>
        <div>
          <strong>{skill.recommendedInstallMode}</strong>
          <span> scope</span>
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

function InstalledSection({ installs }: { installs: MyInstall[] }) {
  return (
    <section className="results-section" id="installs">
      <div className="results-section__header">
        <div>
          <span className="eyebrow">My installs</span>
          <h2>Installed on this desktop</h2>
        </div>
        <p>Data comes from `GET /api/my/installs`, backed by `local_install_binding` for the current device.</p>
      </div>

      {installs.length === 0 ? (
        <div className="feedback-card">
          <strong>No installed skills yet.</strong>
          <p>Run the install wizard from any supported Cursor or OpenCode skill card to materialize the first local binding.</p>
        </div>
      ) : (
        <div className="installed-grid">
          {installs.map((install) => (
            <article key={install.bindingId} className="installed-card">
              <div className="skill-card__meta">
                <span className="eyebrow">{install.toolName ?? install.toolCode ?? 'tool'}</span>
                <span className="pill pill--good">{install.installStatus}</span>
              </div>
              <h3>{install.skillName}</h3>
              <p className="skill-card__summary">{install.skillKey}</p>
              <div className="installed-card__facts">
                <span>{install.targetScope}</span>
                <span>{install.workspaceName ?? install.workspacePath ?? 'workspace n/a'}</span>
              </div>
              <p className="skill-card__reason">{install.resolvedTargetPath}</p>
              <div className="installed-card__meta">
                <span>v{install.skillVersion}</span>
                <span>{formatDateTime(install.installedAt)}</span>
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
        <span className="eyebrow">Environment</span>
        <h2>Local stack status</h2>
      </div>
      <div className="status-grid">
        <div className="status-card">
          <span className={`pill ${nativeReady ? 'pill--good' : 'pill--warn'}`}>
            {statusLabel(nativeReady, 'Native ready', 'Native fallback')}
          </span>
          <strong>{tauriRuntimeLabel()}</strong>
          <p>{nativeReady ? nativeStatus?.sampleTargetPath : nativeError ?? 'Running in browser preview mode.'}</p>
        </div>
        <div className="status-card">
          <span className={`pill ${backendReady ? 'pill--good' : 'pill--warn'}`}>
            {statusLabel(backendReady, 'Backend ready', 'Backend unreachable')}
          </span>
          <strong>{resolveApiBaseUrl()}</strong>
          <p>{backendReady ? `Service: ${backendHealth?.service}` : backendError ?? 'Waiting for backend health.'}</p>
        </div>
        <div className="status-card">
          <span className={`pill ${runtimeSyncState === 'ready' ? 'pill--good' : 'pill--muted'}`}>
            Runtime sync
          </span>
          <strong>{runtimeSyncState}</strong>
          <p>
            {runtimeSyncError
              ? runtimeSyncError
              : `${toolCount} tools, ${workspaceCount} workspaces, ${installCount} installs are now flowing through backend APIs.`}
          </p>
        </div>
        <div className="status-card">
          <span className="pill pill--muted">Marketplace feed</span>
          <strong>{marketplace ? marketplace.source : 'pending'}</strong>
          <p>
            {marketplace
              ? marketplace.source === 'database'
                ? 'Search is reading live backend catalog data.'
                : 'Search is using the built-in demo catalog because the database is still empty.'
              : 'Fetching marketplace cards from backend.'}
          </p>
        </div>
      </div>
      <div className="status-footer">
        <span>IPC namespace: {commandNamespace()}</span>
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
      throw new Error('Select a verified tool instance and workspace first');
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
      setError('A verified tool instance and workspace are required');
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
      setError(e instanceof Error ? e.message : 'Failed to create install ticket');
    } finally {
      setIsCreatingTicket(false);
    }
  };

  const handleApplyTicket = async () => {
    if (!ticketResult) {
      setError('Create an install ticket first');
      return;
    }
    if (!deviceToken) {
      setError('Device registration is required before applying an install ticket');
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
      setError(e instanceof Error ? e.message : 'Failed to apply install ticket');
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
      setError(e instanceof Error ? e.message : 'Failed to register workspace');
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer__header">
          <h2>{skill.name}</h2>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close details">
            &times;
          </button>
        </header>

        <div className="drawer__content">
          <div className="skill-card__meta">
            <span className="eyebrow">{skill.category}</span>
            <span className="pill pill--muted">{formatConfidence(skill.confidenceScore)} match</span>
          </div>
          <p className="skill-card__summary">{skill.summary}</p>
          <p className="skill-card__reason">{skill.whyMatched}</p>

          <div className="wizard-card">
            <div className="wizard-card__header">
              <div>
                <span className="eyebrow">Project install wizard</span>
                <h3>Verified path only</h3>
              </div>
              <span className="pill pill--good">{targetScope}</span>
            </div>

            <div className="install-form__field">
              <label>Verified tool instance</label>
              <select value={toolInstanceId} onChange={(event) => setToolInstanceId(Number(event.target.value))}>
                {supportedTools.length === 0 ? <option value={0}>No supported verified tools discovered</option> : null}
                {supportedTools.map((item) => (
                  <option key={item.toolInstanceId} value={item.toolInstanceId}>
                    {item.toolName} {item.toolVersion ? `(${item.toolVersion})` : ''} - {item.toolCode}
                  </option>
                ))}
              </select>
            </div>

            <div className="install-form__field">
              <label>Workspace</label>
              <select
                value={workspaceRegistryId}
                onChange={(event) => setWorkspaceRegistryId(Number(event.target.value))}
              >
                {workspaces.length === 0 ? <option value={0}>No workspace registered yet</option> : null}
                {workspaces.map((item) => (
                  <option key={item.workspaceRegistryId} value={item.workspaceRegistryId}>
                    {item.workspaceName ?? item.workspacePath}
                  </option>
                ))}
              </select>
              <button type="button" className="button button--secondary" onClick={handleAddWorkspace}>
                Select workspace via Tauri
              </button>
            </div>

            <div className="wizard-actions">
              <button type="button" className="button button--secondary" onClick={() => void runPreview()} disabled={isPreviewing}>
                {isPreviewing ? 'Previewing...' : 'Preview target'}
              </button>
              <button type="button" className="button button--secondary" onClick={() => void handleCreateTicket()} disabled={isCreatingTicket || supportedTools.length === 0}>
                {isCreatingTicket ? 'Creating...' : 'Create install ticket'}
              </button>
              <button type="button" className="button" onClick={() => void handleApplyTicket()} disabled={isApplying || !ticketResult}>
                {isApplying ? 'Applying...' : 'Apply in native core'}
              </button>
            </div>

            {preview ? (
              <div className="wizard-output">
                <strong>Preview</strong>
                <p>{preview.templateCode}</p>
                <p>{preview.resolvedTargetPath}</p>
              </div>
            ) : null}

            {ticketResult ? (
              <div className="wizard-output">
                <strong>Install ticket</strong>
                <p>{ticketResult.ticketId}</p>
                <p>record #{ticketResult.installRecordId}</p>
                <p>expires {formatDateTime(ticketResult.expiresAt)}</p>
              </div>
            ) : null}

            <div className="wizard-output">
              <strong>Current stage</strong>
              <p>{currentStage}</p>
            </div>

            {applyResult ? (
              <div className="wizard-output wizard-output--success">
                <strong>Final result</strong>
                <p>{applyResult.finalStatus}</p>
                <p>{applyResult.resolvedTargetPath}</p>
                <p>{applyResult.localRegistryPath}</p>
              </div>
            ) : null}

            {error ? (
              <div className="feedback-card feedback-card--error">
                <strong>Install flow failed</strong>
                <p>{error}</p>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="drawer__footer">
          <button type="button" className="button button--secondary" onClick={onClose}>
            Close
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
      setRuntimeSyncError('Tauri runtime unavailable, native install commands are disabled in browser preview.');
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
      setRuntimeSyncError(error instanceof Error ? error.message : 'Unknown runtime sync error');
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
        setNativeError(error instanceof Error ? error.message : 'unknown native error');
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
        setBackendError(error instanceof Error ? error.message : 'unknown backend error');
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
            setMarketplaceError(error instanceof Error ? error.message : 'unknown marketplace error');
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

  const sectionTitle = marketplace?.mode === 'search' && query.trim() ? 'Search results' : 'Recommended skills';
  const sectionDescription =
    marketplace?.source === 'demo_catalog'
      ? 'Live backend request succeeded. The backend is returning a curated demo catalog until the database is populated.'
      : 'Showing the current backend marketplace feed for this desktop client.';

  return (
    <main className="shell">
      <div className="shell__backdrop shell__backdrop--one" />
      <div className="shell__backdrop shell__backdrop--two" />
      <section className="shell__frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">PrimeSkill Pro</p>
            <h1>Agent Marketplace</h1>
          </div>
          <nav className="topnav" aria-label="Primary">
            <a href="#marketplace">Explore</a>
            <a href="#installs">My installs</a>
            <a href="#status">Environment</a>
          </nav>
        </header>

        <section className="hero" id="marketplace">
          <div className="hero__content">
            <span className="pill pill--brand">Project install loop live</span>
            <h2>Search, issue install tickets, apply verified project templates, and read back “my installs”.</h2>
            <p>
              This shell now runs the first real installation chain: desktop UI syncs verified tool instances and
              workspaces, backend signs project-scope install tickets, and native core materializes Cursor or OpenCode
              targets before the backend records the local binding.
            </p>
            <div className="search-panel">
              <label className="search-panel__label" htmlFor="skill-search">
                Search skills
              </label>
              <div className="search-panel__controls">
                <input
                  id="skill-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Try: api, prompt, research, frontend"
                />
                <button type="button" className="button button--secondary" onClick={() => setQuery('')}>
                  Reset
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
              <span className="eyebrow">Current focus</span>
              <strong>Verified project scope only</strong>
              <p>Install apply is intentionally limited to Cursor project rules and OpenCode project skills this round.</p>
            </div>
            <div className="summary-card">
              <span className="eyebrow">Live contracts</span>
              <strong>`/api/my/*` + Tauri install commands</strong>
              <p>The drawer now uses real backend runtime APIs and Tauri commands instead of the previous mock preview.</p>
            </div>
          </div>
        </section>

        <section className="results-section">
          <div className="results-section__header">
            <div>
              <span className="eyebrow">{sectionTitle}</span>
              <h2>{query.trim() ? `Results for "${query.trim()}"` : 'Curated starter skills'}</h2>
            </div>
            <p>{sectionDescription}</p>
          </div>

          {loadingMarketplace ? <LoadingCards /> : null}

          {!loadingMarketplace && marketplaceError ? (
            <div className="feedback-card feedback-card--error">
              <strong>Marketplace request failed</strong>
              <p>{marketplaceError}</p>
              <button type="button" className="button" onClick={() => setReloadNonce((current) => current + 1)}>
                Retry
              </button>
            </div>
          ) : null}

          {!loadingMarketplace && !marketplaceError && marketplace && marketplace.items.length === 0 ? (
            <div className="feedback-card">
              <strong>No skills matched that search.</strong>
              <p>Try a broader keyword like `api`, `research`, or `frontend`, or clear the search to return to recommendations.</p>
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

        <InstalledSection installs={installs} />

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
