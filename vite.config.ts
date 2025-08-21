import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',  // Usar rutas relativas para Electron
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, 'src/shared/domain'),
      '@application': path.resolve(__dirname, 'src/shared/application'),
      '@infrastructure': path.resolve(__dirname, 'src/shared/infrastructure'),
      '@renderer': path.resolve(__dirname, 'src/renderer')
    }
  }
});
