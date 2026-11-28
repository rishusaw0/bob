import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected UI error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#09090b', color: '#f4f4f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 460, background: '#111114', border: '1px solid #27272a', borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>JEEVA AI Recovery</h2>
            <p style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ background: '#10b981', color: '#09090b', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
