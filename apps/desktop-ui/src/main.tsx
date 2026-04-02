import { commandNamespace } from './ipc-client';
import { loadNativeBootstrapStatus, tauriRuntimeLabel, type NativeBootstrapStatus } from './tauri-client';

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

function DesktopApp() {
  const [nativeStatus, setNativeStatus] = useState<NativeBootstrapStatus | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);

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

  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        padding: '40px 24px',
        background:
          'radial-gradient(circle at top left, rgba(255,239,213,1) 0%, rgba(224,243,255,1) 45%, rgba(216,227,255,1) 100%)',
        color: '#102a43',
        fontFamily: '"Avenir Next", "PingFang SC", sans-serif'
      }}
    >
      <section
        style={{
          maxWidth: 980,
          margin: '0 auto',
          padding: 28,
          borderRadius: 28,
          background: 'rgba(255,255,255,0.8)',
          boxShadow: '0 24px 64px rgba(16, 42, 67, 0.12)'
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          Desktop Bootstrap
        </p>
        <h1 style={{ margin: '10px 0 12px', fontSize: 'clamp(2rem, 4.5vw, 3.6rem)' }}>PrimeSkill Desktop UI</h1>
        <p style={{ margin: '0 0 20px', maxWidth: 720, fontSize: 18, lineHeight: 1.7 }}>
          这是桌面端最小启动壳。当前已接入前端运行入口，并保留 IPC 命名空间，为后续接 Tauri 宿主和 Native
          Core 命令做准备。
        </p>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 999,
            background: '#d9e2ec',
            color: '#243b53',
            fontSize: 13,
            textTransform: 'uppercase',
            letterSpacing: '0.08em'
          }}
        >
          <span>Runtime</span>
          <strong>{tauriRuntimeLabel()}</strong>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderRadius: 999,
            background: '#102a43',
            color: '#f0f4f8',
            fontSize: 14
          }}
        >
          <span>IPC Namespace</span>
          <code>{commandNamespace()}</code>
        </div>
        <section
          style={{
            marginTop: 22,
            padding: 20,
            borderRadius: 20,
            background: 'rgba(16, 42, 67, 0.06)'
          }}
        >
          <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Native Bootstrap</h2>
          {nativeStatus ? (
            <div style={{ display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
              <div>
                <strong>Namespace:</strong> <code>{nativeStatus.namespace}</code>
              </div>
              <div>
                <strong>Managed Block:</strong> <code>{nativeStatus.managedBlockBegin}</code>
              </div>
              <div>
                <strong>Managed Block End:</strong> <code>{nativeStatus.managedBlockEnd}</code>
              </div>
              <div>
                <strong>Sample Target:</strong> <code>{nativeStatus.sampleTargetPath}</code>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
              {nativeError
                ? `当前未连接 Tauri 宿主，展示 web 预览模式。原因: ${nativeError}`
                : '正在尝试连接 Native Core...'}
            </p>
          )}
        </section>
      </section>
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
