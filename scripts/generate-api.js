const fs = require('fs');

const openaiKey  = process.env.OPENAI_KEY      || '';
const polygonKey = process.env.POLYGON_API_KEY || '';

if (!openaiKey)  console.warn('[generate-api] WARNING: OPENAI_KEY env var not set');
if (!polygonKey) console.warn('[generate-api] WARNING: POLYGON_API_KEY env var not set');

const content = `export const OPENAI_KEY      = '${openaiKey}';
export const OPENAI_MODEL    = 'gpt-4o-mini';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1/chat/completions';

export const POLYGON_API_KEY = '${polygonKey}';
export const POLYGON_BASE    = 'https://api.polygon.io';
`;

fs.writeFileSync('src/config/api.js', content);
console.log('[generate-api] src/config/api.js written successfully');
