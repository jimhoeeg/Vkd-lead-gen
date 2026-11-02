/*
 * POST /api/lead  – serverless-funktion (Vercel/Node 18+).
 *
 * 1) Validerer leadet
 * 2) Sender planmailen til landmanden via Resend (med .ics hvis der er booket møde)
 * 3) Sender en intern besked til rådgiverens indbakke med leadkortet
 * 4) Videresender leadet + opfølgningsplanen til CRM/marketing automation (webhook)
 *
 * Miljøvariabler:
 *   RESEND_API_KEY      – API-nøgle til Resend
 *   MAIL_FROM           – fx "VikingDanmark <plan@mail.vikingdanmark.dk>" (domænet skal være verificeret i Resend)
 *   ADVISOR_INBOXES     – JSON: {"nord":"raadgiver-nord@...", ...}  (valgfri)
 *   CRM_WEBHOOK_URL     – endpoint i CRM/marketing automation, der modtager lead + opfølgningsplan (valgfri)
 *   ALLOWED_ORIGIN      – fx https://www.vikingdanmark.dk (CORS)
 *
 * Opfølgningsmailene (dag 2-90) afvikles af marketing automation ud fra feltet `opfoelgning`,
 * så afmelding, frekvensloft og samtykke håndteres ét sted.
 *
 * Aktivér i frontend ved at sætte <body data-api="/api/lead">.
 */
const EN = require('../js/engage.js');

const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

async function sendMail({ to, subject, html, attachments }) {
  if (!process.env.RESEND_API_KEY) return { skipped: 'RESEND_API_KEY mangler' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, attachments }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const lead = body.lead || {};
  const k = lead.kontakt || {};
  if (!k.navn || !isEmail(k.email) || !k.samtykke) return res.status(400).json({ error: 'Navn, gyldig e-mail og samtykke er påkrævet' });

  const advisor = EN.advisorForZip(k.postnr);
  const ctx = { ...(body.mailContext || {}), name: k.navn, advisor, mailOptIn: !!k.mail_optin, unsubscribeUrl: body.mailContext && body.mailContext.unsubscribeUrl };
  const result = { mail: null, advisor: null, crm: null };

  // .ics til mødet
  let attachments;
  if (lead.booking && lead.booking.dato && advisor) {
    const ics = EN.buildICS({ date: lead.booking.dato, time: lead.booking.tid, type: lead.booking.type, advisor, description: `Din plan: ${lead.plan_url || ''}` });
    attachments = [{ filename: 'moede-med-raadgiver.ics', content: Buffer.from(ics).toString('base64') }];
  }

  try {
    const plan = EN.renderEmail('plan', ctx);
    result.mail = await sendMail({ to: k.email, subject: plan.subject, html: plan.html, attachments });

    const inboxes = JSON.parse(process.env.ADVISOR_INBOXES || '{}');
    if (advisor && inboxes[advisor.id]) {
      const html = `<h2>Nyt lead fra Avlsværktøjet (${lead.leadscore ? lead.leadscore.tier + ', ' + lead.leadscore.score + ' point' : ''})</h2>
<p><b>${k.navn}</b>, ${k.bedrift || ''} · ${k.telefon || ''} · ${k.email}</p>
<pre style="font-size:12px">${JSON.stringify(lead, null, 2).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`;
      result.advisor = await sendMail({ to: inboxes[advisor.id], subject: `Nyt lead: ${k.navn} (${(lead.besaetning || {}).aarskoeer || '?'} køer)`, html, attachments });
    }

    if (process.env.CRM_WEBHOOK_URL) {
      const r = await fetch(process.env.CRM_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead) });
      result.crm = r.status;
    }
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err), result });
  }
  return res.status(200).json({ ok: true, result });
};
