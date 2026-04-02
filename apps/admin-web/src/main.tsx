import React from 'react';
import ReactDOM from 'react-dom/client';

function AdminApp() {
  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        padding: '48px 24px',
        background:
          'linear-gradient(135deg, rgba(244,232,214,1) 0%, rgba(226,239,232,1) 45%, rgba(206,224,241,1) 100%)',
        color: '#1f2937',
        fontFamily: '"Avenir Next", "PingFang SC", sans-serif'
      }}
    >
      <section
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: 32,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.78)',
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.12)'
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          PrimeSkill Pro
        </p>
        <h1 style={{ margin: '12px 0 16px', fontSize: 'clamp(2rem, 5vw, 4rem)' }}>Admin Portal</h1>
        <p style={{ maxWidth: 640, fontSize: 18, lineHeight: 1.7 }}>
          管理后台启动骨架已就位。下一步会在这里接入模板治理、审核流、观测看板和权限化操作台。
        </p>
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Admin root container not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
