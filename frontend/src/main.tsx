import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// StrictMode 는 개발 모드에서 effect 를 두 번 실행해 WebSocket/WebGL 이 중복 생성되므로 사용하지 않음
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
