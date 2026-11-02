/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev: the SPA talks to the docker-compose gateway on :8080, so there is no CORS and
// subscriptions upgrade through the same proxy as in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/users': { target: 'http://localhost:8080', changeOrigin: true },
      '/chat': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
