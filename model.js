/**
 * model.js
 * Core financial simulation. Pure functions — no DOM dependencies.
 *
 * ── BUGS FIXED vs Python v5 ──────────────────────────────────────────────────
 *
 * BUG 1 — Residual delta double-accumulation (≈€100K error at yr10)
 *   OLD: cum[t] += resDelta[t]  every year  → adds stock repeatedly
 *   FIX: nw[t] = qdvePart[t] + resDelta[t]  (stock replaces, doesn't stack)
 *
 * BUG 2 — CGT base was total NW delta, not QDVE portfolio gain
 *   OLD: gain = cum[10] + D  (includes residuals, savings, loan payments)
 *   FIX: track QDVE portfolio and cost basis separately; CGT = max(0, portfolio−basis) × rate
 *
 * BUG 3 — CGT applied to Alt3 only, not Alt1 (asymmetric treatment)
 *   FIX: CGT applied consistently at year 10 in all scenarios via the same helper
 *
 * BUG 4 — R_base / fuel sensitivity scaled net savings instead of recomputing costs
 *   OLD: net_cf = savings[t] * rbaseAdj  (wrong — adjusts margin, not R_base)
 *   FIX: every scenario receives explicit rbaseAdj / fuelAdj and recomputes per-year costs
 *
 * BUG 5 — Alt2 missing initial −D deduction (appeared better than Alt3 in yr 0–2)
 *   FIX: Alt2 starts with same qi = S − P − charger − registration as Alt3
 *
 * BUG 6 — Summary table printed "see plot" (stub)
 *   FIX: breakeven and yr5/yr10 deltas computed and returned from simulate()
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Convex (front-loaded) residual value at year t.
 * t^1.6 exponent matches observed used EV market: steep early, flatter after yr 4.
 * @param {number} P        – purchase / current value
 * @param {number} r10      – expected value at year 10
 * @param {number} t        – year (0–10)
 */
function residualAtYear(P, r10, t) {
  if (t === 0) return P;
  const fraction = Math.pow(t / 10, 1.6);
  return P - (P - r10) * fraction;
}

/**
 * Annual loan payment (French annuity / prestação mensal × 12).
 * @param {number} D        – principal
 * @param {number} annRate  – annual interest rate (decimal)
 * @param {number} termYrs  – loan term in years
 */
function annualLoanPmt(D, annRate, termYrs) {
  if (D <= 0 || termYrs <= 0) return 0;
  const m = annRate / 12;
  const n = termYrs * 12;
  return D * m * Math.pow(1 + m, n) / (Math.pow(1 + m, n) - 1) * 12;
}

/**
 * Outstanding loan principal after t full years of monthly payments.
 * @param {number} D        – original principal
 * @param {number} annRate  – annual interest rate (decimal)
 * @param {number} termYrs  – loan term in years
 * @param {number} t        – years elapsed
 */
function loanBalance(D, annRate, termYrs, t) {
  if (D <= 0 || t >= termYrs) return 0;
  const m = annRate / 12;
  const N = termYrs * 12;
  const paid = t * 12;
  return D * (Math.pow(1 + m, N) - Math.pow(1 + m, paid)) / (Math.pow(1 + m, N) - 1);
}

/**
 * Per-year EV running cost (nominal €) for year t.
 * Includes battery degradation, inflation, age-dependent maintenance, and public charging blend.
 *
 * @param {object} car       – car record from CAR_DB (with possible user overrides applied)
 * @param {object} params    – simulation parameters
 * @param {number} t         – year index (1–10)
 * @param {number} fuelAdj   – fuel price sensitivity multiplier (1.0 = base case)
 */
function evCostAtYear(car, params, t, fuelAdj = 1) {
  const { inflation, publicPct, publicKwh, homeRate } = params;
  const infl    = Math.pow(1 + inflation, t);
  const ageEV   = 1 + 0.08 * t;   // maintenance + issues grow with vehicle age

  // Effective electricity cost per kWh = blend of home and public charger rates
  // Electricity consumption rises each year due to battery degradation
  const blendRate = homeRate > 0
    ? ((1 - publicPct) * homeRate + publicPct * publicKwh) / homeRate
    : 1;

  const fuelBase = car.fuel * fuelAdj;
  const fuelCost = fuelBase * (1 + car.degrad * t) * blendRate * infl;
  const other    = (car.iuc + car.insurance + car.maint * ageEV + car.issues * ageEV) * infl;
  return fuelCost + other;
}

/**
 * Current car (Mercedes / baseline) running cost in year t.
 * Fuel component inflates with fuelAdj; all costs inflate with CPI; age penalty applied.
 *
 * @param {object} params   – simulation parameters (R_base, fuelShare, inflation)
 * @param {number} t        – year
 * @param {number} rbaseAdj – sensitivity multiplier on non-fuel costs (1.0 = base)
 * @param {number} fuelAdj  – sensitivity multiplier on fuel costs (1.0 = base)
 */
