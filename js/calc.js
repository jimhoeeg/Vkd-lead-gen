/*
 * Beregningskerne for VikingDanmark lead-generator (prototype).
 * Rene funktioner uden DOM, så de kan testes i Node (tests/calc.test.mjs)
 * og bruges i browseren (window.VKCalc).
 *
 * Alle standardværdier er EKSEMPELVÆRDIER, som skal kalibreres med
 * VikingDanmarks egne tal før lancering. Se docs/BEREGNINGER.md.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Standardantagelser
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    herd: {
      cows: 250,                 // årskøer
      replacementRate: 0.38,     // udskiftningsprocent
      calvingIntervalMonths: 13, // kælvningsinterval
    },
    biology: {
      femaleShare: { sexed: 0.90, conv: 0.47 }, // andel kviekalve pr. kælvning
      calfLoss: 0.08,      // dødfødte + døde kalve til ca. 6 mdr.
      rearingLoss: 0.06,   // kvier der udsættes/dør før 1. kælvning
      conception: {        // drægtighed pr. insemination
        heifer: { sexed: 0.55, conv: 0.65, beef: 0.65 },
        cow:    { sexed: 0.40, conv: 0.45, beef: 0.45 },
      },
    },
    prices: {
      straw: { sexed: 450, conv: 200, beef: 150 }, // kr. pr. strå
      inseminationFee: 175,     // kr. pr. insemination
      beefCalf: 2400,           // krydsningskalv, solgt ca. 3 uger
      dairyBullCalf: 600,       // malkerace-tyrekalv
      rearingCost: 15500,       // opdræt af én kvie til kælvning
      heiferSale: 15000,        // salgspris drægtig kvie
      heiferBuy: 17000,         // købspris drægtig kvie inkl. transport
      heiferCalf: 1200,         // salgspris kviekalv (ca. 3-4 uger)
    },
    strategy: { // nuværende inseminering (andele summer til 1 pr. gruppe)
      heifer: { sexed: 0.30, conv: 0.70, beef: 0.00 },
      cow:    { sexed: 0.10, conv: 0.50, beef: 0.40 },
    },
    buffer: 0.05, // ønsket sikkerhedsmargin på kvier
  };

  const sum3 = (m) => m.sexed + m.conv + m.beef;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // ---------------------------------------------------------------------------
  // 1) Kviebalance & kalveøkonomi
  // ---------------------------------------------------------------------------
  /**
   * Beregner årlig kviebalance og økonomi for en insemineringsstrategi.
   * Logik:
   *  - kælvninger/år = køer × 12 / kælvningsinterval
   *  - førstekælvninger (= kvier der skal insemineres) = køer × udskiftning
   *  - kviekalve = kælvninger × andel med hver sædtype × kønsfordeling
   *  - kvier til kælvning = kviekalve × (1-kalvetab) × (1-opdrætstab)
   *  - balance = kvier til kælvning − behov (køer × udskiftning)
   *  - økonomi = kalvesalg + værdi af kvieoverskud/-underskud − sæd og inseminering
   *  Opdræt af de kvier man SKAL bruge er ens i alle strategier og indgår ikke.
   */
  function heiferBalance(herd, strategy, biology = DEFAULTS.biology, prices = DEFAULTS.prices, surplusAs = 'heifer') {
    const calvings = herd.cows * 12 / herd.calvingIntervalMonths;
    const firstCalvings = Math.min(calvings, herd.cows * herd.replacementRate);
    const cowCalvings = calvings - firstCalvings;
    const need = herd.cows * herd.replacementRate;

    const fs = biology.femaleShare;
    const survivalToCalving = (1 - biology.calfLoss) * (1 - biology.rearingLoss);
    const live = 1 - biology.calfLoss;

    const groups = [
      { key: 'heifer', n: firstCalvings, mix: strategy.heifer, conc: biology.conception.heifer },
      { key: 'cow', n: cowCalvings, mix: strategy.cow, conc: biology.conception.cow },
    ];

    let heiferCalvesBorn = 0, bullCalvesBorn = 0, beefCalvesBorn = 0;
    let inseminations = 0, semenCost = 0;
    const semenByType = { sexed: 0, conv: 0, beef: 0 };

    for (const g of groups) {
      const total = sum3(g.mix) || 1;
      for (const t of ['sexed', 'conv', 'beef']) {
        const share = g.mix[t] / total;
        const preg = g.n * share; // drægtigheder ≈ kælvninger
        if (t === 'beef') beefCalvesBorn += preg;
        else {
          heiferCalvesBorn += preg * fs[t];
          bullCalvesBorn += preg * (1 - fs[t]);
        }
        const ins = preg > 0 ? preg / g.conc[t] : 0;
        const cost = ins * (prices.straw[t] + prices.inseminationFee);
        inseminations += ins;
        semenCost += cost;
        semenByType[t] += cost;
      }
    }

    const heifersToCalving = heiferCalvesBorn * survivalToCalving;
    const balance = heifersToCalving - need;
    const beefCalvesSold = beefCalvesBorn * live;
    const bullCalvesSold = bullCalvesBorn * live;

    const beefRevenue = beefCalvesSold * prices.beefCalf;
    const bullRevenue = bullCalvesSold * prices.dairyBullCalf;
    // Overskud: sælges som drægtige kvier (salgspris − opdrætsomkostning).
    // Underskud: skal købes (købspris − den opdrætsomkostning man sparer).
    // surplusAs='calf': overskuddet sælges som kviekalve, før opdræt starter
    // (det man gør, når man udvælger på genomisk test ved fødslen).
    let heiferValue;
    if (balance < 0) heiferValue = balance * (prices.heiferBuy - prices.rearingCost);
    else if (surplusAs === 'calf') heiferValue = (balance / (1 - biology.rearingLoss)) * prices.heiferCalf;
    else heiferValue = balance * (prices.heiferSale - prices.rearingCost);

    const net = beefRevenue + bullRevenue + heiferValue - semenCost;

    return {
      calvings, firstCalvings, cowCalvings, need,
      heiferCalvesBorn, bullCalvesBorn, beefCalvesBorn,
      heifersToCalving, balance, balancePct: need > 0 ? balance / need : 0,
      beefCalvesSold, bullCalvesSold,
      inseminations, semenCost, semenByType,
      beefRevenue, bullRevenue, heiferValue, net,
      sexedShareOfCalvings: calvings > 0
        ? (firstCalvings * strategy.heifer.sexed / (sum3(strategy.heifer) || 1)
          + cowCalvings * strategy.cow.sexed / (sum3(strategy.cow) || 1)) / calvings
        : 0,
    };
  }

  /**
   * Anbefalet strategi: lav præcis de kvier, der er brug for (+ buffer),
   * med kønssorteret sæd på de bedste dyr, og kødkvæg på resten.
   * 1) Kvierne prioriteres først (højest drægtighed med kønssorteret og
   *    typisk højest genetisk niveau).
   * 2) Mangler der stadig kvier, bruges kønssorteret på en andel af køerne
   *    (de genetisk bedste – vælges med genomisk test).
   * 3) Resten insemineres med kødkvæg. Konventionel malkeracesæd bruges ikke.
   */
  function recommendStrategy(herd, buffer = DEFAULTS.buffer, biology = DEFAULTS.biology) {
    const calvings = herd.cows * 12 / herd.calvingIntervalMonths;
    const first = Math.min(calvings, herd.cows * herd.replacementRate);
    const cowCalv = calvings - first;
    const target = herd.cows * herd.replacementRate * (1 + buffer);
    const perSexed = biology.femaleShare.sexed * (1 - biology.calfLoss) * (1 - biology.rearingLoss);

    const maxHeifer = first * perSexed;
    let hs, cs, feasible = true;
    if (maxHeifer >= target) {
      hs = maxHeifer > 0 ? target / maxHeifer : 0;
      cs = 0;
    } else {
      hs = 1;
      const maxCow = cowCalv * perSexed;
      cs = maxCow > 0 ? (target - maxHeifer) / maxCow : Infinity;
      if (cs > 1) { cs = 1; feasible = false; }
    }
    return {
      strategy: {
        heifer: { sexed: hs, conv: 0, beef: 1 - hs },
        cow: { sexed: cs, conv: 0, beef: 1 - cs },
      },
      feasible,
      target,
    };
  }

  /** Den kviesalgspris, hvor et overskud af kvier netop løber rundt. */
  function heiferBreakEven(prices = DEFAULTS.prices) {
    return prices.rearingCost;
  }

  // ---------------------------------------------------------------------------
  // 2) Genomisk test
  // ---------------------------------------------------------------------------
  /** Invers standardnormalfordeling (Acklam). */
  function invNorm(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= ph) {
      q = p - 0.5; r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  /** Selektionsintensitet i ved trunkeringsselektion af andelen p (0<p≤1). */
  function selectionIntensity(p) {
    if (p >= 1) return 0;
    if (p <= 0.001) p = 0.001;
    const z = invNorm(1 - p);
    const phi = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    return phi / p;
  }

  // Nordic EBV (2020): økonomisk værdi af 1 NTM-enhed pr. årsko, omregnet til kr. (7,46 kr./€)
  const NTM_VALUE_BY_BREED = { holstein: 74, rdm: 69, jersey: 60, kryds: 69 };

  const GENOMIC_DEFAULTS = {
    accParentAverage: 0.55, // sikkerhed (r) for afstamningsindeks, inkl. stamtavlefejl
    accGenomic: 0.80,       // sikkerhed (r) for genomisk indeks
    sdNTM: 10,              // genetisk spredning (σA) i NTM-enheder
    krPerNTMYear: 74,       // kr. pr. NTM-enhed pr. årsko (Nordic EBV 2020: Holstein 9,9 €)
    generationFactor: 1.0,  // 1 = tæller kun dyret selv/døtrene (varig fremgang ikke medregnet)
    productiveYears: 2.8,   // gennemsnitlige ko-år pr. ko
    testPrice: 200,         // kr. pr. test
  };

  /**
   * Merværdi af at vælge med genomisk indeks i stedet for afstamningsindeks.
   * To beslutninger udnytter testen:
   *  A) Hvilke kviekalve der opdrættes (andel beholdt pKeep).
   *     Gevinst pr. opdrættet kvie = i(pKeep)·(rG − rPA)·σ   [kvien selv]
   *  B) Hvilke hundyr der får kønssorteret sæd (andel sexedShare); resten kødkvæg.
   *     Gevinst pr. datter = ½·i(sexedShare)·(rG − rPA)·σ  [halvdelen arves]
   * Værdi = NTM-gevinst × kr. pr. NTM pr. år × produktive år.
   */
  function genomicValue({ tested, kept, sexedShare }, g = GENOMIC_DEFAULTS) {
    const dAcc = Math.max(0, g.accGenomic - g.accParentAverage);
    const pKeep = tested > 0 ? Math.min(1, kept / tested) : 1;
    const iKeep = selectionIntensity(pKeep);
    const iSexed = sexedShare > 0 && sexedShare < 1 ? selectionIntensity(sexedShare) : 0;
    const gainKeepNTM = iKeep * dAcc * g.sdNTM;
    const gainDaughterNTM = 0.5 * iSexed * dAcc * g.sdNTM;
    const life = g.krPerNTMYear * g.productiveYears;
    const gf = g.generationFactor || 1;
    const valueKeep = kept * gainKeepNTM * life * gf;
    const valueDaughters = kept * gainDaughterNTM * life * gf;
    const value = valueKeep + valueDaughters;
    const cost = tested * g.testPrice;
    return { pKeep, iKeep, iSexed, gainKeepNTM, gainDaughterNTM, gainTotalNTM: gainKeepNTM + gainDaughterNTM,
      valueKeep, valueDaughters, value, cost, net: value - cost, tested, kept };
  }

  /**
   * Selektionsrum-scenarie: lav (1+buffer) × behov kvier med kønssorteret sæd
   * på de bedste, test alle kviekalve, opdræt kun de bedste og sælg resten som
   * kviekalve. Returnerer kvieøkonomi + genomisk merværdi.
   */
  function genomicScenario(herd, buffer, g = GENOMIC_DEFAULTS, biology = DEFAULTS.biology, prices = DEFAULTS.prices) {
    const rec = recommendStrategy(herd, buffer, biology);
    const hb = heiferBalance(herd, rec.strategy, biology, prices, 'calf');
    const tested = hb.heiferCalvesBorn * (1 - biology.calfLoss);
    const kept = Math.min(tested, hb.need / (1 - biology.rearingLoss));
    const gv = genomicValue({ tested, kept, sexedShare: hb.sexedShareOfCalvings }, g);
    return { buffer, feasible: rec.feasible, strategy: rec.strategy, herdNet: hb.net, hb, genomic: gv, total: hb.net + gv.net };
  }

  /** Gennemløb af selektionsrum 0-50 % og det økonomisk bedste punkt. */
  function genomicOptimum(herd, g = GENOMIC_DEFAULTS, biology = DEFAULTS.biology, prices = DEFAULTS.prices) {
    const base = genomicScenario(herd, 0, { ...g, testPrice: 0, accGenomic: g.accParentAverage }, biology, prices);
    const points = [];
    for (let b = 0; b <= 0.5001; b += 0.025) {
      const sc = genomicScenario(herd, b, g, biology, prices);
      if (!sc.feasible) break;
      points.push({ buffer: b, total: sc.total, herdNet: sc.herdNet, gain: sc.genomic.value, cost: sc.genomic.cost, vsBase: sc.total - base.herdNet });
    }
    const best = points.reduce((a, p) => (p.total > a.total ? p : a), points[0]);
    return { base: base.herdNet, points, best };
  }

  // ---------------------------------------------------------------------------
  // 3) Klima & foder via avl
  // ---------------------------------------------------------------------------
  const CLIMATE_DEFAULTS = {
    emissionPerCowT: 5.6,       // t CO2e pr. ko pr. år i afgiftsgrundlaget (eksempel)
    entericShare: 0.70,         // andel fra vommen (det avlen kan påvirke)
    baseDeduction: 0.60,        // bundfradrag
    methaneGainPerYear: 0.0075, // ekstra årlig fremgang i metan ved at vægte metanindekset
    feedGainPerYear: 0.0025,    // ekstra årlig fremgang i fodereffektivitet ved at vægte Saved Feed
    feedKgDMPerCowYear: 7000,   // kg tørstof pr. ko pr. år
    feedPricePerKgDM: 2.0,      // kr. pr. kg tørstof
    startYear: 2027,            // år hvor avlsstrategien ændres
    lagYears: 3,                // før døtrene er i produktion
  };

  /** Nominel afgift kr./t CO2e: 300 i 2030 stigende lineært til 750 i 2035. */
  function taxRateNominal(year) {
    if (year < 2030) return 0;
    if (year >= 2035) return 750;
    return 300 + (year - 2030) * 90;
  }

  /** Andel af besætningen, der er påvirket af avlsfremgangen i et givet år. */
  function breedingEffect(year, perYear, c = CLIMATE_DEFAULTS) {
    const yrs = year - (c.startYear + c.lagYears) + 1;
    return yrs > 0 ? yrs * perYear : 0;
  }

  function climateProjection(cows, c = CLIMATE_DEFAULTS, fromYear = 2030, toYear = 2040) {
    const rows = [];
    let cumTax = 0, cumTaxSaved = 0, cumFeedSaved = 0;
    for (let y = fromYear; y <= toYear; y++) {
      const eff = taxRateNominal(y) * (1 - c.baseDeduction);
      const base = cows * c.emissionPerCowT;
      const taxBase = base * eff;
      const methaneRed = Math.min(0.5, breedingEffect(y, c.methaneGainPerYear, c));
      const taxWith = base * (1 - c.entericShare * methaneRed) * eff;
      const feedRed = Math.min(0.3, breedingEffect(y, c.feedGainPerYear, c));
      const feedSaved = cows * c.feedKgDMPerCowYear * c.feedPricePerKgDM * feedRed;
      cumTax += taxBase; cumTaxSaved += taxBase - taxWith; cumFeedSaved += feedSaved;
      rows.push({ year: y, effRate: eff, taxBase, taxWith, taxSaved: taxBase - taxWith, feedSaved, methaneRed, feedRed });
    }
    return { rows, cumTax, cumTaxSaved, cumFeedSaved };
  }

  // ---------------------------------------------------------------------------
  // 4) Tørstoftjek (Foderteknik / NIR)
  // ---------------------------------------------------------------------------
  const DRYMATTER_DEFAULTS = {
    cows: 250,
    dmiKg: 22,            // planlagt tørstofoptag kg TS/ko/dag
    silageShare: 0.60,    // andel af TS fra ensilage
    silageDMPct: 33,      // forventet tørstof% i ensilagen
    sdDMPoints: 2.5,      // spredning i tørstof% (procentpoint) fra læs til læs
    method: 'weekly',     // målemetode
    milkResponse: 1.4,    // kg EKM pr. kg TS ved underfodring
    milkPrice: 3.6,       // kr. pr. kg EKM
    feedPricePerKgDM: 2.0,
    compensation: 0.5,    // hvor meget koen selv udligner (0-1)
    overfeedWaste: 0.5,   // andel af overfodring der er spild
  };

  // Hvor stor en del af variationen der IKKE fanges af målemetoden
  const MEASURE_METHODS = {
    never:   { label: 'Måler ikke / ved ikke', short: 'Måler ikke', residual: 1.00 },
    monthly: { label: 'Månedlig foderanalyse', short: 'Månedligt', residual: 0.90 },
    weekly:  { label: 'Ugentlig måling (mikroovn/Koster)', short: 'Ugentligt', residual: 0.60 },
    twice:   { label: '2-3 gange om ugen', short: '2-3 × ugl.', residual: 0.45 },
    nir:     { label: 'NIR ved hver blanding', short: 'NIR', residual: 0.15 },
  };

  /**
   * Fejl i tørstof% betyder, at koen får mere eller mindre TS end planlagt,
   * fordi foderet doseres efter friskvægt.
   *  SD for fejl i TS pr. ko/dag = TS fra ensilage × (SD tørstof% / tørstof%) × residual
   *  Gennemsnitlig absolut fejl = SD × √(2/π)  (normalfordelt fejl)
   *  Halvdelen af tiden underfodring: tabt mælk − sparet foder
   *  Halvdelen af tiden overfodring: spildt foder
   */
  function dryMatterCost(p = DRYMATTER_DEFAULTS, method = p.method) {
    const silageDM = p.dmiKg * p.silageShare;
    const relSD = p.sdDMPoints / p.silageDMPct;
    const residual = MEASURE_METHODS[method].residual;
    const sdKg = silageDM * relSD * residual;
    const meanAbs = sdKg * Math.sqrt(2 / Math.PI);
    const under = 0.5 * meanAbs * (1 - p.compensation);
    const over = 0.5 * meanAbs;
    const underCost = under * Math.max(0, p.milkResponse * p.milkPrice - p.feedPricePerKgDM);
    const overCost = over * p.feedPricePerKgDM * p.overfeedWaste;
    const perCowDay = underCost + overCost;
    const perYear = perCowDay * p.cows * 365;
    return { silageDM, sdKg, meanAbs, perCowDay, perYear, milkLostKgYear: under * p.milkResponse * p.cows * 365 };
  }

  function dryMatterComparison(p = DRYMATTER_DEFAULTS) {
    const out = {};
    for (const m of Object.keys(MEASURE_METHODS)) out[m] = dryMatterCost(p, m);
    const current = out[p.method];
    return { byMethod: out, current, savingWithNIR: current.perYear - out.nir.perYear };
  }

  // ---------------------------------------------------------------------------
  // 5) Leadscore
  // ---------------------------------------------------------------------------
  /**
   * Point 0-100. Størrelse (maks 30), behov (maks 40), engagement (maks 30).
   */
  function leadScore({ cows = 0, heiferBalancePct = 0, genomicNet = 0, drySaving = 0, toolsCompleted = 0, wantsContact = false, quizAnswers = {} }) {
    let size = cows >= 400 ? 30 : cows >= 250 ? 24 : cows >= 150 ? 16 : cows >= 80 ? 8 : 3;
    let need = 0;
    if (Math.abs(heiferBalancePct) > 0.10) need += 15; else if (Math.abs(heiferBalancePct) > 0.05) need += 8;
    if (genomicNet > 0) need += 10;
    if (drySaving > 50000) need += 10; else if (drySaving > 20000) need += 5;
    if (quizAnswers.genomic === 'no') need += 5;
    need = Math.min(40, need);
    let eng = Math.min(20, toolsCompleted * 5) + (wantsContact ? 10 : 0);
    const score = Math.round(size + need + eng);
    const tier = score >= 70 ? 'Varm' : score >= 45 ? 'Lun' : 'Kold';
    return { score, tier, parts: { size, need, eng } };
  }


  // ---------------------------------------------------------------------------
  // 2b) "Hvem skal have kønssorteret?" – klassificering med og uden test
  // ---------------------------------------------------------------------------
  /** Deterministisk RNG (mulberry32), så eksempler er ens hver gang. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Simulerer n kviekalve: sand avlsværdi (NTM) og to skøn med korrelation
   * rPA (afstamning) og rG (genomisk) til den sande værdi.
   *   skøn = r·sand + √(1−r²)·σ·støj   ⇒  corr(skøn, sand) = r
   */
  function simulateCalves(n, rPA, rG, sd, seed) {
    const rng = mulberry32(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = gauss(rng) * sd;
      const pa = rPA * t + Math.sqrt(1 - rPA * rPA) * sd * gauss(rng);
      const g = rG * t + Math.sqrt(1 - rG * rG) * sd * gauss(rng);
      out.push({ id: i + 1, true: t, pa, g });
    }
    return out;
  }
  const topK = (calves, key, k) => new Set([...calves].sort((a, b) => b[key] - a[key]).slice(0, k).map((c) => c.id));
  const meanOf = (calves, ids) => { let s = 0; for (const c of calves) if (ids.has(c.id)) s += c.true; return ids.size ? s / ids.size : 0; };

  /** Klassificér én flok: hvem får kønssorteret (top k) med hvert skøn, og hvor mange er rigtige. */
  function classifyHerd(calves, k) {
    const truth = topK(calves, 'true', k), pa = topK(calves, 'pa', k), g = topK(calves, 'g', k);
    const hits = (set) => [...set].filter((id) => truth.has(id)).length;
    return { truth, pa, g, hitsPA: hits(pa), hitsG: hits(g), meanPA: meanOf(calves, pa), meanG: meanOf(calves, g), meanTrue: meanOf(calves, truth) };
  }

  /**
   * Forventet andel rigtige valg og NTM-niveau blandt de valgte, gennemsnit over mange flokke.
   * Returnerer også et repræsentativt eksempel (den flok der ligger tættest på gennemsnittet).
   */
  function selectionAccuracy({ n = 20, share = 0.5, rPA = 0.55, rG = 0.80, sd = 10, sims = 2000, seed = 7 } = {}) {
    const k = Math.max(1, Math.min(n - 1, Math.round(n * share)));
    let hPA = 0, hG = 0, mPA = 0, mG = 0;
    for (let i = 0; i < sims; i++) {
      const r = classifyHerd(simulateCalves(n, rPA, rG, sd, seed + i), k);
      hPA += r.hitsPA; hG += r.hitsG; mPA += r.meanPA; mG += r.meanG;
    }
    const res = { n, k, hitsPA: hPA / sims, hitsG: hG / sims, meanPA: mPA / sims, meanG: mG / sims };
    // repræsentativt eksempel
    let best = null;
    for (let s = 1000; s < 1300; s++) {
      const calves = simulateCalves(n, rPA, rG, sd, s);
      const r = classifyHerd(calves, k);
      const dist = Math.abs(r.hitsPA - res.hitsPA) + Math.abs(r.hitsG - res.hitsG);
      if (!best || dist < best.dist) best = { dist, seed: s, calves, ...r };
    }
    res.example = best;
    return res;
  }

  // ---------------------------------------------------------------------------
  // 2c) Arla klimapoint for genomisk test (sats indtastes af brugeren)
  // ---------------------------------------------------------------------------
  /** Årlig værdi = årskøer × leveret mælk pr. ko × sats (øre/kg) ÷ 100. */
  function arlaClimateValue({ cows, milkKgPerCow, oerePerKg }) {
    if (!(oerePerKg > 0) || !(milkKgPerCow > 0) || !(cows > 0)) return 0;
    return cows * milkKgPerCow * oerePerKg / 100;
  }

  const api = {
    DEFAULTS, GENOMIC_DEFAULTS, NTM_VALUE_BY_BREED, CLIMATE_DEFAULTS, DRYMATTER_DEFAULTS, MEASURE_METHODS,
    heiferBalance, recommendStrategy, heiferBreakEven,
    invNorm, selectionIntensity, genomicValue, genomicScenario, genomicOptimum,
    mulberry32, simulateCalves, classifyHerd, selectionAccuracy, arlaClimateValue,
    taxRateNominal, breedingEffect, climateProjection,
    dryMatterCost, dryMatterComparison, leadScore, clamp,
  };
  root.VKCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
