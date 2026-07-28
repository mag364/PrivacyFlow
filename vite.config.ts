/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Renderer is a standalone Vite app. In a packaged desktop build the same
// renderer is loaded by Electron; here it runs in the browser against the
// localStorage fallback platform.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(process.cwd(), 'src/shared'),
    },
  },
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});