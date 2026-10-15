import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import './console.css';
import { Console } from './Console';

try {
  const th = localStorage.getItem('sutra.theme');
  if (th) document.documentElement.dataset.theme = th;
} catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(<StrictMode><Console /></StrictMode>);
