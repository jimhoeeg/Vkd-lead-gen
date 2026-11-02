import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../js/calc.js');

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const { DEFAULTS: D } = C;

test('selektionsintensitet matcher kendte tabelværdier', () => {
  close(C.selectionIntensity(0.5), 0.7979, 1e-3);
  close(C.selectionIntensity(0.2), 1.3998, 1e-3);
  close(C.selectionIntensity(0.1), 1.7550, 1e-3);
  assert.equal(C.selectionIntensity(1), 0);
});

test('kviebalance: håndregnet eksempel', () => {
  const r = C.heiferBalance(D.herd, D.strategy);
  const calvings = 250 * 12 / 13;
  close(r.calvings, calvings);
  close(r.firstCalvings, 95);
  const fem = 95 * (0.3 * 0.9 + 0.7 * 0.47) + (calvings - 95) * (0.1 * 0.9 + 0.5 * 0.47);
  close(r.heiferCalvesBorn, fem);
  close(r.heifersToCalving, fem * 0.92 * 0.94);
  close(r.balance, fem * 0.92 * 0.94 - 95);
  // alle kalve skal være talt med
  close(r.heiferCalvesBorn + r.bullCalvesBorn + r.beefCalvesBorn, calvings);
  assert.ok(r.balance < 0, 'standardeksemplet viser underskud af kvier');
});

test('anbefalet strategi rammer behov + buffer præcist', () => {
  const rec = C.recommendStrategy(D.herd, 0.05);
  const r = C.heiferBalance(D.herd, rec.strategy);
  close(r.heifersToCalving, 95 * 1.05, 1e-6);
  assert.ok(rec.feasible);
  assert.equal(rec.strategy.heifer.sexed, 1);
  assert.ok(rec.strategy.cow.sexed > 0 && rec.strategy.cow.sexed < 1);
  close(rec.strategy.cow.sexed + rec.strategy.cow.beef, 1);
});

test('anbefaling med lav udskiftning bruger kun kønssorteret på en del af kvierne', () => {
  const herd = { ...D.herd, replacementRate: 0.25, calvingIntervalMonths: 12 };
  const rec = C.recommendStrategy(herd, 0.0);
  // kvier alene kan dække: 62,5 × 0,9 × 0,8648 = 48,6 > 62,5? nej → tjek begge veje
  const r = C.heiferBalance(herd, rec.strategy);
  close(r.heifersToCalving, herd.cows * 0.25, 1e-6);
});

test('anbefaling flagger når behovet ikke kan dækkes', () => {
  const herd = { cows: 100, replacementRate: 0.9, calvingIntervalMonths: 14 };
  const rec = C.recommendStrategy(herd, 0.05);
  assert.equal(rec.feasible, false);
});

test('anbefalet strategi giver bedre økonomi end standard-udgangspunktet', () => {
  const cur = C.heiferBalance(D.herd, D.strategy);
  const rec = C.heiferBalance(D.herd, C.recommendStrategy(D.herd).strategy);
  assert.ok(rec.net > cur.net, `${rec.net} > ${cur.net}`);
  assert.ok(rec.beefCalvesSold > cur.beefCalvesSold);
});

test('overskud af kvier koster når salgspris < opdræt', () => {
  const strat = { heifer: { sexed: 1, conv: 0, beef: 0 }, cow: { sexed: 1, conv: 0, beef: 0 } };
  const r = C.heiferBalance(D.herd, strat);
  assert.ok(r.balance > 0);
  close(r.heiferValue, r.balance * (D.prices.heiferSale - D.prices.rearingCost));
  assert.ok(r.heiferValue < 0);
});

test('genomisk værdi: ingen beslutning → ingen værdi', () => {
  const g = C.genomicValue({ tested: 95, kept: 95, sexedShare: 1 });
  assert.equal(g.value, 0);
  assert.ok(g.net < 0);
});

test('genomisk værdi stiger med selektionsmulighed', () => {
  const a = C.genomicValue({ tested: 100, kept: 95, sexedShare: 0.6 });
  const b = C.genomicValue({ tested: 130, kept: 95, sexedShare: 0.4 });
  assert.ok(b.value > a.value);
  // håndregning for kvie-delen
  const i = C.selectionIntensity(95 / 130);
  close(b.gainKeepNTM, i * 0.25 * 10, 1e-9);
});

