/**
 * data-cars.js
 * Source-of-truth car database.
 * All values are year-0 nominal (Portugal 2026, 15 000 km/yr).
 *
 * Fields:
 *   P              – purchase price (€)
 *   fuel           – base annual electricity cost at home rate (€/yr)
 *   iuc            – IUC road tax (€/yr)
 *   insurance      – insurance (€/yr)
 *   maint          – maintenance (€/yr)
 *   issues         – average repairs / unplanned issues (€/yr)
 *   residual10     – residual market value in year 10 (€)
 *   degrad         – annual battery degradation factor (increases electricity consumption)
 *
 * Sources: AutoScout24 PT, Standvirtual, AutoTrader PT, EV-Database.org,
 *          ACAP Portugal, Autobild residual-value studies 2023-25, Which? used-EV tracker.
 */
const CAR_DB = [
  {
    id: 0,
    name: "MG4 Standard 51kWh (LFP)",
    P: 17700, fuel: 470, iuc: 60, insurance: 650,
    maint: 300, issues: 210, residual10: 5700, degrad: 0.016,
    note: "Competitive pricing but rapid model cycle → above-avg depreciation. LFP chemistry: good cycle life."
  },
  {
    id: 1,
    name: "MG4 Long Range 64kWh",
    P: 19700, fuel: 430, iuc: 60, insurance: 670,
    maint: 300, issues: 190, residual10: 6500, degrad: 0.016,
    note: "Larger pack; lower per-km energy cost. Better residual than Standard due to range advantage."
  },
  {
    id: 2,
    name: "VW ID.3 58kWh (2021–26)",
    P: 17200, fuel: 490, iuc: 60, insurance: 580,
    maint: 340, issues: 220, residual10: 6500, degrad: 0.023,
    note: "Strong VW brand residuals vs most EVs. Known early software issues drag slightly on reliability score."
  },
  {
    id: 3,
    name: "VW ID.3 77kWh Pro S",
    P: 21200, fuel: 450, iuc: 60, insurance: 620,
    maint: 340, issues: 200, residual10: 8300, degrad: 0.023,
    note: "Best range in ID.3 family; slightly better residual. Same platform reliability profile."
  },
  {
    id: 4,
    name: "Tesla Model 3 LFP pre-Highland",
    P: 24200, fuel: 360, iuc: 60, insurance: 720,
    maint: 280, issues: 220, residual10: 10900, degrad: 0.016,
    note: "Highland refresh (2024) hurt resale of older RWD. Still best residuals vs non-Tesla EVs in class. Supercharger network advantage."
  },
  {
    id: 5,
    name: "Nissan Leaf 40kWh",
    P: 13700, fuel: 550, iuc: 60, insurance: 560,
    maint: 370, issues: 420, residual10: 3000, degrad: 0.028,
    note: "⚠ No active thermal management → faster battery degradation (~2.8%/yr). Worst depreciation in class. Thin PT resale market."
  },
  {
    id: 6,
    name: "Nissan Leaf 62kWh",
    P: 16700, fuel: 430, iuc: 60, insurance: 590,
    maint: 350, issues: 300, residual10: 4200, degrad: 0.028,
    note: "⚠ Same thermal management concern as 40kWh. Larger pack partially offsets degradation impact on range."
  },
  {
    id: 7,
    name: "Renault Zoe R110/R135",
    P: 10700, fuel: 410, iuc: 60, insurance: 520,
    maint: 300, issues: 270, residual10: 3000, degrad: 0.025,
    note: "⚠ Discontinued model (no successor in segment) → poor residual outlook. Cheapest entry point but weakest 10-yr financial case."
  }
];

/**
 * Current car (baseline).
 * The user can override all values in the UI.
 */
const BASELINE_DEFAULTS = {
  name:        "Current Mercedes",
  S:           5000,    // sale price today (€)
  R_base:      4522,    // all-in annual running cost year-0 (€/yr)
  residual10:  1200,    // residual value at year 10 (€)
  fuelShare:   0.40,    // fraction of R_base that is fuel (for fuel-price sensitivity)
};

/**
 * Investment options shown in the UI.
 * grossReturn is the conservative figure used by default in the model.
 * historicalReturn is shown as context but NOT used for calculation unless the user picks it.
 */
const INVESTMENT_OPTIONS = [
  {
    id: "qdve",
    label: "QDVE — iShares MSCI World Quality Dividend",
    historicalReturn: 0.155,   // ~15.5% gross avg since 2014 (source: justETF, Bloomberg)
    grossReturn: 0.12,          // conservative estimate used in model
    note: "12% gross conservative estimate. Historical avg since inception ~15–17%. Portuguese CGT 28% at redemption."
  },
  {
    id: "other",
    label: "Custom investment",
    historicalReturn: null,
    grossReturn: 0.08,
    note: "Enter your own expected annual gross return."
  }
];
