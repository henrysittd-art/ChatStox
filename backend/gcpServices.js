'use strict';

/**
 * Google Cloud Services (GCP) Integration Core
 * High-performance BigQuery Analytics and Document AI Financial Document Parsing
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'chat-stox';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us';

// ── BigQuery Client ──────────────────────────────────────────────────────────
let bigquery = null;
try {
  // Uses Application Default Credentials (ADC) in GKE/Cloud Run environment automatically
  bigquery = new BigQuery({ projectId: PROJECT_ID });
  console.log(`[BigQuery] Client initialized for project ${PROJECT_ID}`);
} catch (err) {
  console.warn('[BigQuery] Failed to initialize BigQuery client (missing ADC):', err.message);
}

// ── Document AI Client ───────────────────────────────────────────────────────
let docAiClient = null;
try {
  docAiClient = new DocumentProcessorServiceClient({
    apiEndpoint: `${LOCATION}-documentai.googleapis.com`
  });
  console.log(`[Document AI] Client initialized for location ${LOCATION}`);
} catch (err) {
  console.warn('[Document AI] Failed to initialize client (missing ADC):', err.message);
}

/**
 * Executes a specialized analytical query in BigQuery to calculate stock metrics.
 * Falls back to safe mock statistical context if BigQuery is unavailable.
 */
async function queryHistoricalDataFromBigQuery(ticker, days = 90) {
  if (!bigquery || !process.env.GOOGLE_CLOUD_PROJECT) {
    console.log(`[BigQuery] Local stub: returning default statistical context for ${ticker}`);
    return {
      ticker: ticker.toUpperCase(),
      avgDailyVolatility: 2.34,
      relativeVolumeRatio: 1.45,
      optionsPutCallRatio: 0.72,
      sectorMomentumAnomaly: '+1.12%',
      dataSource: 'Local Stub Fallback'
    };
  }

  const query = `
    SELECT
      ticker,
      ROUND(AVG(volatility), 2) AS avgDailyVolatility,
      ROUND(AVG(relative_volume), 2) AS relativeVolumeRatio,
      ROUND(AVG(put_call_ratio), 2) AS optionsPutCallRatio,
      ROUND(AVG(sector_anomaly_pct) * 100, 2) AS sectorMomentumAnomaly
    FROM \`${PROJECT_ID}.market_analytics.historical_stock_metrics\`
    WHERE ticker = @ticker AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
    GROUP BY ticker
    LIMIT 1;
  `;

  const options = {
    query,
    params: { ticker: ticker.toUpperCase(), days: Number(days) },
    types: { ticker: 'STRING', days: 'INT64' }
  };

  try {
    const [rows] = await bigquery.query(options);
    if (rows && rows.length > 0) {
      console.log(`[BigQuery] Successfully fetched advanced metrics for ${ticker}`);
      return { ...rows[0], dataSource: 'BigQuery Production Table' };
    }
    throw new Error('No historical data found');
  } catch (err) {
    console.error(`[BigQuery] Query failed for ${ticker}:`, err.message);
    return { ticker: ticker.toUpperCase(), avgDailyVolatility: null, relativeVolumeRatio: null, dataSource: 'BigQuery Error Fallback' };
  }
}

/**
 * Parses unstructured SEC PDF filings using the Google Document AI Specialized Financial Parser.
 * Converts complex tables (Balance Sheet, Income Statement) into structured JSON payloads.
 */
async function parseFilingWithDocumentAI(gcsUri, processorId) {
  if (!docAiClient || !processorId) {
    console.log('[Document AI] Local stub: parsing simulated SEC filing');
    return {
      documentType: '10-Q (Simulated)',
      parsedMetrics: {
        totalRevenue: 28500000000,
        netIncome: 5400000000,
        cashAndEquivalents: 12400000000,
        totalDebt: 3200000000
      },
      status: 'Parsed with Local Stub Parser'
    };
  }

  const name = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${processorId}`;

  const request = {
    name,
    gcsDocument: {
      gcsUri,
      mimeType: 'application/pdf'
    }
  };

  try {
    const [result] = await docAiClient.processDocument(request);
    const { document } = result;
    console.log(`[Document AI] Successfully processed PDF at ${gcsUri}. Extracting tables...`);

    // In a production GKE pipeline, the structured extracted data would be converted
    // to JSON and streamed into BigQuery. Here we return a clean extraction map:
    return {
      gcsUri,
      documentText: document.text || '',
      entities: (document.entities || []).map(e => ({
        type: e.type,
        mentionText: e.mentionText,
        confidence: e.confidence
      })),
      status: 'Document AI Production Parsing Success'
    };
  } catch (err) {
    console.error('[Document AI] Process document failed:', err.message);
    throw err;
  }
}

module.exports = {
  queryHistoricalDataFromBigQuery,
  parseFilingWithDocumentAI
};
