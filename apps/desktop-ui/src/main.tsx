import './styles.css';

import {
  loadBackendHealth,
  resolveApiBaseUrl,
  resolveDesktopAuthToken,
  searchMarketplaceSkills,
  createInstallTicket,
  type CreateInstallTicketInput,
  type InstallTicketPayload,
  type BackendHealth,
  type MarketplaceSearchResponse,
  type MarketplaceSkill
} from './api-client';
import { commandNamespace } from './ipc-client';
import { loadNativeBootstrapStatus, tauriRuntimeLabel, type NativeBootstrapStatus } from './tauri-client';

import React, { startTransition, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

const defaultToolContext = ['cursor', 'codex'];
const resultPageSize = 6;

function statusLabel(ok: boolean, readyText: string, fallbackText: string) {
  return ok ? readyText : fallbackText;
}

function formatConfidence(score: number) {
  return `${Math.round(score * 100)}%`;
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

function StatusPanel({
  nativeStatus,
  nativeError,
  backendHealth,
  backendError,
  marketplace
}: {
  nativeStatus: NativeBootstrapStatus | null;
  nativeError: string | null;
  backendHealth: BackendHealth | null;
  backendError: string | null;
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
        <div className="status-card">
          <span className="pill pill--muted">Desktop auth</span>
          <strong>Bearer dev token</strong>
          <p>{resolveDesktopAuthToken().slice(0, 18)}...</p>
        </div>
      </div>
      <div className="status-footer">
        <span>IPC namespace: {commandNamespace()}</span>
      </div>
    </aside>
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

function SkillDetailDrawer({
  skill,
  onClose
}: {
  skill: MarketplaceSkill;
  onClose: () => void;
}) {
  const [targetScope, setTargetScope] = useState<'global' | 'project'>(skill.recommendedInstallMode);
  const [toolInstanceId, setToolInstanceId] = useState<number>(-1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ticketResult, setTicketResult] = useState<InstallTicketPayload | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleInstallPreview = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setTicketResult(null);

    const input: CreateInstallTicketInput = {
      skillId: skill.skillId,
      skillVersionId: skill.skillVersionId,
      operationType: 'install',
      targetScope,
      toolInstanceId,
      idempotencyKey: `idem_${Date.now()}_${Math.random()}`
    };

    if (targetScope === 'project') {
      input.workspaceRegistryId = -1; // Mock value for demo
    }

    try {
      const result = await createInstallTicket(input);
      setTicketResult(result);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Unknown error creating ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
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
          <div className="skill-card__reason">
            <strong>Match specific:</strong><br/>
            {skill.whyMatched}
          </div>

          <div className="tag-row">
            {skill.tags.map((tag) => (
              <span key={`drawer-${skill.skillId}-${tag}`} className="pill pill--ghost">
                {tag}
              </span>
            ))}
          </div>

          <div className="tool-row" style={{ marginTop: 8 }}>
            {skill.supportedTools.map((tool) => (
              <span key={`drawer-${skill.skillVersionId}-${tool}`} className="tool-chip">
                {tool}
              </span>
            ))}
          </div>
          
          <div className="install-form">
            <h3>准备安装 / Install Preview</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
              Configure your installation target to request an install ticket.
            </p>

            <div className="install-form__field">
              <label>Target Scope</label>
              <select value={targetScope} onChange={(e) => setTargetScope(e.target.value as 'global' | 'project')}>
                <option value="project">Project (Workspace specific)</option>
                <option value="global">Global (System wide)</option>
              </select>
            </div>

            <div className="install-form__field">
              <label>Target Tool Environment</label>
              <select value={toolInstanceId} onChange={(e) => setToolInstanceId(Number(e.target.value))}>
                <option value={-1}>Demo Mock Cursor Instance (-1)</option>
                <option value={-2}>Demo Mock VSCode Instance (-2)</option>
              </select>
            </div>

            {submitError && (
              <div className="feedback-card feedback-card--error" style={{ marginTop: 8 }}>
                <strong>Failed to create ticket</strong>
                <p>{submitError}</p>
              </div>
            )}

            {ticketResult && (
              <div className="ticket-result">
                <strong>Ticket Created Successfully!</strong>
                <p>Ticket ID: <code>{ticketResult.ticketId}</code></p>
                <p>Record ID: <code>{ticketResult.installRecordId}</code></p>
                <p>Consume Mode: <code>{ticketResult.consumeMode}</code></p>
                <p>Expires At: <code>{ticketResult.expiresAt}</code></p>
              </div>
            )}
          </div>
        </div>

        <footer className="drawer__footer">
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="button button--secondary" onClick={onClose}>
              Close
            </button>
            <button 
              type="button" 
              className="button" 
              onClick={handleInstallPreview}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Requesting...' : 'Request Install Ticket'}
            </button>
          </div>
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
            <a href="#status">Environment</a>
            <a href="#next">Install flow next</a>
          </nav>
        </header>

        <section className="hero" id="marketplace">
          <div className="hero__content">
            <span className="pill pill--brand">Desktop first marketplace</span>
            <h2>Search, preview, and stage internal agent skills from one desktop surface.</h2>
            <p>
              The shell is now a real marketplace landing page: it requests backend search data, adapts to empty catalogs,
              and keeps native and backend diagnostics visible without taking over the product UI.
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
                {['cursor', 'codex', 'cline', 'opencode'].map((tool) => {
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
              <strong>Desktop marketplace first</strong>
              <p>Install flow is intentionally deferred. This round is about discoverability, confidence, and demoability.</p>
            </div>
            <div className="summary-card">
              <span className="eyebrow">Live contract</span>
              <strong>`/api/desktop/search/skills`</strong>
              <p>The homepage uses the same backend search route for both featured recommendations and typed search.</p>
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
                <SkillCard 
                  key={`${skill.skillId}-${skill.skillVersionId}`} 
                  skill={skill} 
                  onClick={setSelectedSkill}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section id="status">
          <StatusPanel
            nativeStatus={nativeStatus}
            nativeError={nativeError}
            backendHealth={backendHealth}
            backendError={backendError}
            marketplace={marketplace}
          />
        </section>

        <section className="next-section" id="next">
          <div className="feedback-card">
            <strong>Next build slice</strong>
            <p>
              The next natural step is wiring card actions into install preview, workspace selection, and ticket creation
              using the existing backend install APIs and Tauri native commands.
            </p>
          </div>
        </section>
      </section>

      {selectedSkill && (
        <SkillDetailDrawer 
          skill={selectedSkill} 
          onClose={() => setSelectedSkill(null)} 
        />
      )}
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
