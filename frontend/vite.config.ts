import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 /api, /ws 요청을 FastAPI(8000)로 프록시
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js 를 별도 묶음으로 분리 → 게임 코드가 바뀌어도 브라우저 캐시 재사용
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
});
