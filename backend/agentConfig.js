'use strict';

/**
 * ChatStox Multi-Agent Configuration
 * Google Agent Development Kit (ADK) and Agent Studio blueprints
 */

const AGENT_CONFIG = {
  platform: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'chat-stox',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    apiVersion: 'v1beta1',
  },

  // ── Supervisor Agent (Orchestrator) ────────────────────────────────────────
  supervisor: {
    name: 'ChatStox Supervisor Agent',
    description: 'Receives customer financial inquiries and routes them to specialized analytical sub-agents.',
    model: 'gemini-3.1-pro',
    systemInstruction: `
      You are the Master Coordinator of ChatStox.
      Your job is to analyze the user's message and delegate it to the appropriate specialized sub-agent:
      - If they ask about stock charts, indicator values (RSI, MACD, Moving Averages), candle patterns, or technical setups -> Delegate to the "Technical Analyst Agent".
      - If they ask about financial health, balance sheets, revenues, earnings, or SEC Edgar filings -> Delegate to the "Fundamental Analyst Agent".
      - If they ask about macro context, market news, headlines, sentiment, or volatility (VIX) -> Delegate to the "News & Sentiment Agent".
      Always respond in the language requested by the user profile.
    `,
  },

  // ── Sub-Agents (Specialists) ────────────────────────────────────────────────
  agents: {
    technicalAnalyst: {
      name: 'Technical Analyst Agent',
      model: 'gemini-3.1-flash',
      description: 'Expert in technical charting, S/R levels, moving averages, and pattern detection.',
      skills: [
        'calculateTechnicalIndicators', // Calculates RSI, MACD, VWAP
        'detectCandlePatterns',        // Processes candle shapes
        'fetchIntradayAggregates'      // Queries Polygon 1-min aggregates
      ],
      systemInstruction: `
        You are the Technical Analyst Agent at ChatStox.
        You compute indicators and analyze historical aggregates.
        Always verify key support/resistance levels.
        Keep your advice objective and educational.
      `
    },

    fundamentalAnalyst: {
      name: 'Fundamental Analyst Agent',
      model: 'gemini-3.1-pro', // Pro model for deep document reasoning
      description: 'Expert in fundamental valuation, SEC filing parsing, and financial statements.',
      skills: [
        'parseSecFilingWithDocumentAI', // Invokes Document AI parser
        'queryQuarterlyFinancials',    // Queries BigQuery financial tables
        'analyzeBalanceSheet'          // Compares metrics quarter-over-quarter
      ],
      systemInstruction: `
        You are the Fundamental Analyst Agent at ChatStox.
        You process financial statements and analyze SEC Edgar filings (10-K, 10-Q).
        Rely heavily on Document AI and BigQuery structured data to avoid hallucinations.
      `
    },

    newsSentiment: {
      name: 'News & Sentiment Agent',
      model: 'gemini-3.1-flash',
      description: 'Expert in financial news analysis, macro news sentiment, and volatility indexing.',
      skills: [
        'fetchLiveMarketNews',       // Fetches Polygon v2/reference/news
        'queryMarketSentimentVibe',  // Gauges social and web volume
        'getVixVolatilityIndex'      // Resolves VIX / UVXY volatility data
      ],
      systemInstruction: `
        You are the News & Sentiment Agent at ChatStox.
        You analyze general and stock-specific market news, detecting bullish/bearish catalysts.
        Evaluate and output general market sentiment vibes clearly.
      `
    }
  }
};

module.exports = { AGENT_CONFIG };
