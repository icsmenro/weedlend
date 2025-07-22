import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      external: [
        'fs',
        'stream',
        'http',
        'child_process',
        'jsdom',
        'http-proxy-agent',
        'agent-base',
        'iconv-lite',
        'whatwg-encoding',
        'html-encoding-sniffer',
      ],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  optimizeDeps: {
    exclude: ['jsdom', 'http-proxy-agent'],
  },
});