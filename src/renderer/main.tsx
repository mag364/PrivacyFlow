import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { useTheme } from './store/theme';
import './styles/index.css';

// Apply persisted appearance before first paint to avoid a theme flash.
useTheme.getState().apply();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);