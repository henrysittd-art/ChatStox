// ── API keys ──────────────────────────────────────────────────────────────────
// Set these in a .env file or environment variables — never commit real keys.
export const OPENAI_KEY      = process.env.OPENAI_KEY      || 'YOUR_OPENAI_API_KEY_HERE';
export const OPENAI_MODEL    = 'gpt-4o-mini';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1/chat/completions';

// Polygon — used directly by PriceChart for multi-period charting
export const POLYGON_API_KEY = process.env.POLYGON_API_KEY || 'YOUR_POLYGON_API_KEY_HERE';
export const POLYGON_BASE    = 'https://api.polygon.io';
