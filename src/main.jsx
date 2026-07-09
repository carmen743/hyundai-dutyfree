import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import PreviewShell from './PreviewShell.jsx';
import './index.css';

const isWidgetRoute = window.HDDFS_FORCE_WIDGET || window.location.pathname.startsWith('/widget');
const RootComponent = isWidgetRoute ? App : PreviewShell;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RootComponent />
    </ErrorBoundary>
  </React.StrictMode>
);