function mercCostAtYear(params, t, rbaseAdj = 1, fuelAdj = 1) {
  const { R_base, fuelShare, inflation } = params;
  const infl    = Math.pow(1 + inflation, t);
  const ageMerc = 1 + 0.12 * t;  // older ICE car: increasing unreliability penalty

  const fuelPart  = R_base * fuelShare  * fuelAdj  * infl * ageMerc;
  const otherPart = R_base * (1 - fuelShare) * rbaseAdj * infl * ageMerc;
  return fuelPart + otherPart;
}

/**
 * Main simulation for one car under one return rate and one set of sensitivity adjusters.
 *
 * Returns arrays of length 11 (years 0–10) for nw_alt1, nw_alt2, nw_alt3.
 * Positive values = you are richer than if you had kept the current car.
 *
 * ── NW DELTA STRUCTURE ──────────────────────────────────────────────────────
 *
 * All scenarios track two separate components:
 *   1. qdve_balance   – the QDVE portfolio difference vs baseline (can be negative)
 *   2. resDelta       – STOCK difference in vehicle asset values (EV residual − merc residual)
 *
 * NW delta = qdve_balance + resDelta   (resDelta is a stock; it REPLACES each year, never stacks)
 *
 * Alt1 (Loan):
 *   D is borrowed → D never leaves QDVE → no QDVE deduction for D.
 *   Surplus from sale (if P < S) goes into QDVE.
 *   Net cashflow (savings − loan_pmt) reinvested in QDVE each year.
 *   Loan liability = loanBalance(t) subtracted from NW.
 *
 * Alt2 (Cash, no reinvest):
 *   D withdrawn from QDVE upfront (qi = S − P − charger − registration).
 *   Savings accumulate as cash (0% return on savings — lower bound).
 *   Initial withdrawal compounds negatively (opportunity cost of D).
 *
 * Alt3 (Cash + reinvest):
 *   Same initial D withdrawal as Alt2.
 *   Every year's savings are immediately reinvested in QDVE and compound.
 *
 * CGT (Portuguese law):
 *   Applied at year 10 only (ETF redemption), on the portfolio GAIN.
 *   gain = qdve_balance − cost_basis
 *   cgt  = max(0, gain) × cgt_rate
 *   Applied identically in Alt1 and Alt3 (FIX 3).
 *
 * @param {object} car       – car from CAR_DB (after user overrides applied)
 * @param {object} params    – full simulation parameters
 * @param {number} grossReturn – annual gross investment return (decimal)
 * @param {number} rbaseAdj  – multiplier on non-fuel current car costs
 * @param {number} fuelAdj   – multiplier on fuel costs (both cars)
 * @returns {{ alt1: number[], alt2: number[], alt3: number[], savings: number[], resDelta: number[] }}
 */
function simulateCar(car, params, grossReturn, rbaseAdj = 1, fuelAdj = 1) {
  const { S, mercRes10, charger, registration, loanRate, loanTerm, CGT } = params;
  const P   = car.P;
  const D   = Math.max(P + charger + registration - S, 0);  // amount needed from loan or QDVE
  const sur = Math.max(S - P - charger - registration, 0);  // surplus reinvested if P < S
  const qi  = S - P - charger - registration;               // net QDVE impact at t=0 (negative if D>0)
  const pmt = annualLoanPmt(D, loanRate, loanTerm);

  // ── Pre-compute per-year savings and residual delta ─────────────────────
  const savings  = [0];  // index 0 unused (no savings at t=0)
  const resDelta = [];   // STOCK: ev_residual(t) − merc_residual(t)

  resDelta[0] = P - S;  // at t=0: you own EV worth P, gave up Mercedes worth S

  for (let t = 1; t <= 10; t++) {
    const evCost   = evCostAtYear(car, params, t, fuelAdj);
    const mercCost = mercCostAtYear(params, t, rbaseAdj, fuelAdj);
    savings[t]  = mercCost - evCost;  // positive = EV is cheaper to run
    resDelta[t] = residualAtYear(P, car.residual10, t)
                - residualAtYear(S, mercRes10, t);  // stock difference
  }

  // ── Alt1: Loan ───────────────────────────────────────────────────────────
  const alt1 = new Array(11).fill(0);
  let q1 = sur, b1 = sur;  // QDVE balance and its cost basis (only surplus goes in at t=0)
  // t=0: qdve impact = surplus invested; liability = D (loan); asset delta = P-S
  // nw = sur - D + (P-S) = sur - D + P - S = -(charger+registration)  [as expected]
  alt1[0] = q1 - loanBalance(D, loanRate, loanTerm, 0) + resDelta[0];

  for (let t = 1; t <= 10; t++) {
    const lp  = (t <= loanTerm) ? pmt : 0;
    const ncf = savings[t] - lp;    // net cashflow this year (can be negative in early years)
    q1 = q1 * (1 + grossReturn) + ncf;
    b1 += ncf;                       // track cost basis (contributions in)
    let nw = q1 - loanBalance(D, loanRate, loanTerm, t) + resDelta[t]; // FIX 1: resDelta as stock
    if (t === 10) {
      const gain = q1 - b1;
      nw -= Math.max(0, gain) * CGT;  // FIX 2+3: CGT on QDVE gain only
    }
    alt1[t] = Math.round(nw);
  }

  // ── Alt2: Cash, no reinvest (lower bound) ────────────────────────────────
  const alt2 = new Array(11).fill(0);
  let q2 = qi, cumSav = 0;
  // FIX 5: alt2 starts with same initial QDVE withdrawal as alt3
  alt2[0] = Math.round(q2 + resDelta[0]);

  for (let t = 1; t <= 10; t++) {
    q2 = q2 * (1 + grossReturn);   // initial withdrawal compounds (loses value if qi<0)
    cumSav += savings[t];          // savings pile up as cash — zero investment return
    alt2[t] = Math.round(q2 + cumSav + resDelta[t]);  // FIX 1
    // No CGT: for most cars q2 ≤ qi ≤ 0, so no gain to tax
  }

  // ── Alt3: Cash + reinvest savings ────────────────────────────────────────
  const alt3 = new Array(11).fill(0);
  let q3 = qi, b3 = qi;  // QDVE balance and cost basis
  alt3[0] = Math.round(q3 + resDelta[0]);

  for (let t = 1; t <= 10; t++) {
    q3 = q3 * (1 + grossReturn) + savings[t];
    b3 += savings[t];
    let nw = q3 + resDelta[t];    // FIX 1
    if (t === 10) {
      const gain = q3 - b3;
      nw -= Math.max(0, gain) * CGT;  // FIX 2+3
    }
    alt3[t] = Math.round(nw);
  }

  return { alt1, alt2, alt3, savings, resDelta };
}

