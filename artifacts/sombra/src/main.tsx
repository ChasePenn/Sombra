import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import '../public/css/tokens.css';
import './styles.css';
import './sombra-ui.css';

createRoot(document.getElementById('root')!).render(<App />);
registerServiceWorker();
