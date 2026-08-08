import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// web3.js and wallet adapters expect Node globals (Buffer, process) in the browser.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: {
    // Some deps reference process.env at module scope.
    'process.env': {},
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
