import React from 'react';
import { createRoot } from 'react-dom/client';
import { PublicSite } from './public.js';
import { Admin } from './admin.js';
import './styles.css';
import './motion.css';
import './notifications.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Something didn’t load.</h1>
        <p>Please refresh the page to try again.</p>
        <button onClick={() => location.reload()}>Reload page</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {location.pathname.startsWith('/admin') ? <Admin /> : <PublicSite />}
    </ErrorBoundary>
  </React.StrictMode>,
);
