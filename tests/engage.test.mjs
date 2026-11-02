import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../js/engage.js');

test('rådgiver findes ud fra postnummer', () => {
  assert.equal(E.advisorForZip('9800').id, 'nord');
  assert.equal(E.advisorForZip('6270').id, 'syd');       // Tønder
  assert.equal(E.advisorForZip('6800').id, 'syd');       // Varde
  assert.equal(E.advisorForZip('7500').id, 'midtvest');  // Holstebro
  assert.equal(E.advisorForZip('8830').id, 'oest');      // Tjele
  assert.equal(E.advisorForZip('5000').id, 'oer');
  assert.equal(E.advisorForZip('abc'), null);
  assert.equal(E.advisorForZip('999'), null);
  // alle postnumre 1000-9999 dækkes af præcis én rådgiver
  for (let z = 1000; z <= 9999; z++) {
    const n = E.ADVISORS.filter((a) => a.zips.some(([lo, hi]) => z >= lo && z <= hi)).length;
    assert.equal(n, 1, `postnr ${z} dækkes ${n} gange`);
  }
});

test('ledige tider springer weekend og helligdage over', () => {
  const now = new Date(Date.UTC(2026, 11, 22)); // tirsdag 22/12-2026
  const days = E.availableSlots('nord', 'visit', now, 6);
  assert.equal(days.length, 6);
  for (const d of days) {
    const wd = new Date(d.date + 'T12:00:00Z').getUTCDay();
    assert.ok(wd >= 1 && wd <= 5, d.date);
    assert.ok(!E.HOLIDAYS.has(d.date), d.date);
  }
  assert.equal(days[0].date, '2026-12-23');
  assert.equal(days[1].date, '2026-12-28');
  // deterministisk
  assert.deepEqual(days, E.availableSlots('nord', 'visit', now, 6));
});

test('dansk tid → UTC håndterer sommer- og vintertid', () => {
  assert.equal(E.cphToUTC('2026-11-10', '10:00').toISOString(), '2026-11-10T09:00:00.000Z');
  assert.equal(E.cphToUTC('2027-06-10', '10:00').toISOString(), '2027-06-10T08:00:00.000Z');
  // skiftedage 2027: 28/3 og 31/10
  assert.equal(E.cphToUTC('2027-03-29', '08:00').toISOString(), '2027-03-29T06:00:00.000Z');
  assert.equal(E.cphToUTC('2027-03-26', '08:00').toISOString(), '2027-03-26T07:00:00.000Z');
  assert.equal(E.cphToUTC('2027-11-01', '08:00').toISOString(), '2027-11-01T07:00:00.000Z');
});

test('.ics er gyldig og har korrekt start/slut', () => {
  const ics = E.buildICS({ date: '2026-11-10', time: '10:00', type: 'visit', advisor: E.ADVISORS[0], description: 'Kvieplan; genomisk test, NIR', now: new Date(Date.UTC(2026, 10, 2)) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART:20261110T090000Z'));
  assert.ok(ics.includes('DTEND:20261110T100000Z'));
  assert.ok(ics.includes('DESCRIPTION:Kvieplan\\; genomisk test\\, NIR'));
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 75, line);
});

test('planlink: kodning frem og tilbage, uden kontaktoplysninger', () => {
  const state = { herd: { cows: 312 }, breed: 'jersey', quiz: { answers: { focus: 'climate' } }, contact: { name: 'Æble Ø', email: 'x@y.dk' }, interests: { nir: true } };
  const tok = E.encodePlan(state);
  assert.match(tok, /^[A-Za-z0-9_-]+$/);
  const back = E.decodePlan(tok);
  assert.equal(back.herd.cows, 312);
  assert.equal(back.breed, 'jersey');
  assert.equal(back.contact, undefined);
  assert.equal(E.decodePlan('ikke-gyldig!!'), null);
});

test('nurture: kun planmail uden samtykke til opfølgning', () => {
  const m = E.buildNurture({ now: new Date(Date.UTC(2026, 10, 2)), mailOptIn: false, heiferBalance: -8 });
  assert.deepEqual(m.map((x) => x.id), ['plan']);
});

test('nurture: regler, rækkefølge og afstand', () => {
  const now = new Date(Date.UTC(2026, 10, 2));
  const m = E.buildNurture({ now, mailOptIn: true, heiferBalance: -8, need: 95, potential: 35000, genomicAnswer: 'no', dmMethod: 'never', focus: 'climate', interests: {}, booking: { slot: { date: '2026-11-10', time: '10:00' } } });
  const ids = m.map((x) => x.id);
  assert.deepEqual(ids.slice(0, 2), ['plan', 'prep']);
  for (const id of ['heifer-short', 'genomic', 'nir', 'climate', 'checkin']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('book'));
  for (let i = 2; i < m.length; i++) assert.ok(m[i].at - m[i - 1].at >= 5 * 86400e3 - 1, `${m[i].id} for tæt på`);
  for (let i = 1; i < m.length; i++) assert.ok(m[i].at >= m[i - 1].at);
});

test('nurture: NIR-mail lander før ensilering, hvis den er inden for 4 måneder', () => {
  const now = new Date(Date.UTC(2027, 2, 15)); // 15. marts → 1. maj er 47 dage væk
  const m = E.buildNurture({ now, mailOptIn: true, heiferBalance: 0, need: 95, potential: 0, genomicAnswer: 'all', dmMethod: 'never', interests: {} });
  const nir = m.find((x) => x.id === 'nir');
  assert.equal(nir.at.toISOString().slice(0, 10), '2027-04-17');
  assert.ok(nir.subject.startsWith('Før ensilering'));
  // i november er næste ensilering for langt væk → neutral emnelinje
  const nov = E.buildNurture({ now: new Date(Date.UTC(2026, 10, 2)), mailOptIn: true, heiferBalance: 0, need: 95, potential: 0, genomicAnswer: 'all', dmMethod: 'never', interests: {} });
  assert.equal(nov.find((x) => x.id === 'nir').subject, 'Hvad koster svingende tørstof dig?');
});

test('alle mailskabeloner renderer uden huller', () => {
  const ctx = { name: 'Jens Hansen', cows: 250, heiferBalance: -8, potential: 35038, genomicNet: -521, genomicTested: 101, tax2030: 168000, tax2035: 420000, drySaving: 68803, planUrl: 'https://x/#plan=a', advisor: E.ADVISORS[0], mailOptIn: true, booking: { typeLabel: 'Besøg på bedriften', slot: { date: '2026-11-10', time: '10:00' } } };
  for (const id of ['plan', 'prep', 'book', 'heifer-short', 'heifer-surplus', 'heifer-calves', 'genomic', 'nir', 'climate', 'checkin']) {
    const { subject, html } = E.renderEmail(id, ctx);
    assert.ok(subject.length > 5);
    assert.ok(!/undefined|NaN/.test(html), `${id} indeholder undefined/NaN`);
    assert.ok(html.includes('Hej Jens'));
  }
  assert.ok(E.renderEmail('plan', ctx).html.includes('tirsdag 10. november'));
});
