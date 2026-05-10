// Runner detection logic test — mirrors detectRunners() from HomeScreen.js
// Run: node test_runner_detection.mjs

function detectRunners(stocks, prevHighs = {}, hasPrevHighs = false) {
  return stocks
    .filter(s => {
      const pct     = Number(s.changePercent);
      const vol     = Number(s.volume);
      const prevVol = Number(s.previousVolume) || 0;
      const rvol    = prevVol > 0 ? vol / prevVol : 0;

      const strongMomentum  = pct > 20 && vol > 500_000;
      const unusualVolSpike = pct > 10 && rvol > 3;
      const extremeMover    = pct > 50;
      const prevHigh = prevHighs[s.ticker];
      const newHOD   = hasPrevHighs
        && prevHigh != null
        && Number(s.dayHigh) > prevHigh;

      return strongMomentum || unusualVolSpike || newHOD || extremeMover;
    })
    .sort((a, b) => {
      const scoreA = Number(a.changePercent) * Math.log(Math.max(Number(a.volume), 1));
      const scoreB = Number(b.changePercent) * Math.log(Math.max(Number(b.volume), 1));
      return scoreB - scoreA;
    })
    .slice(0, 20);
}

// ── Sample data ────────────────────────────────────────────────────────────────

const SAMPLES = [
  // Should qualify: strongMomentum (pct > 20, vol > 500K)
  { ticker: 'RNNR1', changePercent: 35,  volume: 2_000_000, previousVolume: 800_000, dayHigh: 10,  price: 10   },
  // Should qualify: extremeMover (pct > 50)
  { ticker: 'RNNR2', changePercent: 75,  volume: 150_000,   previousVolume: 100_000, dayHigh: 5,   price: 5    },
  // Should qualify: unusualVolSpike (pct > 10, rvol > 3x)  rvol = 2M / 400K = 5x
  { ticker: 'RNNR3', changePercent: 15,  volume: 2_000_000, previousVolume: 400_000, dayHigh: 7,   price: 7    },
  // Should qualify: newHOD (dayHigh went from 12 → 14)
  { ticker: 'RNNR4', changePercent: 8,   volume: 600_000,   previousVolume: 500_000, dayHigh: 14,  price: 14   },
  // Should NOT qualify: pct < 20 and vol < 500K
  { ticker: 'SKIP1', changePercent: 18,  volume: 300_000,   previousVolume: 200_000, dayHigh: 9,   price: 9    },
  // Should NOT qualify: pct > 10 but rvol only 1.5x
  { ticker: 'SKIP2', changePercent: 12,  volume: 600_000,   previousVolume: 400_000, dayHigh: 6,   price: 6    },
  // Should NOT qualify: pct = 8 (below all thresholds), no HOD
  { ticker: 'SKIP3', changePercent: 8,   volume: 1_000_000, previousVolume: 800_000, dayHigh: 5,   price: 4.8  },
  // Should qualify: borderline — pct exactly 20.01, vol 500_001
  { ticker: 'EDGE1', changePercent: 20.01, volume: 500_001, previousVolume: 300_000, dayHigh: 11,  price: 11   },
  // Should NOT qualify: pct exactly 20, vol exactly 500K (must be GREATER than)
  { ticker: 'EDGE2', changePercent: 20,  volume: 500_000,   previousVolume: 300_000, dayHigh: 10,  price: 10   },
];

const prevHighs = {
  RNNR4: 12,  // previous dayHigh was 12, now 14 → new HOD
  SKIP3: 5,   // same dayHigh → no new HOD
};

// ── Run tests ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

console.log('\n=== Runner Detection Tests ===\n');

