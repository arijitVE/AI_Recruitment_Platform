import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Note: React.StrictMode is intentionally omitted here.
// StrictMode double-invokes useEffect in dev to expose impure side effects,
// which doubles every API call and makes backend logs very hard to read.
// Re-enable it if you want to run side-effect audits.
createRoot(document.getElementById('root')!).render(
  <App />
);
