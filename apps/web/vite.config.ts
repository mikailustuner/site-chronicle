import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  server: { port: 43181, proxy: { '/api': 'http://127.0.0.1:43180' } },
});
