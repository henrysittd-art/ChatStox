/**
 * test_api_health.js
 * Comprehensive diagnostic check of external API connections (Polygon and Gemini/Vertex).
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load env vars
const localEnvPath = path.resolve(process.cwd(), '.env');
const rootEnvPath = path.resolve(process.cwd(), '../.env');
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: true });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
} else {
  dotenv.config({ override: true });
}

const POLYGON_KEY = process.env.POLYGON_API_KEY || 'YsPT9O6G9E5p52c3QRj7ddHTZjgBSFUM';

console.log('================================================══');
console.log('         API HEALTH & DIAGNOSTIC CHECK            ');
console.log('================================================══');

async function testPolygon() {
  const start = Date.now();
  const ticker = 'AAPL';
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_KEY}`;
  
  console.log(`[Polygon] Testing connectivity for ${ticker} quote...`);
  try {
    const res = await fetch(url);
    const latency = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      const price = data.ticker?.lastTrade?.p ?? data.ticker?.day?.c ?? 0;
      console.log(`  ✅ Connection: Success (HTTP ${res.status})`);
      console.log(`  ✅ Latency:    ${latency}ms`);
      console.log(`  ✅ Data:       ${ticker} last price is $${price}`);
      return { ok: true, latency };
    } else {
      const text = await res.text();
      console.log(`  ❌ Connection: Failed (HTTP ${res.status})`);
      console.log(`  ❌ Detail:     ${text.substring(0, 100)}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err) {
    console.log(`  ❌ Connection: Crash`);
    console.log(`  ❌ Detail:     ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function testLocalAIServer() {
  const start = Date.now();
  console.log('[AI Gateway] Testing connectivity to local chat proxy on port 8080...');
  const url = 'http://localhost:8080/api/chat';
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Respond with exactly: OK' }],
        max_tokens: 5,
        stream: false
      })
    });
    
    const latency = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      console.log(`  ✅ Connection: Success (HTTP ${res.status})`);
      console.log(`  ✅ Latency:    ${latency}ms`);
      console.log(`  ✅ Response:   "${text}"`);
      return { ok: true, latency };
    } else {
      const text = await res.text();
      console.log(`  ❌ Connection: Failed (HTTP ${res.status})`);
      console.log(`  ❌ Detail:     ${text.substring(0, 100)}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err) {
    console.log(`  ❌ Connection: Failed to reach local backend server.`);
    console.log(`  ❌ Detail:     ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function run() {
  const polyResult = await testPolygon();
  console.log('--------------------------------------------------');
  const aiResult = await testLocalAIServer();
  console.log('==================================================');
  console.log('                 SUMMARY REPORT                   ');
  console.log('==================================================');
  console.log(`Polygon API Status:   ${polyResult.ok ? '🟢 HEALTHY' : '🔴 UNHEALTHY'}`);
  console.log(`Local AI Proxy Status: ${aiResult.ok ? '🟢 HEALTHY (Vertex/Studio Active)' : '🔴 UNHEALTHY'}`);
  console.log('==================================================');
}

run();
