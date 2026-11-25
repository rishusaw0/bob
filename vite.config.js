import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  // Guarantee public/installer builds never bake local .env API keys into dist/
  define: mode === 'public' ? { 'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify('') } : undefined,
  server: {
    port: 5173,
    proxy: {
      '/api/pc': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-genai': ['@google/genai'],
          'vendor-markdown': ['react-markdown', 'highlight.js'],
          'vendor-icons': ['react-icons'],
        },
      },
    },
  },
}));
