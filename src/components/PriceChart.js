import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar,
} from 'recharts';
const BACKEND = 'http://localhost:3001';

const PERIODS = ['1D', '5D', '1M', '6M', 'YTD', '1Y'];

// ── Date helpers ──────────────────────────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function daysAgo(n) {
  return toDateStr(new Date(Date.now() - n * 86400000));
}

function getRange(period) {
  const today = toDateStr(new Date());
  switch (period) {
    case '1D':  return { multiplier: 1, timespan: 'minute', from: today,        to: today, limit: 390 };
    case '5D':  return { multiplier: 1, timespan: 'hour',   from: daysAgo(5),   to: today, limit: 200 };
    case '1M':  return { multiplier: 1, timespan: 'day',    from: daysAgo(30),  to: today, limit: 31  };
    case '6M':  return { multiplier: 1, timespan: 'day',    from: daysAgo(180), to: today, limit: 180 };
    case 'YTD': return { multiplier: 1, timespan: 'day',    from: `${new Date().getFullYear()}-01-01`, to: today, limit: 365 };
    case '1Y':  return { multiplier: 1, timespan: 'day',    from: daysAgo(365), to: today, limit: 365 };
    default:    return { multiplier: 1, timespan: 'minute', from: today,        to: today, limit: 390 };
  }
}

// ── Backend proxy fetch ───────────────────────────────────────────────────────

async function fetchBars(ticker, period, multiplier, timespan, from, to, limit) {
  // 1D: backend /api/chart handles the fallback-date logic internally
  const url = period === '1D'
    ? `${BACKEND}/api/chart/${encodeURIComponent(ticker)}`
    : `${BACKEND}/api/bars/${encodeURIComponent(ticker)}?multiplier=${multiplier}&timespan=${timespan}&from=${from}&to=${to}&limit=${limit}`;
  console.log(`[PriceChart] → ${url}`);
  const res = await fetch(url);
  console.log(`[PriceChart] ← status ${res.status} for ${ticker} ${period} ${from}→${to}`);
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  const json = await res.json();
  const count = (json.results || []).length;
  console.log(`[PriceChart] ${count} bars returned`);
  return json.results || [];
}

// ── Data mapping ──────────────────────────────────────────────────────────────

function fmt1DTime(ts) {
  const d = new Date(ts);
  // Convert to ET wall-clock hour/minute via UTC offset (-4 or -5)
  const etOffset = -5; // EST; Polygon timestamps are UTC
  const utcH = d.getUTCHours();
  const utcM = d.getUTCMinutes();
  // Determine ET offset: EDT = UTC-4 (Mar–Nov), EST = UTC-5
  const month = d.getUTCMonth(); // 0-based
  const isDST = month >= 2 && month <= 10; // rough Mar–Nov
  const etH = (utcH + (isDST ? -4 : -5) + 24) % 24;
  const mm = String(utcM).padStart(2, '0');
  return `${etH}:${mm}`; // "9:30", "13:45", "16:00"
}

