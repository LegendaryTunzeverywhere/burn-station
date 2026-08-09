import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Dev-only mirror of api/rpc.ts (the production Vercel serverless proxy), so
// `npm run dev` behaves the same way without needing `vercel dev`. RPC_URL is
// read here via loadEnv() inside this Node config file only — it never
// touches import.meta.env, so it can never end up in client-bundled code.
function rpcProxyPlugin(rpcUrl: string, usingFallback: boolean): Plugin {
  const dasCapable = /helius|das/i.test(rpcUrl);
  if (usingFallback) {
    console.warn(
      '[vite:rpc-proxy] RPC_URL is not set. Falling back to the public Solana RPC ' +
      '(api.mainnet-beta.solana.com), which rate-limits aggressively and WILL cause ' +
      'intermittent "transaction failed" / balance-fetch errors. Set RPC_URL in .env ' +
      '(and in Vercel Project Settings for production).',
    );
  }
  return {
    name: 'burn-station-rpc-proxy',
    configureServer(server) {
      const handler: Connect.NextHandleFunction = async (req: any, res: any) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ dasCapable, usingFallbackRpc: usingFallback }));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          let body = '';
          for await (const chunk of req) body += chunk;
          const upstream = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(text);
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: 'RPC proxy error' }));
        }
      };
      server.middlewares.use('/api/rpc', handler);
    },
  };
}

// web3.js and wallet adapters expect Node globals (Buffer, process) in the browser.
export default defineConfig(({ mode }) => {
  // '' as the 3rd arg loads ALL env vars (not just VITE_-prefixed ones), but
  // only into this Node-side config — RPC_URL still never reaches the client.
  const env = loadEnv(mode, process.cwd(), '');
  const rpcUrl = env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const usingFallback = !env.RPC_URL;

  return {
    plugins: [
      react(),
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
      }),
      rpcProxyPlugin(rpcUrl, usingFallback),
    ],
    define: {
      // Some deps reference process.env at module scope.
      'process.env': {},
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1500,
    },
  };
});
