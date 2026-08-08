// Vercel serverless function — proxies Solana JSON-RPC calls to the real
// endpoint. `RPC_URL` is read from process.env WITHOUT a `VITE_` prefix, so
// it is only ever available on the server: it is never bundled into client
// JS, never visible in devtools/network tab as the request target, and
// never appears in the repo (set it in the Vercel project's Environment
// Variables, not in a committed file).
//
// Set this in Vercel: Project Settings -> Environment Variables -> RPC_URL
// e.g. RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPSTREAM = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const DAS_CAPABLE = /helius|das/i.test(UPSTREAM);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Lightweight capability probe the frontend calls once at startup.
  // Reveals only a boolean — never the upstream URL or API key.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ dasCapable: DAS_CAPABLE });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const upstreamRes = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const text = await upstreamRes.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstreamRes.status).send(text);
  } catch (error) {
    console.error('RPC proxy error:', error);
    return res.status(502).json({ error: 'RPC proxy error' });
  }
}
