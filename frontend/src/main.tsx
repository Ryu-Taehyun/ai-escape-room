import ReactDOM from 'react-dom/client';
import App from './App';
// 테마 글꼴을 프로젝트에 포함 (인터넷이 없는 시연 장소에서도 같은 모습)
import '@fontsource/east-sea-dokdo/400.css'; // 공포: 피 글씨
import '@fontsource/nanum-gothic-coding/400.css'; // 공포: 터미널
import '@fontsource/nanum-gothic-coding/700.css';
import '@fontsource/nanum-pen-script/400.css'; // 공포: 손글씨 메모
import '@fontsource/song-myung/400.css'; // 이집트: 비문
import '@fontsource/gowun-batang/400.css'; // 이집트: 본문
import '@fontsource/gowun-batang/700.css';
import '@fontsource/cinzel/600.css'; // 이집트: 라틴 장식
import '@fontsource/cinzel/800.css';
import './index.css';

// StrictMode 는 개발 모드에서 effect 를 두 번 실행해 WebSocket/WebGL 이 중복 생성되므로 사용하지 않음
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
