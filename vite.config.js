import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  // Never embed environment API keys in the Windows installer.
  define: mode === 'desktop' ? { 'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify('') } : undefined,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
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