function mapBars(bars, period) {
  return bars.map(bar => ({
    t:      bar.t,
    price:  bar.c,
    volume: bar.v,
    time:   period === '1D'
      ? fmt1DTime(bar.t)
      : new Date(bar.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <View style={styles.tooltip}>
      <Text style={styles.tooltipPrice}>${Number(d.price).toFixed(2)}</Text>
      <Text style={styles.tooltipTime}>{d.time}</Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PriceChart({ ticker, previousClose }) {
  const [period,     setPeriod]     = useState('1D');
  const [data,       setData]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [errMsg,     setErrMsg]     = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded,   setExpanded]   = useState(true);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setData([]);
      setErrMsg(null);
      setUnavailable(false);
      try {
        const { multiplier, timespan, from, to, limit } = getRange(period);
        const bars = await fetchBars(ticker, period, multiplier, timespan, from, to, limit);
        if (!cancelled) setData(mapBars(bars, period));
      } catch (e) {
        console.error('[PriceChart] error:', e.message);
        if (!cancelled) {
          if (e.message?.includes('403')) setUnavailable(true);
          else setErrMsg(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [ticker, period]);

  // ── Derived chart values ───────────────────────────────────────────────────

  const prices  = data.map(d => d.price);
  const isUp    = prices.length > 1 ? prices[prices.length - 1] >= prices[0] : true;
  const lineClr = isUp ? '#22c55e' : '#ef4444';
  const volClr  = isUp ? '#bbf7d0' : '#fecaca';
  const prevC   = Number(previousClose) || 0;

  const minP   = prices.length ? Math.min(...prices) : 0;
  const maxP   = prices.length ? Math.max(...prices) : 1;
  const pad    = ((maxP - minP) * 0.08) || 0.5;
  const domMin = prevC > 0 ? Math.min(minP - pad, prevC * 0.995) : minP - pad;
  const domMax = maxP + pad;

  const xInterval = data.length <= 8 ? 0 : Math.floor(data.length / 5);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.wrapper}>

      {/* Control row: period buttons + collapse toggle */}
      <View style={styles.controlRow}>
        <View style={styles.periodRow}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.periodTxt, period === p && styles.periodTxtActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => setExpanded(e => !e)} style={styles.chevronBtn} activeOpacity={0.7}>
          <Text style={styles.chevronTxt}>{expanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </View>

      {/* Collapsible chart body */}
      {expanded && !unavailable && (
        loading ? (
          <View style={styles.placeholder}>
            <ActivityIndicator size="small" color="#f5a623" />
          </View>
        ) : errMsg ? (
          <View style={styles.placeholder}>
            <Text style={styles.emptyTxt}>Chart unavailable</Text>
            <Text style={styles.errTxt}>{errMsg}</Text>
          </View>
        ) : data.length < 2 ? (
          <View style={styles.placeholder}>
            <Text style={styles.emptyTxt}>No chart data for {period}</Text>
          </View>
        ) : (
          <>
            {/* Price line chart */}
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 14 }}>
                <CartesianGrid vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: '#555555' }}
                  tickLine={false}
                  axisLine={false}
                  interval={xInterval}
                />
                <YAxis
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#555555' }}
                  tickLine={false}
                  axisLine={false}
                  tickCount={5}
                  domain={[domMin, domMax]}
                  tickFormatter={v => {
                    const n = Number(v);
                    return `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`;
                  }}
                  width={64}
                />
                {prevC > 0 && (
                  <ReferenceLine
                    y={prevC}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{ value: `Prev Close: $${prevC.toFixed(2)}`, position: 'insideTopLeft', fontSize: 9, fill: '#94a3b8', dx: 4, dy: -14 }}
                  />
                )}
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={lineClr}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Volume bar chart */}
            <ResponsiveContainer width="100%" height={28}>
              <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Bar dataKey="volume" fill={volClr} opacity={0.6} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginHorizontal: 10,
    marginBottom: 2,
    paddingTop: 6,
    paddingLeft: 12,
    paddingRight: 52,
    paddingBottom: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 2,
    flex: 1,
  },
  periodBtn: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  periodBtnActive: {
    backgroundColor: '#0a1628',
  },
  periodTxt: {
    fontSize: 10,
    color: '#666666',
    fontWeight: '500',
  },
  periodTxtActive: {
    color: '#fff',
    fontWeight: '700',
  },
  chevronBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 4,
  },
  chevronTxt: {
    fontSize: 10,
    color: '#94a3b8',
  },
  placeholder: {
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTxt: {
    color: '#94a3b8',
    fontSize: 12,
  },
  errTxt: {
    color: '#ef4444',
    fontSize: 10,
    marginTop: 4,
  },
  tooltip: {
    backgroundColor: '#0a1628',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
  },
  tooltipPrice: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  tooltipTime: {
    color: '#94a3b8',
    fontSize: 9,
    marginTop: 2,
  },
});