// Test 1: basic detection (no HOD history)
console.log('Test 1 — Basic detection without HOD history:');
const r1 = detectRunners(SAMPLES, prevHighs, false);
const tickers1 = r1.map(s => s.ticker);
check('RNNR1 qualifies (strong momentum)', tickers1.includes('RNNR1'));
check('RNNR2 qualifies (extreme mover)',   tickers1.includes('RNNR2'));
check('RNNR3 qualifies (unusual vol RVOL=5x)', tickers1.includes('RNNR3'));
check('RNNR4 NOT qualified (no HOD history yet)', !tickers1.includes('RNNR4'));
check('SKIP1 excluded (pct<20 vol<500K)', !tickers1.includes('SKIP1'));
check('SKIP2 excluded (rvol only 1.5x)',  !tickers1.includes('SKIP2'));
check('SKIP3 excluded (below all thresholds)', !tickers1.includes('SKIP3'));
check('EDGE1 qualifies (20.01% > 500K)', tickers1.includes('EDGE1'));
check('EDGE2 excluded (exactly 20% not >20)', !tickers1.includes('EDGE2'));

// Test 2: with HOD history enabled
console.log('\nTest 2 — With HOD history:');
const r2 = detectRunners(SAMPLES, prevHighs, true);
const tickers2 = r2.map(s => s.ticker);
check('RNNR4 qualifies now (new HOD: 12→14)', tickers2.includes('RNNR4'));
check('SKIP3 still excluded (same HOD)',       !tickers2.includes('SKIP3'));

// Test 3: empty input → empty output
console.log('\nTest 3 — Empty stock list:');
const r3 = detectRunners([], {}, false);
check('Empty input → empty output', r3.length === 0);

// Test 4: score sorting (higher pct × log(vol) comes first)
console.log('\nTest 4 — Sort order by score:');
const sorted = detectRunners([
  { ticker: 'HIGH', changePercent: 60, volume: 5_000_000, previousVolume: 1_000_000, dayHigh: 20, price: 20 },
  { ticker: 'LOW',  changePercent: 25, volume: 800_000,   previousVolume: 300_000,   dayHigh: 8,  price: 8  },
], {}, false);
check('HIGH-score runner is first', sorted[0]?.ticker === 'HIGH');
check('LOW-score runner is second', sorted[1]?.ticker === 'LOW');

// Test 5: score formula sanity — score = changePercent × ln(volume)
console.log('\nTest 5 — Score formula sanity:');
const scoreHigh = 60 * Math.log(5_000_000);
const scoreLow  = 25 * Math.log(800_000);
check(`HIGH score (${scoreHigh.toFixed(0)}) > LOW score (${scoreLow.toFixed(0)})`, scoreHigh > scoreLow);

// Test 6: cap at 20 runners
console.log('\nTest 6 — 20-runner cap:');
const manyStocks = Array.from({ length: 30 }, (_, i) => ({
  ticker: `S${i}`, changePercent: 55 + i, volume: 1_000_000,
  previousVolume: 300_000, dayHigh: 10, price: 10,
}));
const r6 = detectRunners(manyStocks, {}, false);
check('Capped at 20 even with 30 qualifiers', r6.length === 20);

// Test 7: RVOL threshold — 🔥 badge at >= 5x
console.log('\nTest 7 — RVOL >= 5x detection (for 🔥 badge):');
const highRvol = { ticker: 'FIRE', changePercent: 25, volume: 3_000_000, previousVolume: 500_000, dayHigh: 15, price: 15 };
const prevVol = Number(highRvol.previousVolume);
const rvol = prevVol > 0 ? Number(highRvol.volume) / prevVol : 0;
check(`RVOL = ${rvol.toFixed(1)}x (>= 5x) → 🔥`, rvol >= 5);

// Test 8: zero previousVolume doesn't crash
console.log('\nTest 8 — Zero previousVolume (no RVOL crash):');
const noHistory = [{ ticker: 'NEW', changePercent: 25, volume: 700_000, previousVolume: 0, dayHigh: 5, price: 5 }];
const r8 = detectRunners(noHistory, {}, false);
check('NEW qualifies via strongMomentum (rvol=0 skipped)', r8[0]?.ticker === 'NEW');

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed ✅');
} else {
  console.log(`${failed} test(s) failed ❌`);
  process.exit(1);
}
