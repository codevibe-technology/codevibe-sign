import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The page calls /v1/sign/... on its own origin; Vite forwards it to the Sign server, so the
// browser needs no CORS setup. In production, serve the page and the API from one origin too.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': process.env.SIGN_SERVER ?? 'http://localhost:3000' },
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  build: { target: 'es2022' },
});
