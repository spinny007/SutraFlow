import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';

try {
  const th = localStorage.getItem('sutra.theme');
  if (th) document.documentElement.dataset.theme = th;
} catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
