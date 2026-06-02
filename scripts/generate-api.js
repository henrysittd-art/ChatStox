const fs = require('fs');
const path = require('path');

// Load environment variables from current directory or parent directory fallback
const localEnvPath = path.resolve(process.cwd(), '.env');
const rootEnvPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath, override: true });
} else if (fs.existsSync(rootEnvPath)) {
  require('dotenv').config({ path: rootEnvPath, override: true });
} else {
  require('dotenv').config({ override: true });
}

const polygonKey = process.env.POLYGON_API_KEY || '';
const apiUrl = process.env.API_URL || '';

if (!polygonKey) console.warn('[generate-api] WARNING: POLYGON_API_KEY env var not set');

const content = `import ENV from './env';

export const POLYGON_API_KEY = '${polygonKey}';
export const POLYGON_BASE    = 'https://api.polygon.io';

export const BACKEND_URL = ${apiUrl ? `'${apiUrl}'` : 'ENV.API_URL'};
`;

fs.writeFileSync('src/config/api.js', content);
console.log('[generate-api] src/config/api.js written successfully');
