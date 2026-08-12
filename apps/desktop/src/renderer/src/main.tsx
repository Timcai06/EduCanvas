import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const view = new URLSearchParams(window.location.search).get('view') === 'chat' ? 'chat' : 'pet';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App view={view} />
  </React.StrictMode>,
);
