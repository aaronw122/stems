import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react';
          }
          if (id.includes('node_modules/@xyflow') || id.includes('node_modules/dagre')) {
            return 'xyflow';
          }
        },
      },
    },
  },
  server: {
    port: 7483,
    proxy: {
      '/api': 'http://localhost:7482',
      '/ws': { target: 'ws://localhost:7482', ws: true },
    },
  },
});
