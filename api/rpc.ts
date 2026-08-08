// Vercel serverless function — proxies Solana JSON-RPC calls to the real
// endpoint. `RPC_URL` is read from process.env WITHOUT a `VITE_` prefix, so
// it is only ever available on the server: it is never bundled into client
// JS, never visible in devtools/network tab as the request target, and
// never appears in the repo (set it in the Vercel project's Environment
// Variables, not in a committed file).
//
// Set this in Vercel: Project Settings -> Environment Variables -> RPC_URL
// e.g. RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

export const config = { runtime: 'nodejs' };

const UPSTREAM = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const DAS_CAPABLE = /helius|das/i.test(UPSTREAM);

export default async function handler(req: any, res: any) {
  // Lightweight capability probe the frontend calls once at startup.
  // Reveals only a boolean — never the upstream URL or API key.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ dasCapable: DAS_CAPABLE });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const upstreamRes = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const text = await upstreamRes.text();
    res.status(upstreamRes.status).setHeader('Content-Type', 'application/json').send(text);
  } catch {
    res.status(502).json({ error: 'RPC proxy error' });
  }
}