test('selektionsrum: overskud sælges som kviekalve og optimum findes', () => {
  const sc = C.genomicScenario(D.herd, 0.2);
  assert.ok(sc.hb.balance > 0);
  close(sc.hb.heiferValue, (sc.hb.balance / 0.94) * D.prices.heiferCalf);
  close(sc.genomic.kept, 95 / 0.94);
  const opt = C.genomicOptimum(D.herd);
  assert.ok(opt.points.length > 5);
  assert.ok(opt.points.every((p) => p.total <= opt.best.total));
});

test('afgiftssatser: 300 → 750 kr./t, bundfradrag 60 %', () => {
  assert.equal(C.taxRateNominal(2029), 0);
  assert.equal(C.taxRateNominal(2030), 300);
  assert.equal(C.taxRateNominal(2035), 750);
  assert.equal(C.taxRateNominal(2040), 750);
  const p = C.climateProjection(1);
  close(p.rows[0].taxBase, 5.6 * 120); // 672 kr. pr. ko i 2030
  close(p.rows[5].taxBase, 5.6 * 300); // 1.680 kr. pr. ko i 2035
});

test('avlseffekt starter først efter forsinkelsen', () => {
  assert.equal(C.breedingEffect(2029, 0.01), 0);
  close(C.breedingEffect(2030, 0.01), 0.01);
  close(C.breedingEffect(2035, 0.01), 0.06);
  const p = C.climateProjection(250);
  assert.ok(p.rows.every((r) => r.taxWith <= r.taxBase));
});

test('tørstof: NIR er billigst og omkostning skalerer med spredning', () => {
  const cmp = C.dryMatterComparison();
  assert.ok(cmp.byMethod.nir.perYear < cmp.byMethod.weekly.perYear);
  assert.ok(cmp.byMethod.weekly.perYear < cmp.byMethod.never.perYear);
  const lo = C.dryMatterCost({ ...C.DRYMATTER_DEFAULTS, sdDMPoints: 1 });
  const hi = C.dryMatterCost({ ...C.DRYMATTER_DEFAULTS, sdDMPoints: 3 });
  close(hi.perYear / lo.perYear, 3, 1e-9);
});

test('leadscore holder sig i 0-100', () => {
  const max = C.leadScore({ cows: 900, heiferBalancePct: -0.3, genomicNet: 1, drySaving: 1e6, toolsCompleted: 10, wantsContact: true, quizAnswers: { genomic: 'no' } });
  assert.ok(max.score <= 100 && max.tier === 'Varm');
  const min = C.leadScore({});
  assert.ok(min.score >= 0 && min.tier === 'Kold');
});

test('udskriv nøgletal for standardbesætning (til dokumentation)', () => {
  const cur = C.heiferBalance(D.herd, D.strategy);
  const rec = C.recommendStrategy(D.herd);
  const r2 = C.heiferBalance(D.herd, rec.strategy);
  const opt = C.genomicOptimum(D.herd);
  const g = { value: opt.best.gain, cost: opt.best.cost, net: opt.best.total - opt.base, sexedShare: opt.best.buffer };
  const cl = C.climateProjection(250);
  const dm = C.dryMatterComparison();
  console.log(JSON.stringify({
    nu: { balance: cur.balance.toFixed(1), net: Math.round(cur.net), semen: Math.round(cur.semenCost) },
    anbefalet: { mix: rec.strategy, balance: r2.balance.toFixed(1), net: Math.round(r2.net), semen: Math.round(r2.semenCost) },
    forskel: Math.round(r2.net - cur.net),
    genomisk: { value: Math.round(g.value), cost: Math.round(g.cost), net: Math.round(g.net), sexedShare: r2.sexedShareOfCalvings.toFixed(2) },
    klima: { afgift2030: Math.round(cl.rows[0].taxBase), afgift2035: Math.round(cl.rows[5].taxBase), sparetAfgift: Math.round(cl.cumTaxSaved), sparetFoder: Math.round(cl.cumFeedSaved), afgiftIalt: Math.round(cl.cumTax) },
    toerstof: { nu: Math.round(dm.current.perYear), nir: Math.round(dm.byMethod.nir.perYear), besparelse: Math.round(dm.savingWithNIR) },
  }, null, 1));
});
