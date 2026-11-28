import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'public' ? '/' : './',
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
      input: resolve(__dirname, mode === 'public' ? 'landing.html' : 'index.html'),
    },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](?:react|react-dom)[\\/]/, priority: 30 },
            { name: 'vendor-genai', test: /node_modules[\\/]@google[\\/]genai[\\/]/, priority: 25 },
            { name: 'vendor-markdown', test: /node_modules[\\/](?:react-markdown|highlight\.js)[\\/]/, priority: 20 },
            { name: 'vendor-icons', test: /node_modules[\\/]react-icons[\\/]/, priority: 15 },
          ],
        },
      },
    },
  },
}));
