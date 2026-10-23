import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Die API läuft unter demselben Origin (Proxy), damit das httpOnly-Refresh-Cookie (SameSite=Strict) funktioniert.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false } },
  },
});