/**
 * Find first year where the series crosses above 0.
 * Returns "Year N" or "Not within 10 years".
 */
function breakeven(series) {
  for (let t = 1; t < series.length; t++) {
    if (series[t] > 0) return `Year ${t}`;
  }
  return "Not within 10 yrs";
}

/**
 * Build all traces for a single car (all scenarios + optional sensitivity band).
 * Returns an array of trace objects compatible with Plotly.
 *
 * @param {object} car
 * @param {object} params
 * @param {object} opts   – { showAlt1, showAlt2, showAlt3, showBand, color, scenarios }
 */
function buildTraces(car, params, opts) {
  const { showAlt1, showAlt2, showAlt3, showBand, color } = opts;
  const gr     = params.grossReturn;
  const YEARS  = Array.from({ length: 11 }, (_, i) => i);
  const traces = [];

  const res = simulateCar(car, params, gr);

  const addLine = (data, label, dash, width) => {
    traces.push({
      x: YEARS,
      y: data,
      name: `${car.name} · ${label}`,
      legendgroup: car.name,
      line: { color, dash, width },
      hovertemplate: `Year %{x}: <b>€%{y:,}</b><extra>${car.name} · ${label}</extra>`,
      type: 'scatter',
      mode: 'lines',
    });
  };

  if (showAlt1) addLine(res.alt1, 'Loan 9.1% (Alt1)',         'solid',   2.5);
  if (showAlt2) addLine(res.alt2, 'Cash / no reinvest (Alt2)','dot',     1.8);
  if (showAlt3) addLine(res.alt3, 'Cash + reinvest (Alt3)',   'dashdot', 2.5);

  // Sensitivity band (FIX 4: different return rates, not scaled savings)
  if (showBand && showAlt3) {
    const lo = simulateCar(car, params, gr * 0.8).alt3;
    const hi = simulateCar(car, params, gr * 1.2).alt3;
    traces.push({
      x: [...YEARS, ...YEARS.slice().reverse()],
      y: [...hi, ...lo.slice().reverse()],
      fill: 'toself',
      fillcolor: hexToRgba(color, 0.12),
      line: { width: 0 },
      showlegend: false,
      hoverinfo: 'skip',
      legendgroup: car.name,
      type: 'scatter',
    });
  }

  return traces;
}

/**
 * Compute summary row data for the table.
 * FIX 6: returns actual computed values, not "see plot" stubs.
 */
function summaryRows(car, params, opts) {
  const { showAlt1, showAlt2, showAlt3 } = opts;
  const gr  = params.grossReturn;
  const res = simulateCar(car, params, gr);
  const rows = [];

  if (showAlt1) rows.push({ car: car.name, scenario: 'Loan (Alt1)',             data: res.alt1 });
  if (showAlt2) rows.push({ car: car.name, scenario: 'Cash / no reinvest (Alt2)', data: res.alt2 });
  if (showAlt3) rows.push({ car: car.name, scenario: 'Cash + reinvest (Alt3)',   data: res.alt3 });

  return rows.map(r => ({
    car:       r.car,
    scenario:  r.scenario,
    breakeven: breakeven(r.data),
    yr5:       r.data[5],
    yr10:      r.data[10],
  }));
}

/** Convert hex colour to rgba string. */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
