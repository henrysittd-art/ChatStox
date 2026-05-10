import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TABS_KEY = 'open_tabs';
const MAX_TABS = 12;

const TabContext = createContext(null);

// ── Smart tab name for general chat ───────────────────────────────────────────

export function generateTabName(question) {
  const q = question.toLowerCase();
  // Specific patterns first to avoid false matches with overlapping keywords
  if (/penny|micro cap/.test(q))                            return 'Penny';
  if (/sector|industry|sectores/.test(q))                   return 'Sectors';
  if (/top pick|recomiend|compra|buy|suggest|mejores/.test(q)) return 'Top Picks';
  if (/gainer|ganador|top gain|mas subido|subiend/.test(q)) return 'Top Gainers';
  if (/loser|perdedor|baja|top los|mas perdid/.test(q))     return 'Top Losers';
  if (/tech|tecnolog|softw|semiconductor/.test(q))          return 'Tech Picks';
  if (/setup|trade setup|entrada/.test(q))                  return 'Trade Setup';
  if (/crypto|bitcoin|btc|eth/.test(q))                     return 'Crypto';
  if (/earning|resultado|revenue/.test(q))                  return 'Earnings';
  if (/overview|resumen|summary|brief/.test(q))             return 'Overview';
  if (/volatil|vix/.test(q))                                return 'Volatility';
  if (/hot|caliente|momentum|trend/.test(q))                return 'Hot Now';
  // Fallback: first 3 words, max 12 chars
  const words = question.trim().split(/\s+/).slice(0, 3).join(' ');
  return words.length > 12 ? words.slice(0, 12) : words;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function TabProvider({ children }) {
  const [tabs, setTabs] = useState([]);
  const [tabsLoaded, setTabsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TABS_KEY)
      .then(raw => { if (raw) setTabs(JSON.parse(raw)); })
      .catch(() => {})
      .finally(() => setTabsLoaded(true));
  }, []);

  const persist = (newTabs) => {
    AsyncStorage.setItem(TABS_KEY, JSON.stringify(newTabs)).catch(() => {});
  };

  // Add/update a STOCK tab. tabName is frozen = ticker, never changes on update.
  const addTab = useCallback((stock) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.ticker === stock.ticker);
      if (idx >= 0) {
        // Existing tab: only update live price fields, never tabName/name
        const updated = prev.map((t, i) =>
          i === idx
            ? { ...t, price: stock.price || 0, changePercent: stock.changePercent || 0 }
            : t
        );
        persist(updated);
        return updated;
      }
      const entry = {
        type: 'stock',
        id: stock.ticker,
        ticker: stock.ticker,
        tabName: stock.ticker,          // frozen forever
        name: stock.name || stock.ticker,
        price: stock.price || 0,
        changePercent: stock.changePercent || 0,
      };
      const updated = [...prev, entry].slice(-MAX_TABS);
      persist(updated);
      return updated;
    });
  }, []);

  // Add a GENERAL chat tab. Returns the new tab id.
  const addGeneralTab = useCallback((question) => {
    const id = `general_${Date.now()}`;
    const tabName = generateTabName(question);
    const entry = { type: 'general', id, tabName, question };
    setTabs(prev => {
      const updated = [...prev, entry].slice(-MAX_TABS);
      persist(updated);
      return updated;
    });
    return id;
  }, []);

  // Close any tab by id (stock tabs use ticker as id)
  const closeTab = useCallback((id) => {
    setTabs(prev => {
      const updated = prev.filter(t => (t.id ?? t.ticker) !== id);
      persist(updated);
      return updated;
    });
  }, []);

  // Update live data for a stock tab. tabName is always protected.
  const updateTab = useCallback((ticker, data) => {
    setTabs(prev => {
      const updated = prev.map(t =>
        t.ticker === ticker
          ? { ...t, price: data.price ?? t.price, changePercent: data.changePercent ?? t.changePercent }
          : t
      );
      persist(updated);
      return updated;
    });
  }, []);

  return (
    <TabContext.Provider value={{ tabs, tabsLoaded, addTab, addGeneralTab, closeTab, updateTab }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error('useTabs must be used within TabProvider');
  return ctx;
}
