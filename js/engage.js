/*
 * Engagement-moduler: rådgiveropslag, booking (tider + .ics), delbart planlink
 * og opfølgningsforløb (nurture) med mailskabeloner.
 * Rene funktioner – bruges i browseren (window.VKEngage) og i Node (tests, api/).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Rådgivere (EKSEMPELDATA – erstattes af VikingDanmarks rådgiverliste)
  // ---------------------------------------------------------------------------
  const ADVISORS = [
    { id: 'nord', region: 'Nordjylland', title: 'Avlsrådgiver, Nordjylland', initials: 'NJ', zips: [[9000, 9999]] },
    { id: 'midtvest', region: 'Midt- og Vestjylland', title: 'Avlsrådgiver, Midt- og Vestjylland', initials: 'MV', zips: [[6900, 6999], [7400, 7999]] },
    { id: 'oest', region: 'Østjylland', title: 'Avlsrådgiver, Østjylland', initials: 'ØJ', zips: [[8000, 8999], [7100, 7399]] },
    { id: 'syd', region: 'Syd- og Sønderjylland', title: 'Avlsrådgiver, Syd- og Sønderjylland', initials: 'SJ', zips: [[6000, 6899], [7000, 7099]] },
    { id: 'oer', region: 'Fyn, Sjælland og øerne', title: 'Avlsrådgiver, Øerne', initials: 'ØR', zips: [[1000, 5999]] },
  ];

  function advisorForZip(zip) {
    const z = parseInt(String(zip || '').trim(), 10);
    if (!(z >= 1000 && z <= 9999)) return null;
    return ADVISORS.find((a) => a.zips.some(([lo, hi]) => z >= lo && z <= hi)) || null;
  }

  // ---------------------------------------------------------------------------
  // Mødetyper og ledige tider (DEMO – i produktion fra rådgivernes kalendere)
  // ---------------------------------------------------------------------------
  const MEETING_TYPES = {
    visit: { label: 'Besøg på bedriften', minutes: 60, times: ['08:00', '10:00', '13:00'] },
    video: { label: 'Videomøde', minutes: 30, times: ['08:30', '11:00', '14:00', '15:30'] },
    phone: { label: 'Telefonmøde', minutes: 20, times: ['08:30', '10:30', '12:30', '14:30', '16:00'] },
  };

  // Helligdage (dansk) – udvides ved behov
  const HOLIDAYS = new Set([
    '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31', '2027-01-01',
    '2027-03-25', '2027-03-26', '2027-03-28', '2027-03-29', '2027-05-06', '2027-05-16', '2027-05-17', '2027-06-05',
    '2027-12-24', '2027-12-25', '2027-12-26', '2027-12-31',
  ]);

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  // Simpel deterministisk hash, så demo-optaget-mønstret er stabilt
  const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /**
   * Ledige tider: de næste `days` hverdage fra dagen efter `now`, ekskl. helligdage.
   * Ca. en tredjedel af tiderne markeres som optaget (deterministisk demo).
   */
  function availableSlots(advisorId, type, now = new Date(), days = 8) {
    const mt = MEETING_TYPES[type];
    const out = [];
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    while (out.length < days) {
      d.setUTCDate(d.getUTCDate() + 1);
      const wd = d.getUTCDay();
      const date = ymd(d);
      if (wd === 0 || wd === 6 || HOLIDAYS.has(date)) continue;
      const times = mt.times.filter((t) => hash(`${advisorId}|${type}|${date}|${t}`) % 3 !== 0);
      out.push({ date, weekday: wd, times });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Tidszone (Europe/Copenhagen) og .ics
  // ---------------------------------------------------------------------------
  /** Sidste søndag i en måned (UTC-dato). */
  function lastSunday(year, month) {
    const d = new Date(Date.UTC(year, month + 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
  }
  /** Lokal dansk tid → UTC Date. Sommertid: sidste søndag i marts 01:00 UTC til sidste søndag i oktober 01:00 UTC. */
  function cphToUTC(date, time) {
    const [y, m, dd] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const asUTC = Date.UTC(y, m - 1, dd, hh, mm);
    const dstStart = lastSunday(y, 2).getTime() + 3600e3; // 01:00 UTC
    const dstEnd = lastSunday(y, 9).getTime() + 3600e3;
    const ifSummer = asUTC - 2 * 3600e3;
    const summer = ifSummer >= dstStart && ifSummer < dstEnd;
    return new Date(asUTC - (summer ? 2 : 1) * 3600e3);
  }

  const icsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function icsFold(line) {
    // RFC 5545: linjer max 75 oktetter – fold med CRLF + mellemrum (simpelt: på tegn)
    const out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }

  function buildICS({ date, time, type, advisor, summary, description, location, uid, now = new Date() }) {
    const mt = MEETING_TYPES[type];
    const start = cphToUTC(date, time);
    const end = new Date(start.getTime() + mt.minutes * 60e3);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Avlsvaerktoejet//Booking//DA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid || `${date}-${time.replace(':', '')}-${advisor.id}@avlsvaerktoejet`}`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEsc(summary || `${mt.label} med ${advisor.title}`)}`,
      `DESCRIPTION:${icsEsc(description || '')}`,
      `LOCATION:${icsEsc(location || (type === 'visit' ? 'På bedriften' : type === 'video' ? 'Link sendes på mail' : 'Rådgiveren ringer til dig'))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Påmindelse', 'TRIGGER:-PT1H', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // Delbart planlink: state → base64url i URL-hash (uden kontaktoplysninger)
  // ---------------------------------------------------------------------------
  const SHARE_KEYS = ['herd', 'breed', 'strategy', 'originalStrategy', 'prices', 'buffer', 'genomic', 'genBuffer', 'lasting', 'climate', 'dm', 'interests', 'quiz'];

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function encodePlan(state) {
    const o = { v: 1 };
    for (const k of SHARE_KEYS) if (state[k] !== undefined) o[k] = state[k];
    return b64urlEncode(JSON.stringify(o));
  }
  function decodePlan(token) {
    try {
      const o = JSON.parse(b64urlDecode(token));
      if (!o || o.v !== 1) return null;
      const out = {};
      for (const k of SHARE_KEYS) if (o[k] !== undefined) out[k] = o[k];
      return out;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Opfølgningsforløb (nurture)
  // ---------------------------------------------------------------------------
  const DAY = 86400e3;
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);

  /** Næste ensileringsvindue (1. maj før 1. slæt, 20. aug. før majs) efter `from`. */
  function nextSilageWindow(from) {
    const y = from.getUTCFullYear();
    const cands = [Date.UTC(y, 4, 1), Date.UTC(y, 7, 20), Date.UTC(y + 1, 4, 1), Date.UTC(y + 1, 7, 20)]
      .map((t) => new Date(t)).filter((d) => d.getTime() - from.getTime() >= 7 * DAY);
    return cands[0];
  }

  /**
   * Bygger opfølgningsforløbet ud fra brugerens resultater.
   * ctx: { now, profile, heiferBalance, potential, genomicNet, genomicTested, tax2030, tax2035,
   *        drySaving, dmMethod, focus, genomicAnswer, interests, booking, mailOptIn }
   * Regler: maks. én mail pr. 5 dage; planmailen sendes altid (dag 0), resten kun med mailOptIn.
   */
  function buildNurture(ctx) {
    const now = ctx.now || new Date();
    const mails = [];
    const add = (id, day, subject, reason, at) => mails.push({ id, at: at || addDays(now, day), subject, reason });

    add('plan', 0, 'Din plan fra Avlsværktøjet', 'Bekræftelse og link til dine beregninger');
    if (!ctx.mailOptIn) return finalize(mails);

    if (ctx.booking && ctx.booking.slot) add('prep', 2, 'Sådan får du mest ud af mødet med din rådgiver', 'Du har booket et møde');
    else add('book', 3, 'Skal vi regne dine tal igennem sammen?', 'Ingen møde booket endnu');

    if (ctx.heiferBalance < -0.5) add('heifer-short', 7, `Sådan lukker du hullet på ${Math.round(-ctx.heiferBalance)} kvier om året`, 'Kvieunderskud i kvieplanen');
    else if (ctx.heiferBalance > 0.05 * (ctx.need || 1)) add('heifer-surplus', 7, 'Dine overskudskvier koster mere, end du tror', 'Kvieoverskud i kvieplanen');
    else if (ctx.potential > 5000) add('heifer-calves', 7, 'Gør flere af dine kalve mere værd', 'Gevinst ved anbefalet strategi');

    if (ctx.genomicAnswer !== 'all' || (ctx.interests && ctx.interests.test)) add('genomic', 14, 'Hvornår tjener genomisk test sig hjem hos dig?', 'Genomtester ikke alle kviekalve');

    if (ctx.dmMethod === 'never' || ctx.dmMethod === 'monthly' || (ctx.interests && ctx.interests.nir)) {
      const w = nextSilageWindow(now);
      const inWindow = w && w.getTime() - now.getTime() <= 120 * DAY;
      add('nir', 21, inWindow ? 'Før ensilering: hvad koster svingende tørstof dig?' : 'Hvad koster svingende tørstof dig?', inWindow ? 'Sendes op til næste ensilering' : 'Ingen løbende tørstofmåling', inWindow ? addDays(w, -14) : null);
      mails[mails.length - 1].seasonal = !!inWindow;
    }

    if (ctx.focus === 'climate' || (ctx.interests && ctx.interests.climate)) add('climate', 30, 'Klimaafgiften: dit tal for 2030 og hvad avlen kan nå', 'Klimafokus');

    add('checkin', 90, 'Har dine tal ændret sig?', 'Genbesøg efter 3 måneder');
    return finalize(mails);
  }

  function finalize(mails) {
    mails.sort((a, b) => a.at - b.at);
    // Mindst 5 dage mellem mails (planmailen undtaget)
    for (let i = 1; i < mails.length; i++) {
      const min = mails[i - 1].at.getTime() + (i === 1 ? 2 : 5) * DAY;
      if (mails[i].at.getTime() < min) mails[i].at = new Date(min);
    }
    return mails;
  }

  // ---------------------------------------------------------------------------
  // Mailskabeloner (e-mail-sikker HTML: tabeller + inline styles)
  // ---------------------------------------------------------------------------
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = (v) => new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format(Math.round(v));
  const krS = (v) => `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${nf(Math.abs(v))} kr.`;
  const fmtDate = (date) => new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));

  const BRAND = { color: '#1d4a3a', soft: '#e1ece5', ink: '#15201b', muted: '#6c716c', bg: '#f4f2ec' };

  function shell(title, preheader, inner, ctx) {
    return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink}">
<div style="display:none;max-height:0;overflow:hidden">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${BRAND.color};color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">Avlsværktøjet</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:${BRAND.muted};border-top:1px solid #eee">Du får denne mail, fordi du har brugt Avlsværktøjet${ctx.mailOptIn ? ' og sagt ja til opfølgning' : ''}. <a href="${e(ctx.unsubscribeUrl || '#')}" style="color:${BRAND.muted}">Afmeld</a>.</td></tr>
</table></td></tr></table></body></html>`;
  }
  const btn = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="background:${BRAND.color};border-radius:8px"><a href="${e(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:bold">${e(label)}</a></td></tr></table>`;
  const kv = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${e(k)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">${e(v)}</td></tr>`).join('')}</table>`;

  function renderEmail(id, ctx) {
    const first = (ctx.name || '').split(' ')[0] || 'Hej';
    const hi = `<p>${first === 'Hej' ? 'Hej' : 'Hej ' + e(first)},</p>`;
    const plan = ctx.planUrl || '#';
    const book = ctx.bookUrl || plan;
    const adv = ctx.advisor ? ctx.advisor.title : 'din lokale avlsrådgiver';
    let subject, pre, body;
    switch (id) {
      case 'plan':
        subject = 'Din plan fra Avlsværktøjet';
        pre = 'Dine beregninger samlet ét sted, klar til at blive justeret.';
        body = `${hi}<p>Tak, fordi du brugte Avlsværktøjet. Her er dine vigtigste tal for ${nf(ctx.cows)} årskøer:</p>
${kv([
  ['Kviebalance i dag', `${ctx.heiferBalance > 0.5 ? '+' : ctx.heiferBalance < -0.5 ? '−' : ''}${nf(Math.abs(ctx.heiferBalance))} kvier/år`],
  ['Anbefalet kvieplan', `${krS(ctx.potential)} pr. år`],
  ['Genomisk test, netto', `${krS(ctx.genomicNet)} pr. år`],
  ['Klimaafgift 2035 (estimat)', `${nf(ctx.tax2035)} kr.`],
  ['Tørstof, mulig gevinst', `${nf(Math.max(0, ctx.drySaving))} kr. pr. år`],
])}
${ctx.booking && ctx.booking.slot ? `<p><b>Dit møde:</b> ${e(ctx.booking.typeLabel)} med ${e(adv)}, ${e(fmtDate(ctx.booking.slot.date))} kl. ${e(ctx.booking.slot.time)}. Rådgiveren har dine beregninger med.</p>` : `<p>Vil du have dine tal gennemgået? ${e(adv)} kan regne dem igennem med dig.</p>`}
${btn(plan, 'Åbn og justér din plan')}
<p style="font-size:13px;color:${BRAND.muted}">Linket åbner dine beregninger igen. Dine kontaktoplysninger er ikke en del af linket.</p>`;
        break;
      case 'prep':
        subject = 'Sådan får du mest ud af mødet med din rådgiver';
        pre = 'Tre ting, der gør mødet mere konkret.';
        body = `${hi}<p>Du har et møde med ${e(adv)} ${ctx.booking && ctx.booking.slot ? e(fmtDate(ctx.booking.slot.date)) + ' kl. ' + e(ctx.booking.slot.time) : ''}. Mødet bliver mest konkret, hvis du har tænkt over:</p>
<ol><li>Hvor mange kvier du har på stald nu, og hvornår de skal kælve</li><li>Hvilke strå du har på lager, og hvad du bruger på kvier og køer i dag</li><li>Om du har planer om at udvide eller skære ned de næste 3 år</li></ol>
${btn(plan, 'Se dine beregninger igen')}`;
        break;
      case 'book':
        subject = 'Skal vi regne dine tal igennem sammen?';
        pre = `Din kvieplan viser ${krS(ctx.potential)} om året.`;
        body = `${hi}<p>Din kvieplan viste en mulig gevinst på <b>${krS(ctx.potential)} om året</b>. Tallene bygger på standardantagelser. En gennemgang med ${e(adv)} gør dem til dine egne tal: priser, drægtighed og stalden.</p>${btn(book, 'Book en gennemgang')}`;
        break;
      case 'heifer-short':
        subject = `Sådan lukker du hullet på ${nf(-ctx.heiferBalance)} kvier om året`;
        pre = 'Kønssorteret sæd på de rigtige dyr, og hvorfor det tager 3 år at mærke.';
        body = `${hi}<p>Din kvieplan viste, at du mangler ca. <b>${nf(-ctx.heiferBalance)} kvier om året</b>. Det betyder enten indkøb (og smitterisiko) eller køer, der bliver længere end planlagt.</p>
<p><b>Hurtigste vej:</b> Kønssorteret sæd på alle kvier, da de har den højeste drægtighed, og derefter på de genetisk bedste køer. Husk at en kalv, der bliver til i dag, kælver om ca. 3 år. Derfor tæller hver måned.</p>${btn(plan, 'Se din anbefalede strategi')}`;
        break;
      case 'heifer-surplus':
        subject = 'Dine overskudskvier koster mere, end du tror';
        pre = 'Hver ekstra kvie koster opdræt. En krydsningskalv sælges efter få uger.';
        body = `${hi}<p>Du opdrætter flere kvier, end du bruger. Hver ekstra kvie koster opdræt, og hvis salgsprisen ikke dækker, taber du penge på hver eneste. Kødkvæg på de dyr, der ikke skal levere kvier, giver krydsningskalve, som kan sælges efter få uger.</p>${btn(plan, 'Se din kvieplan')}`;
        break;
      case 'heifer-calves':
        subject = 'Gør flere af dine kalve mere værd';
        pre = `Anbefalet kvieplan: ${krS(ctx.potential)} pr. år.`;
        body = `${hi}<p>Din kviebalance passer, men kalvene kan blive mere værd. Den anbefalede strategi giver <b>${krS(ctx.potential)} om året</b>: kønssorteret sæd til de kvier, du skal bruge, og kødkvæg på resten.</p>${btn(plan, 'Se beregningen')}`;
        break;
      case 'genomic':
        subject = 'Hvornår tjener genomisk test sig hjem hos dig?';
        pre = 'Testen har kun værdi, når du bruger den til en beslutning.';
        body = `${hi}<p>Med dine tal giver genomisk test af ca. ${nf(ctx.genomicTested)} kviekalve om året <b>${krS(ctx.genomicNet)} netto</b> på avlsfremgang alene. Dertil kommer afstamningskontrol og bærerstatus for arvelige defekter.</p>
<p>Testen betaler sig bedst, når du bruger den til at vælge, hvilke dyr der skal have kønssorteret sæd, og hvilke der skal have kødkvæg.</p>${btn(plan, 'Se din beregning')}`;
        break;
      case 'nir':
        subject = ctx.nirSeasonal ? 'Før ensilering: hvad koster svingende tørstof dig?' : 'Hvad koster svingende tørstof dig?';
        pre = `Mulig gevinst: ${nf(Math.max(0, ctx.drySaving))} kr. om året.`;
        body = `${hi}<p>Tørstoffet svinger mest, når en ny stak åbnes. Din beregning viste, at løbende måling kan spare ca. <b>${nf(Math.max(0, ctx.drySaving))} kr. om året</b>.</p>
<p>Med NIR på finsnitteren får du tørstof og udbytte pr. mark og læs, allerede når du kører ind. NIR på blandevognen retter rationen ved hver blanding.</p>${btn(book, 'Book en NIR-demo')}`;
        break;
      case 'climate':
        subject = 'Klimaafgiften: dit tal for 2030 og hvad avlen kan nå';
        pre = `Estimat: ${nf(ctx.tax2030)} kr. i 2030 og ${nf(ctx.tax2035)} kr. i 2035.`;
        body = `${hi}<p>Med dine tal ser klimaafgiften ud til at blive ca. <b>${nf(ctx.tax2030)} kr. i 2030</b>, stigende til <b>${nf(ctx.tax2035)} kr. i 2035</b>.</p>
<p>Tyre, der er valgt nu, giver døtre, som kælver omkring 2030. Metanindekset og Saved Feed kan vægtes i din avlsplan allerede fra næste tyrevalg.</p>${btn(plan, 'Se din klimaberegning')}`;
        break;
      case 'checkin':
      default:
        subject = 'Har dine tal ændret sig?';
        pre = 'Priser og besætning ændrer sig. Din plan kan opdateres på 2 minutter.';
        body = `${hi}<p>Det er tre måneder siden, du lavede din plan. Kalvepriser, kviepriser og din besætning ændrer sig, og så ændrer den bedste strategi sig også.</p>${btn(plan, 'Opdatér din plan')}`;
    }
    return { subject, html: shell(subject, pre, body, ctx) };
  }

  const api = {
    ADVISORS, MEETING_TYPES, HOLIDAYS,
    advisorForZip, availableSlots, cphToUTC, buildICS,
    encodePlan, decodePlan, b64urlEncode, b64urlDecode,
    buildNurture, nextSilageWindow, renderEmail, fmtDate,
  };
  root.VKEngage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
