import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from './AuthContext';

const LanguageContext = createContext({ lang: 'en', setLang: () => {} });

const translations = {
  en: {
    // Nav buttons
    pipeline: 'Pipeline',
    marketChat: 'Market Chat',
    stockChat: 'Stock Chat',

    // HomeScreen — tabs
    mostActive: 'Most Active',
    trendingNow: 'Trending Now',
    topGainers: 'Top Gainers',
    topLosers: 'Top Losers',

    // HomeScreen — sidebar categories
    catAll: 'All Stocks',
    catTech: 'Tech',
    catBioPharma: 'Bio/Pharma',
    catEnergy: 'Energy',
    catFinance: 'Finance',
    catRetail: 'Retail',
    catMining: 'Mining',
    catCannabis: 'Cannabis',
    catEVAuto: 'EV/Auto',
    catAI: 'AI',

    // HomeScreen — hero search
    heroTitle1: "What's on your mind ",
    heroTitle2: 'today?',
    heroSearchPlaceholder: 'Ask about the market or search a ticker...',

    // HomeScreen — Brief card
    marketBrief: 'Market Brief',
    majorIndices: 'MAJOR INDICES',
    aiInsight: '🧠 AI MARKET INSIGHT',
    readMore: 'Read more...',
    generatingBrief: 'Generating market brief...',

    // HomeScreen — momentum strips
    topMovers: "TODAY'S TOP MOVERS",
    runners: '🔥 Runners',
    volumeBuilding: 'VOLUME BUILDING',
    heatingUp: '🌡️ Heating Up',
    buildingMomentum: 'Building momentum',

    // HomeScreen — watchlist
    watchlist: 'Watchlist',
    addTicker: 'Add ticker...',
    addStocksToTrack: 'Add stocks to track',
    typeTickerToStart: 'Type a ticker above\nto get started',
    wlUpdated: 'Updated',
    wlRefresh: '30s refresh',

    // HomeScreen — table
    loadingMarketData: 'Loading market data...',
    noDataAvailable: 'No data available',
    noSectorStocks: 'stocks in current list',
    stocksOf: 'of',
    stocksLabel: 'stocks',
    updatedLabel: 'Updated',
    loadMore: 'Load more',
    allShown: 'All',
    allShownSuffix: 'stocks shown',

    // Table headers
    thSymbol: 'SYMBOL',
    thName: 'NAME',
    thPrice: 'PRICE',
    thChange: 'CHANGE',
    thChgPct: 'CHG %',
    thVolume: 'VOLUME',

    // GeneralChatScreen
    loadingLiveData: 'Loading live market data...',
    analyzingMarket: 'Analyzing market data...',
    askMarketPlaceholder: 'Ask about the market or type a ticker...',
    previousConversation: 'Previous conversation',

    // GeneralChatScreen — quick actions
    todaysGainers: "Today's Gainers",
    todaysLosers: "Today's Losers",
    marketSentiment: 'Market Sentiment',
    topVolume: 'Top Volume',
    marketOverview: 'Market Overview',

    // StockChatScreen
    loadingStock: 'Loading',
    analyzingAI: 'CHATSTOX AI is analyzing...',
    askStockPlaceholder: 'Ask about',
    askAnythingPlaceholder: 'Ask anything...',
    openAnotherStock: '+ Open another stock',
    previousConversationStock: 'Previous conversation',
    invalidTickerMsg: 'For general market questions, use the main chat. Search for a specific ticker like AAPL, TSLA, NVDA.',

    // StockChatScreen — momentum alert
    momentumAlertText: 'This stock was detected in active momentum. Momentum plays can rise quickly — and fall just as fast.\n\n• Verify your broker allows buying this stock before acting\n• Momentum can reverse in seconds without warning\n• This information is for informational purposes only and reflects real-time market data\n• It does not constitute investment advice or a buy recommendation\n\nProceed with caution and manage your risk.',

    // StockChatScreen — search modal
    openStockChat: 'Open Stock Chat',
    tickerSearchPlaceholder: 'Ticker or company (e.g. Apple, TSLA, NVDA)...',
    cancel: 'Cancel',
    openChat: 'Open Chat',
    generalQuestionsAlert: 'For general market questions, use the Market Chat',

    // StockChatScreen — add prompt modal
    newQuickButton: 'New Quick Button',
    newQuickSubtitle: 'Type your question — it becomes a one-tap button in every stock chat.',
    saveButton: 'Save Button',
    removeButtonTitle: 'Remove button',
    removeButtonConfirm: 'Remove from quick actions?',
    remove: 'Remove',

    // StockChatScreen — quick actions
    analyzeSetup: 'Analyze setup',
    keyLevels: 'Key levels',
    riskReward: 'Risk/reward',
    whatsDriving: "What's driving this?",
    optionsFlow: 'Options flow',
    tradeSetup: 'Trade Setup 🎯',
  },

  es: {
    // Nav buttons
    pipeline: 'Pipeline',
    marketChat: 'Chat del Mercado',
    stockChat: 'Chat de Acciones',

    // HomeScreen — tabs
    mostActive: 'Más Activos',
    trendingNow: 'En Tendencia',
    topGainers: 'Mayores Ganancias',
    topLosers: 'Mayores Pérdidas',

    // HomeScreen — sidebar categories
    catAll: 'Todas',
    catTech: 'Tech',
    catBioPharma: 'Bio/Farma',
    catEnergy: 'Energía',
    catFinance: 'Finanzas',
    catRetail: 'Retail',
    catMining: 'Minería',
    catCannabis: 'Cannabis',
    catEVAuto: 'EV/Auto',
    catAI: 'IA',

    // HomeScreen — hero search
    heroTitle1: '¿Qué tienes en mente ',
    heroTitle2: 'hoy?',
    heroSearchPlaceholder: 'Pregunta sobre el mercado o busca un ticker...',

    // HomeScreen — Brief card
    marketBrief: 'Resumen del Mercado',
    majorIndices: 'ÍNDICES PRINCIPALES',
    aiInsight: '🧠 ANÁLISIS AI DEL MERCADO',
    readMore: 'Leer más...',
    generatingBrief: 'Generando resumen del mercado...',

    // HomeScreen — momentum strips
    topMovers: 'MAYORES MOVIMIENTOS DEL DÍA',
    runners: '🔥 Runners',
    volumeBuilding: 'VOLUMEN EN ALZA',
    heatingUp: '🌡️ Calentando',
    buildingMomentum: 'Volumen en aumento',

    // HomeScreen — watchlist
    watchlist: 'Lista de Seguimiento',
    addTicker: 'Agregar ticker...',
    addStocksToTrack: 'Agrega acciones para seguir',
    typeTickerToStart: 'Escribe un ticker arriba\npara comenzar',
    wlUpdated: 'Actualizado',
    wlRefresh: 'cada 30s',

    // HomeScreen — table
    loadingMarketData: 'Cargando datos del mercado...',
    noDataAvailable: 'No hay datos disponibles',
    noSectorStocks: 'acciones en la lista actual',
    stocksOf: 'de',
    stocksLabel: 'acciones',
    updatedLabel: 'Actualizado',
    loadMore: 'Cargar más',
    allShown: 'Todas las',
    allShownSuffix: 'acciones mostradas',

    // Table headers
    thSymbol: 'SÍMBOLO',
    thName: 'NOMBRE',
    thPrice: 'PRECIO',
    thChange: 'CAMBIO',
    thChgPct: 'CHG %',
    thVolume: 'VOLUMEN',

    // GeneralChatScreen
    loadingLiveData: 'Cargando datos en tiempo real...',
    analyzingMarket: 'Analizando datos del mercado...',
    askMarketPlaceholder: 'Pregunta sobre el mercado o escribe un ticker...',
    previousConversation: 'Conversación anterior',

    // GeneralChatScreen — quick actions
    todaysGainers: 'Mayores Ganancias',
    todaysLosers: 'Mayores Pérdidas',
    marketSentiment: 'Sentimiento del Mercado',
    topVolume: 'Mayor Volumen',
    marketOverview: 'Resumen del Mercado',

    // StockChatScreen
    loadingStock: 'Cargando',
    analyzingAI: 'CHATSTOX AI está analizando...',
    askStockPlaceholder: 'Pregunta sobre',
    askAnythingPlaceholder: 'Pregunta lo que quieras...',
    openAnotherStock: '+ Abrir otra acción',
    previousConversationStock: 'Conversación anterior',
    invalidTickerMsg: 'Para preguntas generales sobre el mercado, usa el chat principal. Busca un ticker específico como AAPL, TSLA, NVDA.',

    // StockChatScreen — momentum alert
    momentumAlertText: 'Esta acción fue detectada en movimiento activo. Los momentum plays pueden subir rápidamente — y caer igual de rápido.\n\n• Verifica que tu broker permita comprar esta acción antes de actuar\n• El momentum puede revertirse en segundos sin previo aviso\n• Esta información es únicamente informativa y refleja datos de mercado en tiempo real\n• No constituye asesoría de inversión ni recomendación de compra\n\nProcede con precaución y gestiona tu riesgo.',

    // StockChatScreen — search modal
    openStockChat: 'Abrir Chat de Acción',
    tickerSearchPlaceholder: 'Ticker o empresa (ej. Apple, TSLA, NVDA)...',
    cancel: 'Cancelar',
    openChat: 'Abrir Chat',
    generalQuestionsAlert: 'Para preguntas generales usa el chat de mercado',

    // StockChatScreen — add prompt modal
    newQuickButton: 'Nuevo Botón Rápido',
    newQuickSubtitle: 'Escribe tu pregunta — se convierte en un botón en cada chat de acción.',
    saveButton: 'Guardar Botón',
    removeButtonTitle: 'Quitar botón',
    removeButtonConfirm: '¿Quitar de acciones rápidas?',
    remove: 'Quitar',

    // StockChatScreen — quick actions
    analyzeSetup: 'Analizar setup',
    keyLevels: 'Niveles clave',
    riskReward: 'Riesgo/beneficio',
    whatsDriving: '¿Qué mueve esto?',
    optionsFlow: 'Flujo de opciones',
    tradeSetup: 'Trade Setup 🎯',
  },
};

export function LanguageProvider({ children }) {
  const { user, profile } = useAuth();
  const [lang, setLangLocal] = useState('en');

  // Sync from loaded profile (covers app-start restore)
  useEffect(() => {
    if (profile?.language) setLangLocal(profile.language);
  }, [profile?.language]);

  const setLang = async (newLang) => {
    setLangLocal(newLang);
    if (user?.id) {
      try {
        // update (not upsert) so we never accidentally create a partial profile
        // row that would have onboarding_complete: false
        await supabase
          .from('profiles')
          .update({ language: newLang })
          .eq('id', user.id);
      } catch (_) { /* non-fatal */ }
    }
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const { lang, setLang } = useContext(LanguageContext);
  const t = (key) => translations[lang]?.[key] ?? translations.en[key] ?? key;
  return { lang, setLang, t };
}
