/* Avlsværktøjet – flow, UI og state. Beregninger ligger i calc.js. */
(function () {
  'use strict';
  const C = window.VKCalc, CH = window.VKCharts, EN = window.VKEngage, D = C.DEFAULTS;
  const deep = (o) => JSON.parse(JSON.stringify(o));
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- formattering
  const nf = (d = 0) => new Intl.NumberFormat('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = (v, d = 0) => nf(d).format(v);
  const kr = (v) => `${num(Math.round(v))} kr.`;
  const krS = (v) => `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${num(Math.abs(Math.round(v)))} kr.`;
  const pct = (v, d = 0) => `${num(v * 100, d)} %`;
  const axisKr = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return `${num(v / 1e6, 1)} mio.`;
    if (a >= 1000) return `${num(v / 1000)} t.`;
    return num(v);
  };
  const signNum = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)}`;

  // ---------------------------------------------------------------- state
  const KEY = 'vk-leadgen-v1';
  const initial = () => ({
    step: 0,
    quiz: { i: 0, answers: {}, done: false },
    herd: deep(D.herd),
    breed: 'holstein',
    strategy: deep(D.strategy),
    originalStrategy: null,
    prices: deep(D.prices),
    biology: deep(D.biology),
    buffer: D.buffer,
    genomic: deep(C.GENOMIC_DEFAULTS),
    genBuffer: 0,
    lasting: false,
    climate: deep(C.CLIMATE_DEFAULTS),
    dm: deep(C.DRYMATTER_DEFAULTS),
    visited: [],
    interests: { plan: true, test: false, nir: false, climate: false },
    contact: { name: '', farm: '', cvr: '', phone: '', email: '', zip: '', note: '', consent: false, mailOptIn: false },
    booking: { type: 'visit', slot: null, callbackWhen: 'Formiddag (8-12)' },
    submitted: false,
    submittedAt: null,
    restored: false,
  });
  let S;
  try { S = Object.assign(initial(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch (e) { S = initial(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignorer */ } };

  const getPath = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), S);
  const setPath = (p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };

  // ---------------------------------------------------------------- afledte resultater
  function results() {
    const cur = C.heiferBalance(S.herd, S.strategy, S.biology, S.prices);
    const recInfo = C.recommendStrategy(S.herd, S.buffer, S.biology);
    const rec = C.heiferBalance(S.herd, recInfo.strategy, S.biology, S.prices);
    const g = { ...S.genomic, generationFactor: S.lasting ? 1.5 : 1 };
    const gs = C.genomicScenario(S.herd, S.genBuffer, g, S.biology, S.prices);
    const gopt = C.genomicOptimum(S.herd, g, S.biology, S.prices);
    const clim = C.climateProjection(S.herd.cows, S.climate);
    const dm = C.dryMatterComparison({ ...S.dm, cows: S.herd.cows });
    // Udgangspunkt: brugerens oprindelige strategi, også efter de har valgt anbefalingen
    const orig = S.originalStrategy ? C.heiferBalance(S.herd, S.originalStrategy, S.biology, S.prices) : cur;
    const potential = rec.net - orig.net;
    return { cur, rec, recInfo, gs, gopt, g, clim, dm, orig, potential };
  }

  // ---------------------------------------------------------------- UI-byggeklodser
  function slider({ path, label, min, max, step, unit = '', pct: isPct = false, help = '', dec, live = true }) {
    const raw = getPath(path);
    const shown = isPct ? raw * 100 : raw;
    const d = dec != null ? dec : (step < 1 ? (String(step).split('.')[1] || '').length : 0);
    const id = 'f-' + path.replace(/\./g, '-');
    return `<div class="field">
      <label for="${id}"><span>${label}</span><span class="val" data-val-for="${path}">${num(shown, d)}${unit ? ' ' + unit : ''}</span></label>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${shown}" data-path="${path}" data-pct="${isPct ? 1 : 0}" data-dec="${d}" data-unit="${esc(unit)}" ${live ? 'data-live="1"' : ''}>
      ${help ? `<div class="help">${help}</div>` : ''}
    </div>`;
  }
  function numberField({ path, label, unit = '', step = 1, help = '' }) {
    const id = 'f-' + path.replace(/\./g, '-');
    return `<div class="field"><label for="${id}"><span>${label}</span></label>
      <div class="inline-num"><input id="${id}" type="number" step="${step}" value="${getPath(path)}" data-path="${path}" data-live="1" inputmode="decimal"><span class="muted small">${unit}</span></div>
      ${help ? `<div class="help">${help}</div>` : ''}</div>`;
  }
  const learn = (title, body, open = false) => `<details class="learn"${open ? ' open' : ''}><summary>${title}</summary><div class="body">${body}</div></details>`;
  const stat = (k, v, s = '', cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

  function mixControl(group, title) {
    const m = S.strategy[group];
    return `<div class="mix" data-mixbox="${group}">
      <div class="lbl" style="font-weight:600">${title}</div>
      <div class="mixbar" id="mixbar-${group}">${mixBarInner(m)}</div>
      <div class="field"><label for="mix-${group}-sexed"><span><span class="dot c-sexed"></span>Kønssorteret malkerace</span><span class="val" id="mixv-${group}-sexed">${pct(m.sexed)}</span></label>
        <input id="mix-${group}-sexed" type="range" min="0" max="100" step="5" value="${Math.round(m.sexed * 100)}" data-mix="${group}" data-kind="sexed"></div>
      <div class="field"><label for="mix-${group}-beef"><span><span class="dot c-beef"></span>Kødkvæg (krydsning)</span><span class="val" id="mixv-${group}-beef">${pct(m.beef)}</span></label>
        <input id="mix-${group}-beef" type="range" min="0" max="100" step="5" value="${Math.round(m.beef * 100)}" data-mix="${group}" data-kind="beef"></div>
      <div class="mix-legend"><span><span class="dot c-conv"></span>Konventionel malkerace: <b id="mixv-${group}-conv">${pct(m.conv)}</b></span></div>
    </div>`;
  }
  const mixBarInner = (m) => ['sexed', 'conv', 'beef'].filter((k) => m[k] > 0.001)
    .map((k) => `<span class="c-${k}" style="width:${m[k] * 100}%" title="${k}"></span>`).join('');
  const mixText = (m) => `${pct(m.sexed)} kønssort. · ${pct(m.conv)} konv. · ${pct(m.beef)} kød`;

  // ---------------------------------------------------------------- trin 0: besætningstjek
  const QUIZ = [
    { id: 'cows', q: 'Hvor mange årskøer har du?', type: 'number', help: 'Alle beregnerne bruger tallet, så resultaterne passer til din besætning.' },
    { id: 'breed', q: 'Hvilken race dominerer i besætningen?', options: [['holstein', 'Holstein', 'VikingHolstein'], ['rdm', 'Rød Dansk', 'VikingRed'], ['jersey', 'Jersey', 'VikingJersey'], ['kryds', 'Krydsning', 'Fx ProCross / 3-race']] },
    { id: 'heifers', q: 'Passer dit antal kvier til behovet?', options: [['short', 'Jeg mangler kvier', 'Køber til eller beholder køer for længe'], ['ok', 'Det passer nogenlunde', ''], ['surplus', 'Jeg har for mange', 'Opdrætter flere, end jeg bruger'], ['unknown', 'Ved ikke præcist', '']] },
    { id: 'sexed', q: 'Bruger du kønssorteret sæd i dag?', options: [['targeted', 'Ja, målrettet', 'På kvier og de bedste køer'], ['some', 'Lidt', 'En gang imellem'], ['no', 'Nej', 'Kun konventionel og evt. kødkvæg']] },
    { id: 'genomic', q: 'Genomtester du dine kviekalve?', options: [['all', 'Ja, alle', ''], ['some', 'Nogle af dem', ''], ['no', 'Nej', '']] },
    { id: 'dm', q: 'Hvordan følger du tørstof i ensilage og fuldfoder?', options: [['nir', 'NIR ved hver blanding', ''], ['weekly', 'Måler cirka ugentligt', 'Mikroovn, Koster-tester el.lign.'], ['monthly', 'Foderanalyse en gang imellem', ''], ['never', 'Måler ikke / ved ikke', '']] },
    { id: 'focus', q: 'Hvad fylder mest for dig de næste 5 år?', options: [['climate', 'Klimaafgiften fra 2030', ''], ['economy', 'Økonomien i kalve og kvier', ''], ['genetics', 'Bedre køer', 'Sundhed, holdbarhed, ydelse'], ['feed', 'Foderudnyttelse', 'Og foderomkostninger']] },
  ];
  const SEXED_PRESETS = {
    targeted: { heifer: { sexed: 0.8, conv: 0.2, beef: 0 }, cow: { sexed: 0.15, conv: 0.35, beef: 0.5 } },
    some: deep(D.strategy),
    no: { heifer: { sexed: 0, conv: 1, beef: 0 }, cow: { sexed: 0, conv: 0.7, beef: 0.3 } },
  };
  const AREAS = {
    kvier: { name: 'Kvier & kalve', profile: 'Kvie-strategen', step: 1, text: 'Din største gevinst ligger sandsynligvis i at ramme præcis det antal kvier, du har brug for, og gøre resten af kalvene mere værd.' },
    genetik: { name: 'Genetik', profile: 'Genetik-optimereren', step: 2, text: 'Du kan få mere ud af dine avlsbeslutninger ved at vide, hvilke dyr der skal være mødre til næste generation.' },
    klima: { name: 'Klima', profile: 'Klima-forberederen', step: 3, text: 'Afgiften fra 2030 bliver en fast udgift. Avl virker langsomt, men den virker hvert år, og den virker for altid. Derfor skal valgene træffes nu.' },
    foder: { name: 'Foder', profile: 'Foder-præcisionisten', step: 4, text: 'Der er sandsynligvis penge at hente i at give køerne præcis den ration, du har planlagt, hver dag.' },
  };
  function quizScores(a) {
    const s = { kvier: 40, genetik: 40, klima: 50, foder: 40 };
    if (a.heifers === 'short' || a.heifers === 'surplus') s.kvier = 90; else if (a.heifers === 'unknown') s.kvier = 70; else if (a.heifers === 'ok') s.kvier = 35;
    if (a.sexed === 'no') s.kvier += 10;
    s.genetik = a.genomic === 'no' ? 85 : a.genomic === 'some' ? 60 : a.genomic === 'all' ? 30 : 40;
    if (a.focus === 'genetics') s.genetik += 15;
    if (a.focus === 'climate') s.klima = 90;
    s.foder = { never: 90, monthly: 75, weekly: 50, nir: 15 }[a.dm] ?? 40;
    if (a.focus === 'feed') s.foder += 10;
    if (a.focus === 'economy') s.kvier += 10;
    for (const k of Object.keys(s)) s[k] = Math.min(100, s[k]);
    const top = Object.keys(s).sort((x, y) => s[y] - s[x]);
    return { s, top };
  }
  function applyQuiz() {
    const a = S.quiz.answers;
    if (a.cows) { S.herd.cows = a.cows; }
    if (a.breed) { S.breed = a.breed; S.genomic.krPerNTMYear = C.NTM_VALUE_BY_BREED[a.breed]; }
    if (a.sexed) { S.strategy = deep(SEXED_PRESETS[a.sexed]); S.originalStrategy = null; }
    if (a.dm) S.dm.method = a.dm;
    if (a.focus === 'climate') S.interests.climate = true;
    if (a.genomic === 'no') S.interests.test = true;
    if (a.dm === 'never' || a.dm === 'monthly') S.interests.nir = true;
  }

  function renderQuiz() {
    const q = S.quiz;
    if (q.done) return renderQuizResult();
    const item = QUIZ[q.i];
    const val = q.answers[item.id];
    let body;
    if (item.type === 'number') {
      const v = val || S.herd.cows;
      body = `<div class="field" style="max-width:420px">
        <label for="quizCows"><span>Antal årskøer</span><span class="val" id="quizCowsVal">${num(v)} køer</span></label>
        <input id="quizCows" type="range" min="30" max="1500" step="10" value="${v}">
        <div class="help">${item.help}</div></div>
        <div class="btn-row"><span></span><button class="btn btn-primary" data-action="quiz-next">Næste →</button></div>`;
    } else {
      body = `<div class="options">${item.options.map(([k, t, s]) =>
        `<button class="option" data-action="quiz-pick" data-value="${k}" aria-pressed="${val === k}"><strong>${t}</strong>${s ? `<span>${s}</span>` : ''}</button>`).join('')}</div>
        <div class="btn-row"><button class="btn btn-ghost" data-action="quiz-back" ${q.i === 0 ? 'disabled' : ''}>← Tilbage</button></div>`;
    }
    return `<section class="card hero">
      <div class="eyebrow">Besætningstjek · 2 minutter</div>
      <h1>Hvor ligger de skjulte penge i din besætning?</h1>
      <p class="lead">Svar på 7 korte spørgsmål. Så forudfylder vi beregnerne med dine tal og viser, hvor du bør starte.</p>
    </section>
    <section class="card">
      <div class="muted small">Spørgsmål ${q.i + 1} af ${QUIZ.length}</div>
      <div class="quiz-progress"><span style="width:${(q.i / QUIZ.length) * 100}%"></span></div>
      <h2>${item.q}</h2>
      ${body}
    </section>`;
  }

  function renderQuizResult() {
    const { s, top } = quizScores(S.quiz.answers);
    const main = AREAS[top[0]];
    return `<section class="card hero">
      <div class="eyebrow">Dit resultat</div>
      <h1>Du er ${main.profile.toLowerCase()}</h1>
      <p class="lead">${main.text}</p>
      <div class="btn-row" style="justify-content:flex-start">
        <button class="btn btn-primary" data-action="goto" data-step="${main.step}">Start med ${STEPS[main.step].title.toLowerCase()} →</button>
        <button class="btn btn-ghost" data-action="quiz-restart">Tag tjekket igen</button>
      </div>
    </section>
    <section class="card">
      <h2>Hvor er potentialet størst?</h2>
      <p class="muted small">Ud fra dine svar. Beregnerne er nu forudfyldt med ${num(S.herd.cows)} årskøer og dine valg.</p>
      ${top.map((k) => `<div class="area-row"><span>${AREAS[k].name}</span><div class="meter"><span style="width:${s[k]}%"></span></div><b>${s[k]}</b></div>`).join('')}
    </section>
    <section class="card">
      <h2>Dine fire beregnere</h2>
      <div class="grid-2">
        ${[1, 2, 3, 4].map((i) => `<button class="option" data-action="goto" data-step="${i}"><strong>${i}. ${STEPS[i].title}</strong><span>${STEPS[i].teaser}</span></button>`).join('')}
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- trin 1: kvieplan
  function renderHeifer() {
    return `<section class="card hero">
      <div class="eyebrow">Beregner 1 · Kvieplan</div>
      <h1>Lav præcis de kvier, du har brug for</h1>
      <p class="lead">Hver kælvning er et valg: en kviekalv til egen besætning, en malkeracetyrekalv eller en krydsningskalv, der er mere værd. Indstil din strategi og se din kviebalance og din kalveøkonomi.</p>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>Din besætning</h2>
        ${slider({ path: 'herd.cows', label: 'Årskøer', min: 30, max: 1500, step: 10, unit: 'køer' })}
        ${slider({ path: 'herd.replacementRate', label: 'Udskiftningsprocent', min: 20, max: 55, step: 1, unit: '%', pct: true, help: 'Andel af køerne, der udskiftes med en førstekalvskvie pr. år. Landsgennemsnittet ligger omkring 35-40 %.' })}
        ${slider({ path: 'herd.calvingIntervalMonths', label: 'Kælvningsinterval', min: 11.5, max: 15, step: 0.1, unit: 'mdr.', help: 'Kortere interval giver flere kælvninger og dermed flere kalve at vælge imellem.' })}
        ${learn('Hvad betyder udskiftningsprocenten for kvierne?', `<p>Har du 250 køer og 38 % udskiftning, skal der kælve ca. <b>95 kvier om året</b>. Kvierne kommer fra kælvninger, hvor der er brugt malkeracesæd. Ved konventionel sæd bliver ca. 47 % kviekalve, ved kønssorteret ca. 90 %.</p><p>Undervejs mister man kalve. Nogle er dødfødte, nogle dør som små, og nogle kvier bliver aldrig drægtige. Derfor skal der fødes flere kviekalve, end der skal bruges.</p>`)}
      </section>
      <section class="card">
        <h2>Din inseminering i dag</h2>
        ${mixControl('heifer', 'Kvier (1. inseminering)')}
        <div style="height:10px"></div>
        ${mixControl('cow', 'Køer')}
        <details class="learn"><summary>Dine priser og antagelser</summary><div class="body">
          <div class="grid-2">
            ${numberField({ path: 'prices.straw.sexed', label: 'Kønssorteret strå', unit: 'kr.' })}
            ${numberField({ path: 'prices.straw.conv', label: 'Konventionelt strå', unit: 'kr.' })}
            ${numberField({ path: 'prices.straw.beef', label: 'Kødkvægsstrå', unit: 'kr.' })}
            ${numberField({ path: 'prices.inseminationFee', label: 'Inseminering', unit: 'kr./ins.' })}
            ${numberField({ path: 'prices.beefCalf', label: 'Krydsningskalv', unit: 'kr.' })}
            ${numberField({ path: 'prices.dairyBullCalf', label: 'Malkeracetyrekalv', unit: 'kr.' })}
            ${numberField({ path: 'prices.rearingCost', label: 'Opdræt af én kvie', unit: 'kr.' })}
            ${numberField({ path: 'prices.heiferSale', label: 'Salg af drægtig kvie', unit: 'kr.' })}
            ${numberField({ path: 'prices.heiferBuy', label: 'Køb af drægtig kvie', unit: 'kr.' })}
          </div>
          <p class="small muted">Drægtighed pr. insemination: kvier ${pct(S.biology.conception.heifer.conv)} (konv.) / ${pct(S.biology.conception.heifer.sexed)} (kønssort.), køer ${pct(S.biology.conception.cow.conv)} / ${pct(S.biology.conception.cow.sexed)}. Kalvetab ${pct(S.biology.calfLoss)}, opdrætstab ${pct(S.biology.rearingLoss)}. Alle værdier er eksempler.</p>
        </div></details>
      </section>
    </div>
    <div id="results"></div>`;
  }

  function heiferResults(R) {
    const { cur, rec, recInfo } = R;
    const bal = cur.balance;
    const balCls = Math.abs(cur.balancePct) <= 0.05 ? 'good' : 'bad';
    const diff = rec.net - cur.net;
    const rs = recInfo.strategy;
    const row = (label, a, b, f = (v) => num(v), cls = false) => {
      const d = b - a;
      return `<tr><td>${label}</td><td>${f(a)}</td><td>${f(b)}</td><td class="${cls ? (d > 0.5 ? 'pos' : d < -0.5 ? 'neg' : '') : ''}">${cls ? (Math.abs(d) < 0.5 ? '–' : (d > 0 ? '+' : '−') + f(Math.abs(d))) : ''}</td></tr>`;
    };
    let msg;
    if (bal < -0.5) msg = `<div class="callout bad"><b>Du mangler ca. ${num(-bal)} kvier om året.</b> De skal købes til ca. ${kr(S.prices.heiferBuy)} stykket, eller køerne skal blive længere i besætningen. Indkøbte dyr kan også bringe smitte ind. Kønssorteret sæd på flere af de bedste dyr lukker hullet.</div>`;
    else if (cur.balancePct > 0.05) msg = `<div class="callout"><b>Du laver ca. ${num(bal)} kvier mere, end du skal bruge.</b> Hver ekstra kvie koster ca. ${kr(S.prices.rearingCost)} at opdrætte, og du kan sælge den for ca. ${kr(S.prices.heiferSale)}. Hvis de kælvninger i stedet havde givet krydsningskalve, kunne kalvene være solgt efter få uger.</div>`;
    else msg = `<div class="callout good"><b>Din kviebalance rammer behovet.</b> Se nedenfor, om du kan nå det samme med færre strå og flere krydsningskalve.</div>`;

    return `<section class="card">
      ${S.originalStrategy ? `<div class="callout good no-print">Du har valgt den anbefalede strategi. Dit udgangspunkt var: kvier ${mixText(S.originalStrategy.heifer)}, køer ${mixText(S.originalStrategy.cow)}. Gevinst i forhold til udgangspunktet: <b>${krS(R.potential)}</b> pr. år. <button class="linkbtn" data-action="restore-orig">Gå tilbage til min oprindelige strategi</button></div>` : ''}
      <h2>Din kviebalance ${S.originalStrategy ? 'med den valgte strategi' : 'i dag'}</h2>
      <div class="grid-4">
        ${stat('Kælvninger pr. år', num(cur.calvings), `${num(cur.firstCalvings)} førstekælvere`)}
        ${stat('Kvier der skal bruges', num(cur.need), 'pr. år')}
        ${stat('Kvier du får frem', num(cur.heifersToCalving), 'til kælvning pr. år')}
        ${stat('Balance', signNum(bal, 0) + ' kvier', pct(cur.balancePct) + ' af behovet', balCls)}
      </div>
      ${msg}
      <p class="small muted">Husk tidsforskydningen: En kalv, der bliver til i dag, fødes om 9 måneder og kælver selv ca. 2 år senere. Det, du vælger nu, rammer din kviebalance om ca. 3 år.</p>
    </section>

    <section class="card">
      <h2>Den anbefalede strategi</h2>
      <p>Kønssorteret sæd på de genetisk bedste hundyr, så du laver præcis de kvier, du skal bruge, plus en sikkerhedsmargin. Kødkvæg på resten. Konventionel malkeracesæd giver ca. 50 % tyrekalve med lav værdi og har ingen plads i planen.</p>
      ${slider({ path: 'buffer', label: 'Sikkerhedsmargin på kvier', min: 0, max: 20, step: 1, unit: '%', pct: true, help: 'Ekstra kvier ud over behovet, som sikkerhed mod tab og som valgmulighed (se Genomisk test).' })}
      ${!recInfo.feasible ? `<div class="callout bad">Med den udskiftningsprocent kan behovet ikke dækkes, selv med 100 % kønssorteret sæd. Udskiftningsprocenten bør ned, eller kælvningsintervallet bør forkortes.</div>` : ''}
      <div class="grid-2" style="margin:8px 0 14px">
        <div class="mix"><b>Kvier</b><div class="mixbar">${mixBarInner(rs.heifer)}</div><div class="small">${mixText(rs.heifer)}</div></div>
        <div class="mix"><b>Køer</b><div class="mixbar">${mixBarInner(rs.cow)}</div><div class="small">${mixText(rs.cow)}</div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Pr. år</th><th>I dag</th><th>Anbefalet</th><th>Forskel</th></tr></thead>
        <tbody>
          ${row('Kvier til kælvning', cur.heifersToCalving, rec.heifersToCalving, (v) => num(v), false)}
          ${row('Kviebalance', cur.balance, rec.balance, (v) => signNum(v, 0), false)}
          ${row('Krydsningskalve solgt', cur.beefCalvesSold, rec.beefCalvesSold, (v) => num(v), true)}
          ${row('Malkeracetyrekalve solgt', cur.bullCalvesSold, rec.bullCalvesSold, (v) => num(v), true)}
          ${row('Inseminationer', cur.inseminations, rec.inseminations, (v) => num(v), false)}
          ${row('Salg af krydsningskalve', cur.beefRevenue, rec.beefRevenue, kr, true)}
          ${row('Salg af tyrekalve', cur.bullRevenue, rec.bullRevenue, kr, true)}
          ${row('Kvieoverskud (+) / -underskud (−)', cur.heiferValue, rec.heiferValue, kr, true)}
          ${row('Sæd og inseminering', -cur.semenCost, -rec.semenCost, kr, true)}
          <tr class="total"><td>Netto kalveøkonomi</td><td>${kr(cur.net)}</td><td>${kr(rec.net)}</td><td class="${diff >= 0 ? 'pos' : 'neg'}">${krS(diff)}</td></tr>
        </tbody>
      </table></div>
      <div class="grid-3" style="margin-top:14px">
        ${stat('Forskel pr. år', krS(diff), 'anbefalet vs. i dag', diff >= 0 ? 'good' : 'bad')}
        ${stat('Pr. årsko', krS(diff / S.herd.cows), '')}
        ${stat('Over 5 år', krS(diff * 5), 'uden renter og prisændringer')}
      </div>
      <h3 style="margin-top:18px">Kalve pr. år</h3>
      ${CH.bars({
        categories: ['Kviekalve', 'Malkeracetyrekalve', 'Krydsningskalve'],
        series: [
          { name: 'I dag', color: 'var(--series-1)', values: [cur.heiferCalvesBorn, cur.bullCalvesBorn, cur.beefCalvesBorn] },
          { name: 'Anbefalet', color: 'var(--series-2)', values: [rec.heiferCalvesBorn, rec.bullCalvesBorn, rec.beefCalvesBorn] },
        ],
        fmt: (v) => num(v), ariaLabel: 'Kalve pr. år i dag og med anbefalet strategi',
      })}
      <div class="btn-row"><button class="btn btn-ghost" data-action="use-rec">Brug den anbefalede strategi som min</button><button class="btn btn-primary" data-action="goto" data-step="2">Næste: Genomisk test →</button></div>
    </section>

    <section class="card">
      <h2>Bliv klogere</h2>
      ${learn('Hvorfor kønssorteret sæd på kvierne først?', `<p>Kvier har den højeste drægtighedsprocent med kønssorteret sæd. Og fordi avlen går fremad hvert år, er kvierne i gennemsnit også de genetisk bedste dyr i besætningen. Kønssorteret sæd på kvierne giver derfor flest og bedste kviekalve pr. strå.</p>`)}
      ${learn('Hvad koster kønssorteret sæd, når drægtigheden er lavere?', `<p>Prisen pr. strå er kun halvdelen af regnestykket. Med ${pct(S.biology.conception.heifer.sexed)} drægtighed på kvier skal der i snit bruges ${num(1 / S.biology.conception.heifer.sexed, 1)} strå pr. drægtighed. Beregneren regner med prisen pr. <i>drægtighed</i>: (strå + inseminering) ÷ drægtighedsprocent.</p>`)}
      ${learn('Hvorfor kødkvæg på resten?', `<p>En krydsningskalv (fx Angus, Belgisk Blåhvid eller Limousine på malkeko) er typisk flere gange mere værd end en malkeracetyrekalv. Når du kun laver de kviekalve, du skal bruge, kan alle øvrige kælvninger give krydsningskalve.</p>`)}
      ${learn('Sådan regner beregneren', `<div class="formula">kælvninger      = køer × 12 ÷ kælvningsinterval
behov           = køer × udskiftningsprocent
kviekalve       = Σ kælvninger × andel sædtype × andel hunkøn
kvier til kælvn = kviekalve × (1 − kalvetab) × (1 − opdrætstab)
netto           = kalvesalg + kvieoverskud/-underskud − sæd og ins.</div><p class="small">Opdræt af de kvier, du <i>skal</i> bruge, er ens i alle strategier og indgår derfor ikke.</p>`)}
    </section>`;
  }

  // ---------------------------------------------------------------- trin 2: genomisk test
  function renderGenomic() {
    const breeds = [['holstein', 'Holstein'], ['rdm', 'Rød Dansk'], ['jersey', 'Jersey'], ['kryds', 'Krydsning']];
    return `<section class="card hero">
      <div class="eyebrow">Beregner 2 · Genomisk test</div>
      <h1>Hvad er en genomisk test værd for dig?</h1>
      <p class="lead">En test giver først værdi, når du bruger svaret til en beslutning. Hvilke kviekalve skal opdrættes? Hvilke hundyr skal have kønssorteret sæd, og hvilke skal have kødkvæg? Her kan du se, hvornår testen tjener sig hjem.</p>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>Indstillinger</h2>
        <div class="field"><div class="lbl">Race</div>
          <div class="seg" role="group" aria-label="Race">${breeds.map(([k, t]) => `<button data-action="breed" data-value="${k}" aria-pressed="${S.breed === k}">${t}</button>`).join('')}</div>
          <div class="help">Værdien af én NTM-enhed er ${kr(S.genomic.krPerNTMYear)} pr. årsko for den valgte race (Nordic EBV).</div></div>
        ${slider({ path: 'genomic.testPrice', label: 'Pris pr. test', min: 100, max: 400, step: 10, unit: 'kr.' })}
        ${slider({ path: 'genBuffer', label: 'Selektionsrum', min: 0, max: 30, step: 2.5, unit: '%', pct: true, dec: 1, help: 'Hvor mange flere kviekalve end behovet du laver, tester og vælger imellem. De dårligste sælges som kviekalve.' })}
        <label class="check"><input type="checkbox" data-action="lasting" ${S.lasting ? 'checked' : ''}><span><b>Medregn varig fremgang</b><br><span class="small muted">Døtrenes døtre arver også fremgangen. Værdien sættes 1,5 gange op.</span></span></label>
        <details class="learn"><summary>Avancerede antagelser</summary><div class="body">
          ${slider({ path: 'genomic.accParentAverage', label: 'Sikkerhed uden test (afstamning)', min: 0.3, max: 0.7, step: 0.01, dec: 2, help: 'Korrelation mellem indeks og sand avlsværdi. Afstamningsfejl trækker ned.' })}
          ${slider({ path: 'genomic.accGenomic', label: 'Sikkerhed med genomisk test', min: 0.6, max: 0.9, step: 0.01, dec: 2 })}
          ${slider({ path: 'genomic.sdNTM', label: 'Genetisk spredning', min: 6, max: 14, step: 1, unit: 'NTM' })}
          ${numberField({ path: 'genomic.krPerNTMYear', label: 'Kr. pr. NTM-enhed pr. årsko', unit: 'kr.' })}
        </div></details>
      </section>
      <section class="card">
        <h2>Hvad er det, du køber?</h2>
        ${learn('Genomisk test på én side', `<p>Der tages en vævsprøve, typisk fra øremærket, når kalven mærkes. DNA'et sammenlignes med tusindvis af testede dyr. Det giver kalven sine egne avlsværdital, NTM, fra første levedag, og sikkerheden er næsten lige så høj som for en ko med flere laktationer bag sig.</p>`, true)}
        ${learn('Hvad er NTM?', `<p>NTM (Nordisk Total Merit) samler alle egenskaber i ét økonomisk tal: ydelse, sundhed, frugtbarhed, holdbarhed, klove, kælvning, fodereffektivitet og metan. Én NTM-enhed er ifølge Nordic EBV ca. 9-10 € pr. årsko værd for Holstein.</p>`)}
        ${learn('Hvorfor hjælper "sikkerhed"?', `<p>Uden test kender du kun forældrenes gennemsnit. Men søskende er forskellige, og stamtavlen er ikke altid rigtig. Testen viser, hvilke af søstrene der fik de bedste gener. Jo højere sikkerheden er, jo oftere vælger du de rigtige dyr.</p>`)}
        ${learn('Det får du også ud af testen (ikke regnet med)', `<ul><li>Afstamningskontrol, så forkerte fædre bliver fanget</li><li>Bærerstatus for arvelige defekter. Parringsprogrammet undgår bærer × bærer.</li><li>Beta-kasein (A2), kappa-kasein og hornstatus</li><li>Indavlskontrol i parringsplanen</li><li>Et bedre grundlag for at beslutte, hvilke kvier der skal sælges</li></ul>`)}
      </section>
    </div>
    <div id="results"></div>`;
  }

  function genomicResults(R) {
    const { gs, gopt } = R;
    const gv = gs.genomic;
    const cover = gv.cost > 0 ? gv.value / gv.cost : 0;
    const breakEvenPrice = gv.tested > 0 ? gv.value / gv.tested : 0;
    const totalVsBase = gs.total - gopt.base;
    const pts = gopt.points;
    let msg;
    if (gv.net >= 0) msg = `<div class="callout good"><b>Testen tjener sig hjem.</b> Avlsfremgangen er ${kr(gv.value)} værd om året mod en testudgift på ${kr(gv.cost)}. Det svarer til ${pct(cover)} af prisen.</div>`;
    else msg = `<div class="callout"><b>Avlsfremgangen alene dækker ${pct(cover)} af testprisen.</b> Testen går i nul ved en pris på ca. ${kr(breakEvenPrice)} pr. test. Den betaler sig bedst, når udskiftningen er lav og kælvningsintervallet kort, for så er der mere at vælge imellem. Fordelene i boksen til højre er ikke regnet med.</div>`;
    const bestNote = gopt.best && gopt.best.buffer > 0
      ? `Med dine tal er det økonomisk bedste selektionsrum ca. <b>${pct(gopt.best.buffer, 1)}</b>.`
      : `Med dine tal betaler det sig <b>ikke</b> at lave ekstra kviekalve for at have flere at vælge imellem. En krydsningskalv er mere værd end den ekstra avlsfremgang. Brug i stedet testen til at vælge, hvem der skal have kønssorteret sæd, og hvem der skal have kødkvæg.`;
    return `<section class="card">
      <h2>Din besætning med genomisk test</h2>
      <div class="grid-4">
        ${stat('Kviekalve testet', num(gv.tested), 'pr. år')}
        ${stat('Avlsfremgang', '+' + num(gv.gainTotalNTM, 1) + ' NTM', 'pr. opdrættet kvie (inkl. døtre)')}
        ${stat('Værdi af fremgang', kr(gv.value), 'pr. år')}
        ${stat('Netto', krS(gv.net), `testudgift ${kr(gv.cost)}`, gv.net >= 0 ? 'good' : 'bad')}
      </div>
      ${msg}
      <div class="table-wrap"><table>
        <thead><tr><th>Beslutning, testen forbedrer</th><th>Valgt andel</th><th>NTM-gevinst</th><th>Værdi/år</th></tr></thead>
        <tbody>
          <tr><td>Hvilke kviekalve der opdrættes</td><td>${pct(gv.pKeep)}</td><td>+${num(gv.gainKeepNTM, 2)}</td><td>${kr(gv.valueKeep)}</td></tr>
          <tr><td>Hvilke hundyr der får kønssorteret sæd (resten: kødkvæg)</td><td>${pct(gs.hb.sexedShareOfCalvings)}</td><td>+${num(gv.gainDaughterNTM, 2)}</td><td>${kr(gv.valueDaughters)}</td></tr>
          <tr class="total"><td>I alt</td><td></td><td>+${num(gv.gainTotalNTM, 2)}</td><td>${kr(gv.value)}</td></tr>
        </tbody>
      </table></div>
      <h3 style="margin-top:18px">Hvor meget selektionsrum kan betale sig?</h3>
      <p class="small muted">Samlet økonomi (kalve, kvier, sæd og genomisk merværdi minus testpris) sammenlignet med den anbefalede strategi uden test og uden ekstra kvier. Den stiplede linje er dit valg.</p>
      ${CH.lines({
        xs: pts.map((p) => p.buffer),
        series: [
          { name: 'Samlet gevinst vs. uden test', color: 'var(--series-1)', values: pts.map((p) => p.vsBase) },
          { name: 'Genomisk merværdi − testpris', color: 'var(--series-2)', values: pts.map((p) => p.gain - p.cost) },
        ],
        fmt: axisKr, xfmt: (v) => pct(v, 1), markX: pts.find((p) => Math.abs(p.buffer - S.genBuffer) < 1e-6)?.buffer,
        ariaLabel: 'Gevinst som funktion af selektionsrum',
      })}
      <p class="small">${bestNote}</p>
      ${learn('Sådan regner beregneren', `<div class="formula">gevinst pr. opdrættet kvie = i(andel beholdt) × (r_genomisk − r_afstamning) × σ
gevinst pr. datter        = ½ × i(andel kønssorteret) × (r_genomisk − r_afstamning) × σ
værdi                     = NTM-gevinst × kr./NTM pr. årsko × ${num(S.genomic.productiveYears, 1)} årsko-år
i(p) = selektionsintensitet ved at vælge de bedste p (normalfordeling)</div>`)}
      <div class="btn-row"><button class="btn btn-ghost" data-action="goto" data-step="1">← Kvieplan</button><button class="btn btn-primary" data-action="goto" data-step="3">Næste: Klima & foder →</button></div>
    </section>`;
  }

  // ---------------------------------------------------------------- trin 3: klima & foder
  function renderClimate() {
    return `<section class="card hero">
      <div class="eyebrow">Beregner 3 · Klima & foder via avl</div>
      <h1>Klimaafgiften kommer i 2030. Avlen kan begynde i dag.</h1>
      <p class="lead">Med Grøn Trepart kommer der en afgift på drivhusgasser fra husdyr fra 2030. Køer, der udleder mindre metan og udnytter foderet bedre, kan avles frem. Gevinsten vokser hvert år og forsvinder ikke igen.</p>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>Dine antagelser</h2>
        ${slider({ path: 'herd.cows', label: 'Årskøer', min: 30, max: 1500, step: 10, unit: 'køer' })}
        ${slider({ path: 'climate.emissionPerCowT', label: 'Udledning i afgiftsgrundlaget', min: 4, max: 8, step: 0.1, unit: 't CO₂e/ko', help: 'Standardfaktor pr. malkeko (eksempel). Den endelige opgørelsesmetode fastsættes af myndighederne.' })}
        ${slider({ path: 'climate.methaneGainPerYear', label: 'Ekstra metanreduktion via avl', min: 0, max: 1.5, step: 0.05, unit: '% pr. år', pct: true, dec: 2, help: 'Ved at vægte metanindekset ved valg af tyre. Virker kun på vommens metan.' })}
        ${slider({ path: 'climate.feedGainPerYear', label: 'Ekstra fodereffektivitet via avl', min: 0, max: 0.75, step: 0.05, unit: '% pr. år', pct: true, dec: 2, help: 'Ved at vægte Saved Feed-indekset.' })}
        <details class="learn"><summary>Foder og tidsplan</summary><div class="body">
          ${numberField({ path: 'climate.feedKgDMPerCowYear', label: 'Foder pr. årsko', unit: 'kg TS' })}
          ${numberField({ path: 'climate.feedPricePerKgDM', label: 'Foderpris', unit: 'kr./kg TS', step: 0.1 })}
          ${slider({ path: 'climate.entericShare', label: 'Andel fra vommen (metan)', min: 0.5, max: 0.9, step: 0.01, unit: '%', pct: true })}
          ${slider({ path: 'climate.startYear', label: 'Avlsfokus starter', min: 2026, max: 2030, step: 1, unit: '', dec: 0 })}
          <p class="small">Effekten i besætningen begynder ${S.climate.lagYears} år efter start, når de første døtre kælver.</p>
        </div></details>
      </section>
      <section class="card">
        <h2>Det skal du vide</h2>
        ${learn('Sådan virker afgiften', `<p>Grøn Trepart-aftalen lægger en afgift på udledning fra husdyr på <b>300 kr./t CO₂e i 2030</b>, stigende til <b>750 kr./t i 2035</b>. Der gives et <b>bundfradrag på 60 %</b>, så den effektive afgift er 120 kr./t i 2030 og 300 kr./t i 2035.</p><p class="small muted">Satserne er fra aftalen. Tjek altid de gældende regler.</p>`, true)}
        ${learn('Metanindekset', `<p>Siden 2025 har VikingHolstein haft et nordisk metanindeks, og fra maj 2026 også VikingRed og VikingJersey. Det bygger på målinger fra kameraer og sensorer i kommercielle besætninger. Når du vælger tyre med lavere metan, får døtrene en lavere udledning, og den fremgang går videre til næste generation.</p>`)}
        ${learn('Saved Feed (fodereffektivitet)', `<p>Saved Feed-indekset er en del af NTM og viser, hvor meget foder køerne bruger til vedligehold og stofskifte ved samme ydelse. Køer, der æder mindre for den samme mælk, sparer foder hver dag og udleder samtidig mindre metan.</p>`)}
        ${learn('Avl eller foderadditiver?', `<p>Foderadditiver virker med det samme, men de koster noget hver eneste dag. Avl er langsom, men den er gratis at vedligeholde og bliver ved med at virke. De to kan kombineres.</p>`)}
        ${learn('Vigtigt forbehold', `<p>Det er endnu ikke afgjort, om og hvordan avlsfremgang kan dokumenteres og give fradrag i afgiftsopgørelsen. Beregneren viser <b>potentialet</b>. Foderbesparelsen gælder uanset hvad.</p>`)}
      </section>
    </div>
    <div id="results"></div>`;
  }

  function climateResults(R) {
    const { clim } = R;
    const r30 = clim.rows.find((r) => r.year === 2030), r35 = clim.rows.find((r) => r.year === 2035);
    const last = clim.rows[clim.rows.length - 1];
    return `<section class="card">
      <h2>Afgift og gevinst for din besætning</h2>
      <div class="grid-4">
        ${stat('Afgift 2030', kr(r30.taxBase), `${kr(r30.taxBase / S.herd.cows)} pr. ko`)}
        ${stat('Afgift 2035', kr(r35.taxBase), `${kr(r35.taxBase / S.herd.cows)} pr. ko`, 'bad')}
        ${stat('Afgift i alt 2030-40', kr(clim.cumTax), 'uden avlsfokus')}
        ${stat('Gevinst ved avl 2030-40', kr(clim.cumTaxSaved + clim.cumFeedSaved), `${kr(clim.cumTaxSaved)} afgift + ${kr(clim.cumFeedSaved)} foder`, 'good')}
      </div>
      <h3 style="margin-top:18px">Årlig klimaafgift</h3>
      ${CH.lines({
        xs: clim.rows.map((r) => r.year),
        series: [
          { name: 'Uden avlsfokus', color: 'var(--series-1)', values: clim.rows.map((r) => r.taxBase) },
          { name: 'Med metan i avlsplanen', color: 'var(--series-2)', values: clim.rows.map((r) => r.taxWith) },
        ],
        fmt: axisKr, ariaLabel: 'Klimaafgift pr. år med og uden avlsfokus',
      })}
      <h3 style="margin-top:12px">Årlig besparelse ved avl</h3>
      ${CH.bars({
        categories: clim.rows.map((r) => String(r.year)),
        series: [
          { name: 'Sparet afgift', color: 'var(--series-2)', values: clim.rows.map((r) => r.taxSaved) },
          { name: 'Sparet foder', color: 'var(--series-1)', values: clim.rows.map((r) => r.feedSaved) },
        ],
        fmt: axisKr, height: 220, ariaLabel: 'Årlig besparelse',
      })}
      <details class="learn"><summary>Se tallene som tabel</summary><div class="body table-wrap"><table>
        <thead><tr><th>År</th><th>Effektiv sats</th><th>Afgift uden</th><th>Afgift med</th><th>Sparet foder</th></tr></thead>
        <tbody>${clim.rows.map((r) => `<tr><td>${r.year}</td><td>${num(r.effRate)} kr./t</td><td>${kr(r.taxBase)}</td><td>${kr(r.taxWith)}</td><td>${kr(r.feedSaved)}</td></tr>`).join('')}</tbody>
      </table></div></details>
      <div class="callout">I ${last.year} er besætningens metan fra vommen ca. <b>${pct(last.methaneRed, 1)}</b> lavere, og foderforbruget ca. <b>${pct(last.feedRed, 1)}</b> lavere end uden avlsfokus, ved samme ydelse.</div>
      <div class="btn-row"><button class="btn btn-ghost" data-action="goto" data-step="2">← Genomisk test</button><button class="btn btn-primary" data-action="goto" data-step="4">Næste: Tørstoftjek →</button></div>
    </section>`;
  }

  // ---------------------------------------------------------------- trin 4: tørstoftjek
  function renderDM() {
    const methods = C.MEASURE_METHODS;
    return `<section class="card hero">
      <div class="eyebrow">Beregner 4 · Tørstoftjek</div>
      <h1>Får køerne den ration, du har planlagt?</h1>
      <p class="lead">Fuldfoder blandes efter vægt, men det er tørstoffet, koen lever af. Hvis tørstoffet i ensilagen svinger fra læs til læs, svinger rationen også. Se, hvad det koster, og hvad det betyder, hvordan du måler.</p>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>Din fodring</h2>
        ${slider({ path: 'herd.cows', label: 'Årskøer', min: 30, max: 1500, step: 10, unit: 'køer' })}
        ${slider({ path: 'dm.dmiKg', label: 'Planlagt tørstofoptag', min: 16, max: 28, step: 0.5, unit: 'kg TS/dag', dec: 1 })}
        ${slider({ path: 'dm.silageShare', label: 'Andel af tørstof fra ensilage', min: 30, max: 80, step: 1, unit: '%', pct: true })}
        ${slider({ path: 'dm.silageDMPct', label: 'Forventet tørstof i ensilagen', min: 25, max: 45, step: 0.5, unit: '%', dec: 1 })}
        ${slider({ path: 'dm.sdDMPoints', label: 'Svingning i tørstof (spredning)', min: 0.5, max: 5, step: 0.1, unit: '%-point', dec: 1, help: 'Typisk 1,5-3 %-point mellem læs. Den er større ved nye stakke, regn og tilbagegang i kanten.' })}
        <div class="field"><div class="lbl">Sådan måler du i dag</div>
          <div class="seg" role="group" aria-label="Målemetode" style="display:flex">${Object.entries(methods).map(([k, m]) => `<button data-action="dm-method" data-value="${k}" aria-pressed="${S.dm.method === k}">${m.label}</button>`).join('')}</div></div>
        <details class="learn"><summary>Priser og antagelser</summary><div class="body">
          ${numberField({ path: 'dm.milkPrice', label: 'Mælkepris', unit: 'kr./kg EKM', step: 0.05 })}
          ${numberField({ path: 'dm.feedPricePerKgDM', label: 'Foderpris', unit: 'kr./kg TS', step: 0.1 })}
          ${slider({ path: 'dm.milkResponse', label: 'Mælkerespons ved underfodring', min: 0.8, max: 2, step: 0.1, unit: 'kg EKM/kg TS', dec: 1 })}
          ${slider({ path: 'dm.compensation', label: 'Koens egen udligning', min: 0, max: 90, step: 5, unit: '%', pct: true, help: 'Fx ved fri adgang og ædeplads. Udligningen dæmper tabet ved underfodring.' })}
          ${slider({ path: 'dm.overfeedWaste', label: 'Spild ved overfodring', min: 0, max: 100, step: 5, unit: '%', pct: true })}
        </div></details>
      </section>
      <section class="card">
        <h2>Det skal du vide</h2>
        ${learn('Hvorfor svinger tørstoffet?', `<p>Ensilagen varierer gennem stakken: forskellige marker og slæt, regn under indkørsel, kanter og overflade. Falder tørstoffet fra 33 % til 30 %, får koen ca. 9 % mindre ensilage-tørstof, selv om blandevognen vejer det samme.</p>`, true)}
        ${learn('Hvad er NIR?', `<p>NIR (nær-infrarød spektroskopi) måler tørstof og næringsindhold med lys på sekunder. En NIR-sensor på blandevognen eller ved udtagningen måler hvert læs og retter mængderne, så koen altid får det planlagte tørstof.</p>`)}
        ${learn('NIR fra mark til krybbe', `<p>Foderteknik, der blev en del af VikingDanmark i oktober 2026, leverer NIR-sensorer til finsnittere (New Holland og Krone, kan eftermonteres på andre mærker) og vejeceller på vogne. Data sendes online fra marken til managementprogrammet. Du får udbytte og tørstof pr. mark og læs og kan bruge det til foderbudget, gødningsplan og stakstyring.</p>`)}
        ${learn('Sådan regner beregneren', `<div class="formula">fejl i TS pr. ko/dag (SD) = TS fra ensilage × (svingning ÷ tørstof%) × restfejl for målemetode
gns. afvigelse           = SD × √(2/π)
underfodring (½ tid)     = afvigelse × (1 − udligning) × (mælkerespons × mælkepris − foderpris)
overfodring (½ tid)      = afvigelse × foderpris × spild</div>
        <p class="small">Restfejl pr. metode: ${Object.values(methods).map((m) => `${m.label.toLowerCase()} ${pct(m.residual)}`).join(', ')}.</p>`)}
      </section>
    </div>
    <div id="results"></div>`;
  }

  function dmResults(R) {
    const { dm } = R;
    const methods = C.MEASURE_METHODS;
    const keys = Object.keys(methods);
    const cur = dm.current;
    const saving = dm.savingWithNIR;
    return `<section class="card">
      <h2>Hvad koster svingende tørstof dig?</h2>
      <div class="grid-4">
        ${stat('Gns. afvigelse i rationen', `${num(cur.meanAbs, 2)} kg TS`, 'pr. ko pr. dag')}
        ${stat('Tab i dag', kr(cur.perYear), `${num(cur.perCowDay, 2)} kr. pr. ko pr. dag`, 'bad')}
        ${stat('Tab med NIR ved hver blanding', kr(dm.byMethod.nir.perYear), 'pr. år')}
        ${stat('Mulig gevinst', kr(Math.max(0, saving)), 'pr. år', saving > 0 ? 'good' : '')}
      </div>
      ${saving > 0 ? `<div class="callout good">En investering i løbende tørstofmåling på op til <b>${kr(saving * 3)}</b> tjener sig ind på 3 år med dine tal, og op til <b>${kr(saving * 5)}</b> på 5 år.</div>` : `<div class="callout good">Du måler allerede så tæt, at der kun er lidt at hente ved at måle oftere.</div>`}
      <h3 style="margin-top:18px">Årligt tab pr. målemetode</h3>
      ${CH.bars({
        categories: keys.map((k) => methods[k].short),
        series: [{ name: 'Tab pr. år', color: 'var(--series-1)', values: keys.map((k) => dm.byMethod[k].perYear),
          colors: keys.map((k) => (k === S.dm.method ? 'var(--series-2)' : 'var(--series-1)')) }],
        fmt: axisKr, ariaLabel: 'Årligt tab pr. målemetode',
      })}
      <p class="small muted"><span class="dot" style="background:var(--series-2)"></span>Din nuværende metode</p>
      <div class="btn-row"><button class="btn btn-ghost" data-action="goto" data-step="3">← Klima & foder</button><button class="btn btn-primary" data-action="goto" data-step="5">Se din samlede plan →</button></div>
    </section>`;
  }

  // ---------------------------------------------------------------- trin 5: din plan
  function renderPlan() {
    const R = results();
    const { orig: cur, gs, clim, dm } = R;
    const diff = R.potential;
    const gNet = gs.genomic.net;
    const r35 = clim.rows.find((r) => r.year === 2035);
    if (S.submitted) return renderThanks(R);
    const c = S.contact;
    return `${S.restored ? `<div class="callout good no-print">Velkommen tilbage. Her er din plan, som du gemte den. Du kan justere alle tal i beregnerne.</div>` : ''}
    <section class="card hero">
      <div class="eyebrow">Din plan</div>
      <h1>Overblik over din besætning</h1>
      <p class="lead">Her er resultaterne fra beregnerne samlet. Vælg, hvad du vil have hjælp til, og book din lokale rådgiver. Rådgiveren har dine tal med til mødet.</p>
      <div class="btn-row no-print" style="justify-content:flex-start"><button class="btn btn-ghost" data-action="copy-link">🔗 Gem link til min plan</button><button class="btn btn-ghost" data-action="print">Udskriv / gem som PDF</button></div>
    </section>
    <section class="card">
      <div class="grid-2">
        ${planItem(1, 'Kvieplan', cur.balance < -0.5 ? `Du mangler ca. ${num(-cur.balance)} kvier/år` : cur.balancePct > 0.05 ? `Du har ca. ${num(cur.balance)} kvier for meget/år` : 'Din kviebalance passer', `Anbefalet strategi: ${krS(diff)} pr. år`)}
        ${planItem(2, 'Genomisk test', `+${num(gs.genomic.gainTotalNTM, 1)} NTM pr. opdrættet kvie`, `Netto ${krS(gNet)} pr. år (${pct(gs.genomic.value / Math.max(1, gs.genomic.cost))} dækning)`)}
        ${planItem(3, 'Klima & foder', `Afgift 2035: ${kr(r35.taxBase)}`, `Avlsgevinst 2030-40: ${kr(clim.cumTaxSaved + clim.cumFeedSaved)}`)}
        ${planItem(4, 'Tørstof', `Tab i dag: ${kr(dm.current.perYear)}/år`, `Gevinst med NIR: ${kr(Math.max(0, dm.savingWithNIR))}/år`)}
      </div>
    </section>
    <section class="card">
      <h2>Hvad vil du have hjælp til?</h2>
      ${checkbox('plan', 'Gennemgang af min avlsplan', 'En avlsrådgiver gennemgår kvieplanen og sædstrategien med dine egne tal.')}
      ${checkbox('test', 'Tilbud på genomisk test af kviekalve', `Ca. ${num(gs.genomic.tested)} kviekalve om året.`)}
      ${checkbox('climate', 'Klimaprofil for besætningen', 'Hvordan metan og Saved Feed kan vægtes i dit tyrevalg.')}
      ${checkbox('nir', 'Demo af NIR-tørstofmåling', 'På blandevogn eller finsnitter.')}
    </section>
    <section class="card" id="booking">
      <h2>Book din lokale rådgiver</h2>
      <p class="muted small">Skriv bedriftens postnummer. Så finder vi rådgiveren i dit område og viser ledige tider.</p>
      <div class="field" style="max-width:220px"><label for="c-zip"><span>Postnummer</span></label><input id="c-zip" type="text" inputmode="numeric" maxlength="4" autocomplete="postal-code" value="${esc(c.zip)}" data-contact="zip"></div>
      <div id="bookingBody">${bookingBody()}</div>
    </section>
    <section class="card">
      <h2>Dine kontaktoplysninger</h2>
      <form id="leadForm" novalidate>
        <div class="grid-2">
          ${input('name', 'Navn', 'text', 'name', true)}
          ${input('farm', 'Bedrift', 'text', 'organization')}
          ${input('phone', 'Telefon', 'tel', 'tel', true)}
          ${input('email', 'E-mail', 'email', 'email', true)}
          ${input('cvr', 'CVR-nr. (valgfrit)', 'text', 'off')}
        </div>
        <div class="field"><label for="c-note"><span>Bemærkning (valgfrit)</span></label><textarea id="c-note" rows="3" data-contact="note">${esc(c.note)}</textarea></div>
        <label class="check"><input type="checkbox" id="c-consent" data-contact="consent" ${c.consent ? 'checked' : ''}><span class="small">Jeg giver samtykke til, at VikingDanmark kontakter mig om ovenstående og må gemme mine svar og beregninger til det formål. *</span></label>
        <label class="check"><input type="checkbox" id="c-mailOptIn" data-contact="mailOptIn" ${c.mailOptIn ? 'checked' : ''}><span class="small">Send mig også gode råd, der passer til mine tal. Højst én mail om ugen, og du kan altid afmelde. <span class="muted">(Valgfrit. Planen sendes under alle omstændigheder.)</span></span></label>
        <div id="formError" class="callout bad" hidden></div>
        <div class="btn-row"><button class="btn btn-ghost" type="button" data-action="preview-mail" data-id="plan">Se mailen, du får</button><button class="btn btn-primary" type="submit">${S.booking.slot ? 'Bekræft møde og send min plan →' : S.booking.type === 'callback' ? 'Send – ring mig op →' : 'Send til en rådgiver →'}</button></div>
      </form>
    </section>`;
  }

  function bookingBody() {
    const adv = EN.advisorForZip(S.contact.zip);
    if (!adv) {
      return S.contact.zip && String(S.contact.zip).length === 4
        ? '<p class="callout bad">Vi kunne ikke finde postnummeret. Tjek, at det er et dansk postnummer.</p>'
        : '<p class="muted small">Ingen rådgiver valgt endnu.</p>';
    }
    const b = S.booking;
    const types = [...Object.entries(EN.MEETING_TYPES).map(([k, m]) => [k, `${m.label} · ${m.minutes} min`]), ['callback', 'Ring mig op']];
    let slots = '';
    if (b.type === 'callback') {
      slots = `<div class="field" style="max-width:320px;margin-top:12px"><label for="cbWhen"><span>Hvornår passer det bedst?</span></label>
        <select id="cbWhen" data-booking="callbackWhen">${['Formiddag (8-12)', 'Eftermiddag (12-16)', 'Efter malkning (16-18)'].map((o) => `<option ${b.callbackWhen === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <div class="help">Rådgiveren ringer inden for 2 hverdage.</div></div>`;
    } else {
      const days = EN.availableSlots(adv.id, b.type, new Date(), 8);
      slots = `<div class="slots" role="group" aria-label="Ledige tider">${days.map((d) => `<div class="slot-day"><div class="slot-date">${esc(EN.fmtDate(d.date).replace(/^(\w+)/, (w) => w.slice(0, 3) + '.'))}</div>${d.times.length ? d.times.map((t) => {
        const sel = b.slot && b.slot.date === d.date && b.slot.time === t && b.slot.type === b.type;
        return `<button type="button" class="slot" data-action="book-slot" data-date="${d.date}" data-time="${t}" aria-pressed="${sel}">${t}</button>`;
      }).join('') : '<span class="muted small">Optaget</span>'}</div>`).join('')}</div>`;
    }
    const chosen = b.slot && b.slot.type === b.type && b.type !== 'callback'
      ? `<div class="callout good"><b>Valgt:</b> ${esc(EN.MEETING_TYPES[b.slot.type].label)}, ${esc(EN.fmtDate(b.slot.date))} kl. ${esc(b.slot.time)}. Udfyld dine oplysninger nedenfor for at bekræfte.</div>` : '';
    return `<div class="advisor">
        <div class="avatar" aria-hidden="true">${esc(adv.initials)}</div>
        <div><b>${esc(adv.title)}</b><br><span class="small muted">Dækker ${esc(adv.region)} · Eksempeldata, erstattes af VikingDanmarks rådgiverliste</span></div>
      </div>
      <div class="field"><div class="lbl">Mødeform</div>
        <div class="seg" role="group" aria-label="Mødeform">${types.map(([k, t]) => `<button type="button" data-action="book-type" data-value="${k}" aria-pressed="${b.type === k}">${t}</button>`).join('')}</div></div>
      ${slots}${chosen}`;
  }

  const planItem = (step, title, a, b) => `<div class="stat"><div class="k">${title}</div><div style="font-weight:600;margin:4px 0">${a}</div><div class="s">${b}</div><button class="linkbtn small no-print" data-action="goto" data-step="${step}">Justér</button></div>`;
  const checkbox = (k, t, s) => `<label class="check"><input type="checkbox" data-interest="${k}" ${S.interests[k] ? 'checked' : ''}><span><b>${t}</b><br><span class="small muted">${s}</span></span></label>`;
  const input = (k, label, type, ac, req = false) => `<div class="field"><label for="c-${k}"><span>${label}${req ? ' *' : ''}</span></label><input id="c-${k}" type="${type}" autocomplete="${ac}" value="${esc(S.contact[k])}" data-contact="${k}" ${req ? 'required' : ''}></div>`;

  // ---------------------------------------------------------------- planlink, mails, booking
  const baseUrl = () => location.href.split('#')[0];
  const planUrl = () => `${baseUrl()}#plan=${EN.encodePlan(S)}`;
  function nurtureCtx(R) {
    const a = S.quiz.answers;
    const adv = EN.advisorForZip(S.contact.zip);
    const slot = S.booking.slot && S.booking.slot.type === S.booking.type ? S.booking.slot : null;
    return {
      now: S.submittedAt ? new Date(S.submittedAt) : new Date(),
      name: S.contact.name, cows: S.herd.cows, mailOptIn: !!S.contact.mailOptIn,
      heiferBalance: R.orig.balance, need: R.orig.need, potential: R.potential,
      genomicNet: R.gs.genomic.net, genomicTested: R.gs.genomic.tested,
      tax2030: R.clim.rows[0].taxBase, tax2035: R.clim.rows[5].taxBase, drySaving: R.dm.savingWithNIR,
      dmMethod: S.dm.method, focus: a.focus, genomicAnswer: a.genomic, interests: S.interests,
      advisor: adv, planUrl: planUrl(), bookUrl: `${planUrl()}`,
      booking: slot ? { slot, typeLabel: EN.MEETING_TYPES[slot.type].label } : null,
    };
  }
  function downloadICS() {
    const adv = EN.advisorForZip(S.contact.zip);
    const s = S.booking.slot;
    if (!adv || !s) return;
    const topics = [['plan', 'avlsplan og kvieplan'], ['test', 'genomisk test'], ['climate', 'klimaprofil'], ['nir', 'NIR-tørstofmåling']].filter(([k]) => S.interests[k]).map(([, t]) => t);
    const ics = EN.buildICS({ date: s.date, time: s.time, type: s.type, advisor: adv,
      summary: `${EN.MEETING_TYPES[s.type].label}: ${topics[0] || 'avlsplan'} (VikingDanmark)`,
      description: `Emner: ${topics.join(', ') || 'avlsplan'}.\nDin plan: ${planUrl()}` });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'moede-med-raadgiver.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function copyPlanLink() {
    const url = planUrl();
    try { await navigator.clipboard.writeText(url); toast('Link til din plan er kopieret. Gem det, eller send det til dig selv.'); }
    catch (e) { window.prompt('Kopiér linket til din plan:', url); }
  }
  function previewMail(id) {
    const R = results();
    const ctx = nurtureCtx(R);
    const nm = EN.buildNurture(ctx).find((x) => x.id === 'nir');
    ctx.nirSeasonal = !!(nm && nm.seasonal);
    const { subject, html } = EN.renderEmail(id, ctx);
    $('#modalTitle').textContent = `Mail: ${subject}`;
    $('#modalFrame').srcdoc = html;
    $('#modal').hidden = false;
    $('#closeModal').focus();
  }

  function renderThanks(R) {
    const adv = EN.advisorForZip(S.contact.zip);
    const slot = S.booking.slot && S.booking.slot.type === S.booking.type ? S.booking.slot : null;
    const nurture = EN.buildNurture(nurtureCtx(R));
    const dfmt = (d) => new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' }).format(d);
    let booking;
    if (slot && adv) booking = `<div class="callout good"><b>Dit møde er booket:</b> ${esc(EN.MEETING_TYPES[slot.type].label)} med ${esc(adv.title)}, ${esc(EN.fmtDate(slot.date))} kl. ${esc(slot.time)} (${EN.MEETING_TYPES[slot.type].minutes} min.).</div>
      <div class="btn-row" style="justify-content:flex-start"><button class="btn btn-primary" data-action="ics">📅 Tilføj til kalender</button></div>`;
    else if (S.booking.type === 'callback' && adv) booking = `<div class="callout good"><b>${esc(adv.title)}</b> ringer til dig inden for 2 hverdage (${esc(S.booking.callbackWhen)}).</div>`;
    else booking = `<p>En rådgiver kontakter dig inden for 2 hverdage og har dine beregninger med.</p>`;
    return `<section class="card hero">
      <div class="eyebrow">Tak, ${esc(S.contact.name.split(' ')[0])}</div>
      <h1>Din plan er sendt</h1>
      ${booking}
    </section>
    <section class="card">
      <h2>Gem din plan</h2>
      <p class="small muted">Med linket kan du åbne dine beregninger igen og justere dem. Det indeholder ikke dine kontaktoplysninger. Det står også i mailen, vi har sendt til ${esc(S.contact.email)}.</p>
      <div class="inline-num" style="flex-wrap:wrap"><input type="text" readonly value="${esc(planUrl())}" aria-label="Link til din plan" style="flex:1;min-width:0;max-width:none" onclick="this.select()"><button class="btn btn-ghost" data-action="copy-link">Kopiér</button></div>
      <div class="btn-row" style="justify-content:flex-start"><button class="btn btn-ghost" data-action="print">Udskriv / gem som PDF</button><button class="btn btn-ghost" data-action="preview-mail" data-id="plan">Se mailen</button></div>
    </section>
    <section class="card">
      <h2>Det kan du forvente fra os</h2>
      <ol class="timeline">${nurture.map((m) => `<li><span class="when">${m.id === 'plan' ? 'Nu' : dfmt(m.at)}</span><span><b>${esc(m.subject)}</b><br><span class="small muted">${esc(m.reason)}</span> <button class="linkbtn small" data-action="preview-mail" data-id="${m.id}">Se mail</button></span></li>`).join('')}</ol>
      ${!S.contact.mailOptIn ? '<p class="small muted">Du har kun bedt om planen. Du får ingen yderligere mails.</p>' : ''}
      <div class="btn-row no-print" style="justify-content:flex-start">
        <button class="btn btn-ghost" data-action="edit-plan">Ret oplysninger eller tid</button>
        <button class="btn btn-ghost" data-action="reset">Start forfra (ny demo)</button>
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- sidebar og leadkort
  function renderSide() {
    const R = results();
    const done = S.visited.filter((x) => x >= 1 && x <= 4).length;
    const breedName = { holstein: 'Holstein', rdm: 'Rød Dansk', jersey: 'Jersey', kryds: 'Krydsning' }[S.breed];
    $('#sideSummary').innerHTML = `<h3>Din besætning</h3>
      <div class="side-row"><span>Årskøer</span><span>${num(S.herd.cows)}</span></div>
      <div class="side-row"><span>Race</span><span>${breedName}</span></div>
      <div class="side-row"><span>Udskiftning</span><span>${pct(S.herd.replacementRate)}</span></div>
      <div class="side-row"><span>Kælvningsinterval</span><span>${num(S.herd.calvingIntervalMonths, 1)} mdr.</span></div>
      <h3 style="margin-top:14px">Dine resultater</h3>
      <div class="side-row"><span>Kviebalance i dag</span><span class="${R.orig.balance < -0.5 ? 'neg' : ''}">${signNum(R.orig.balance, 0)}/år</span></div>
      <div class="side-row"><span>Anbefalet kvieplan</span><span class="pos">${krS(R.potential)}</span></div>
      <div class="side-row"><span>Genomisk test, netto</span><span class="${R.gs.genomic.net >= 0 ? 'pos' : 'neg'}">${krS(R.gs.genomic.net)}</span></div>
      <div class="side-row"><span>Klimaafgift 2035</span><span>${kr(R.clim.rows[5].taxBase)}</span></div>
      <div class="side-row"><span>Tørstof, mulig gevinst</span><span class="pos">${kr(Math.max(0, R.dm.savingWithNIR))}</span></div>
      <div style="margin-top:12px" class="small muted">Beregnere gennemgået: ${done} af 4</div>
      <div class="meter" style="margin-top:4px"><span style="width:${done * 25}%"></span></div>
      <div class="side-actions">
        <button class="btn btn-ghost" style="width:100%;justify-content:center" data-action="copy-link">🔗 Gem link til min plan</button>
        ${S.step !== 5 ? `<button class="btn btn-primary" style="width:100%;justify-content:center" data-action="goto-book">Book en rådgiver</button>` : ''}
      </div>`;
    renderLeadCard(R);
  }

  function leadData(R) {
    const a = S.quiz.answers;
    const slot = S.booking.slot && S.booking.slot.type === S.booking.type ? S.booking.slot : null;
    const adv = EN.advisorForZip(S.contact.zip);
    const ls = C.leadScore({
      cows: S.herd.cows, heiferBalancePct: R.orig.balancePct, genomicNet: R.gs.genomic.net,
      drySaving: R.dm.savingWithNIR, toolsCompleted: S.visited.filter((x) => x >= 1 && x <= 4).length + (slot ? 1 : 0),
      wantsContact: S.submitted, quizAnswers: a,
    });
    const tags = [];
    if (S.quiz.done) tags.push(AREAS[quizScores(a).top[0]].profile);
    if (slot) tags.push('Møde booket'); else if (S.booking.type === 'callback' && S.submitted) tags.push('Ønsker opkald');
    if (R.orig.balance < -0.5) tags.push('Mangler kvier'); else if (R.orig.balancePct > 0.05) tags.push('Kvieoverskud');
    if (S.originalStrategy) tags.push('Har valgt anbefalet kvieplan');
    if (a.genomic === 'no') tags.push('Genomtester ikke');
    if (a.sexed === 'no') tags.push('Ingen kønssorteret');
    if (S.dm.method === 'never' || S.dm.method === 'monthly') tags.push('NIR-emne (Foderteknik)');
    if (a.focus === 'climate') tags.push('Klimafokus');
    const actions = [];
    if (S.interests.plan) actions.push(`Avlsrådgiver: Gennemgå kvieplan. Potentiale ${krS(R.potential)}/år; kviebalance i dag ${signNum(R.orig.balance, 0)}/år.`);
    if (S.interests.test) actions.push(`Tilbud på genomisk test: ca. ${num(R.gs.genomic.tested)} kviekalve/år.`);
    if (S.interests.climate) actions.push(`Klimaprofil: afgift 2035 ca. ${kr(R.clim.rows[5].taxBase)}`);
    if (S.interests.nir) actions.push(`Foderteknik: NIR-demo. Mulig gevinst ${kr(Math.max(0, R.dm.savingWithNIR))} pr. år.`);
    const c = S.contact;
    const nurture = EN.buildNurture(nurtureCtx(R));
    const payload = {
      kontakt: { navn: c.name, bedrift: c.farm, telefon: c.phone, email: c.email, postnr: c.zip, cvr: c.cvr, samtykke: c.consent, mail_optin: !!c.mailOptIn, bemaerkning: c.note },
      raadgiver: adv ? adv.id : null,
      booking: slot ? { type: slot.type, dato: slot.date, tid: slot.time, minutter: EN.MEETING_TYPES[slot.type].minutes }
        : S.booking.type === 'callback' ? { type: 'callback', tidspunkt: S.booking.callbackWhen } : null,
      besaetning: { aarskoeer: S.herd.cows, race: S.breed, udskiftning: S.herd.replacementRate, kaelvningsinterval: S.herd.calvingIntervalMonths },
      quiz: a, strategi_i_dag: S.originalStrategy || S.strategy, valgt_strategi: S.strategy,
      resultater: {
        kviebalance: +R.orig.balance.toFixed(1), kvieplan_gevinst_kr: Math.round(R.potential),
        genomisk_netto_kr: Math.round(R.gs.genomic.net), klimaafgift_2035_kr: Math.round(R.clim.rows[5].taxBase),
        toerstof_gevinst_kr: Math.round(Math.max(0, R.dm.savingWithNIR)), toerstof_maalemetode: S.dm.method,
      },
      interesser: Object.keys(S.interests).filter((k) => S.interests[k]),
      leadscore: ls, tags,
      plan_url: planUrl(),
      opfoelgning: nurture.map((m) => ({ id: m.id, dato: m.at.toISOString().slice(0, 10), emne: m.subject })),
    };
    return { ls, tags, actions, payload, nurture, slot, adv };
  }

  function renderLeadCard(R) {
    const { ls, tags, actions, payload, nurture, slot, adv } = leadData(R);
    const c = S.contact;
    const tierCls = ls.tier === 'Varm' ? 'hot' : ls.tier === 'Lun' ? 'warm' : '';
    const dfmt = (d) => new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' }).format(d);
    $('#leadCard').innerHTML = `<div class="leadcard">
      <div class="score"><div class="score-num">${ls.score}</div><div><b>${esc(c.name) || 'Anonym besøgende'}</b><br><span class="small muted">${esc(c.farm) || '–'} · ${num(S.herd.cows)} årskøer${c.zip ? ' · ' + esc(c.zip) : ''}</span><br><span class="tag ${tierCls}">${ls.tier} lead</span></div></div>
      <div class="small muted">Point: størrelse ${ls.parts.size}/30 · behov ${ls.parts.need}/40 · engagement ${ls.parts.eng}/30</div>
      <div style="margin:10px 0">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <h3>Tildelt</h3>
      <p class="small">${adv ? `${esc(adv.title)}` : '<span class="muted">Ikke tildelt (mangler postnummer)</span>'}${slot ? `<br><b>Møde:</b> ${esc(EN.MEETING_TYPES[slot.type].label)}, ${esc(EN.fmtDate(slot.date))} kl. ${esc(slot.time)}` : S.booking.type === 'callback' ? `<br><b>Opkald:</b> ${esc(S.booking.callbackWhen)}` : ''}</p>
      <h3>Næste skridt for rådgiver</h3>
      ${actions.length ? `<ul class="small">${actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="small muted">Ingen interesser valgt endnu.</p>'}
      <h3>Automatisk opfølgning</h3>
      <ol class="timeline small">${nurture.map((m) => `<li><span class="when">${m.id === 'plan' ? 'Dag 0' : dfmt(m.at)}</span><span>${esc(m.subject)} <button class="linkbtn" data-action="preview-mail" data-id="${m.id}">vis</button><br><span class="muted">${esc(m.reason)}</span></span></li>`).join('')}</ol>
      ${!c.mailOptIn ? '<p class="small muted">Kun planmail. Brugeren har ikke sagt ja til opfølgning.</p>' : ''}
      <details class="learn"><summary>Data til CRM (JSON)</summary><div class="body"><div class="formula" style="white-space:pre-wrap">${esc(JSON.stringify(payload, null, 2))}</div></div></details>
      <p class="small muted">${S.submitted ? 'Status: sendt af brugeren.' : 'Status: ikke sendt endnu. Leadet kan stadig opsamles anonymt til retargeting.'}</p>
    </div>`;
  }

  // ---------------------------------------------------------------- navigation
  const STEPS = [
    { title: 'Besætningstjek', render: renderQuiz },
    { title: 'Kvieplan', render: renderHeifer, results: heiferResults, teaser: 'Lav præcis de kvier, du skal bruge, og gør resten af kalvene mere værd.' },
    { title: 'Genomisk test', render: renderGenomic, results: genomicResults, teaser: 'Hvornår tjener testen sig hjem i din besætning?' },
    { title: 'Klima & foder', render: renderClimate, results: climateResults, teaser: 'Klimaafgiften fra 2030, og hvad avl kan spare.' },
    { title: 'Tørstoftjek', render: renderDM, results: dmResults, teaser: 'Hvad svingende tørstof i ensilagen koster dig.' },
    { title: 'Din plan', render: renderPlan },
  ];

  function renderStepper() {
    $('#stepper').innerHTML = STEPS.map((s, i) => `<li><button type="button" data-action="goto" data-step="${i}" ${i === S.step ? 'aria-current="step"' : ''} class="${S.visited.includes(i) && i !== S.step ? 'done' : ''}"><span class="num">${S.visited.includes(i) && i !== S.step ? '✓' : i + 1}</span>${s.title}</button></li>`).join('');
  }

  function update() {
    const st = STEPS[S.step];
    if (st.results) { const el = $('#results'); if (el) el.innerHTML = st.results(results()); }
    renderSide();
    save();
  }

  function go(step) {
    S.step = step;
    if (!S.visited.includes(step)) S.visited.push(step);
    renderStepper();
    $('#main').innerHTML = STEPS[step].render();
    update();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#main').focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'quizCows') { $('#quizCowsVal').textContent = `${num(+t.value)} køer`; S.quiz.answers.cows = +t.value; return; }
    if (t.dataset.path) {
      let v = parseFloat(t.value);
      if (Number.isNaN(v)) return;
      if (t.dataset.pct === '1') v = v / 100;
      setPath(t.dataset.path, v);
      const lab = document.querySelector(`[data-val-for="${t.dataset.path}"]`);
      if (lab) lab.textContent = `${num(+t.value, +t.dataset.dec)}${t.dataset.unit ? ' ' + t.dataset.unit : ''}`;
      if (t.dataset.path === 'herd.cows') S.dm.cows = v;
      update();
      return;
    }
    if (t.dataset.mix) {
      const g = t.dataset.mix, kind = t.dataset.kind, other = kind === 'sexed' ? 'beef' : 'sexed';
      const m = S.strategy[g];
      m[kind] = +t.value / 100;
      if (m.sexed + m.beef > 1) { m[other] = Math.max(0, 1 - m[kind]); $(`#mix-${g}-${other}`).value = Math.round(m[other] * 100); }
      m.conv = Math.max(0, 1 - m.sexed - m.beef);
      for (const k of ['sexed', 'beef', 'conv']) $(`#mixv-${g}-${k}`).textContent = pct(m[k]);
      $(`#mixbar-${g}`).innerHTML = mixBarInner(m);
      update();
      return;
    }
    if (t.dataset.contact) {
      const k = t.dataset.contact;
      if (k === 'zip') t.value = t.value.replace(/\D/g, '').slice(0, 4);
      const before = k === 'zip' ? EN.advisorForZip(S.contact.zip) : null;
      S.contact[k] = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'zip') {
        const after = EN.advisorForZip(S.contact.zip);
        if ((before && before.id) !== (after && after.id)) S.booking.slot = null;
        $('#bookingBody').innerHTML = bookingBody();
      }
      if (k === 'mailOptIn' || k === 'consent') { /* ingen re-render nødvendig */ }
      renderLeadCard(results()); save();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.interest) { S.interests[t.dataset.interest] = t.checked; renderLeadCard(results()); save(); }
    if (t.dataset.action === 'lasting') { S.lasting = t.checked; update(); }
    if (t.dataset.booking) { S.booking[t.dataset.booking] = t.value; renderLeadCard(results()); save(); }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.action;
    if (a === 'goto') go(+b.dataset.step);
    else if (a === 'quiz-pick') {
      const item = QUIZ[S.quiz.i];
      S.quiz.answers[item.id] = b.dataset.value;
      b.parentElement.querySelectorAll('.option').forEach((o) => o.setAttribute('aria-pressed', o === b));
      setTimeout(() => quizNext(), 180);
    } else if (a === 'quiz-next') quizNext();
    else if (a === 'quiz-back') { S.quiz.i = Math.max(0, S.quiz.i - 1); go(0); }
    else if (a === 'quiz-restart') { S.quiz = { i: 0, answers: {}, done: false }; go(0); }
    else if (a === 'use-rec') {
      if (!S.originalStrategy) S.originalStrategy = deep(S.strategy);
      S.strategy = deep(C.recommendStrategy(S.herd, S.buffer, S.biology).strategy);
      go(1);
    } else if (a === 'restore-orig') {
      if (S.originalStrategy) S.strategy = deep(S.originalStrategy);
      S.originalStrategy = null;
      go(1);
    } else if (a === 'breed') { S.breed = b.dataset.value; S.genomic.krPerNTMYear = C.NTM_VALUE_BY_BREED[S.breed]; go(2); }
    else if (a === 'dm-method') { S.dm.method = b.dataset.value; b.parentElement.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', o === b)); update(); }
    else if (a === 'print') window.print();
    else if (a === 'book-type') { S.booking.type = b.dataset.value; if (S.booking.slot && S.booking.slot.type !== S.booking.type) S.booking.slot = null; $('#bookingBody').innerHTML = bookingBody(); refreshSubmitLabel(); renderLeadCard(results()); save(); }
    else if (a === 'book-slot') { S.booking.slot = { date: b.dataset.date, time: b.dataset.time, type: S.booking.type }; $('#bookingBody').innerHTML = bookingBody(); refreshSubmitLabel(); renderLeadCard(results()); save(); }
    else if (a === 'goto-book') { go(5); setTimeout(() => { const el = $('#booking'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 60); }
    else if (a === 'ics') downloadICS();
    else if (a === 'copy-link') copyPlanLink();
    else if (a === 'preview-mail') previewMail(b.dataset.id);
    else if (a === 'edit-plan') { S.submitted = false; go(5); }
    else if (a === 'reset') { S = initial(); save(); go(0); }
  });

  function quizNext() {
    const item = QUIZ[S.quiz.i];
    if (item.type === 'number' && !S.quiz.answers.cows) S.quiz.answers.cows = S.herd.cows;
    if (S.quiz.i < QUIZ.length - 1) { S.quiz.i++; }
    else { S.quiz.done = true; applyQuiz(); }
    go(0);
  }

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'leadForm') return;
    e.preventDefault();
    const c = S.contact, errs = [];
    if (!c.name.trim()) errs.push('navn');
    if (!/^[+\d][\d\s]{7,}$/.test(c.phone.trim())) errs.push('telefonnummer');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) errs.push('e-mail');
    if (!c.consent) errs.push('samtykke');
    if ((S.booking.slot || S.booking.type === 'callback') && !EN.advisorForZip(c.zip)) errs.push('postnummer (for at booke rådgiver)');
    const box = $('#formError');
    if (errs.length) { box.hidden = false; box.textContent = `Udfyld venligst: ${errs.join(', ')}.`; return; }
    S.submitted = true;
    S.submittedAt = new Date().toISOString();
    sendLead();
    // I produktion: POST payload til CRM/marketing automation her.
    go(5);
  });

  // Tooltip
  const tip = $('#tooltip');
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    tip.innerHTML = t.getAttribute('data-tip');
    tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14);
    tip.style.left = x + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });

  // Leadkort-drawer
  const drawer = $('#leadDrawer');
  $('#toggleLead').addEventListener('click', () => { drawer.hidden = false; renderLeadCard(results()); $('#closeLead').focus(); });
  $('#closeLead').addEventListener('click', () => { drawer.hidden = true; });
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer.hidden = true; });

  // Send leadet til backend, hvis siden er konfigureret med data-api (se api/lead.js)
  function sendLead() {
    const api = document.body.dataset.api;
    if (!api) return; // demo-tilstand: intet sendes
    const R = results();
    const { payload } = leadData(R);
    const ctx = nurtureCtx(R);
    fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead: payload, mailContext: { ...ctx, now: undefined } }) })
      .catch(() => { /* lead ligger stadig lokalt; kan gensendes */ });
  }
  function refreshSubmitLabel() {
    const btn = document.querySelector('#leadForm button[type=submit]');
    if (btn) btn.textContent = S.booking.slot && S.booking.slot.type === S.booking.type ? 'Bekræft møde og send min plan →' : S.booking.type === 'callback' ? 'Send – ring mig op →' : 'Send til en rådgiver →';
  }

  // Modal (mail-forhåndsvisning)
  $('#closeModal').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

  // Åbnet fra et gemt planlink?
  const m = location.hash.match(/^#plan=([A-Za-z0-9_-]+)/);
  if (m) {
    const p = EN.decodePlan(m[1]);
    if (p) {
      Object.assign(S, p);
      S.quiz = Object.assign({ i: 0, answers: {}, done: true }, p.quiz || {});
      S.submitted = false; S.restored = true; S.step = 5;
      S.visited = [0, 1, 2, 3, 4];
      history.replaceState(null, '', baseUrl());
    }
  }
  go(S.step || 0);
  S.restored = false;
  save();
})();
