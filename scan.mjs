// Haalt feeds op, beoordeelt nieuwe artikelen (met Claude als ANTHROPIC_API_KEY bestaat, anders met eenvoudige regels)
// en schrijft docs/data/items.json. Draait via GitHub Actions.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Parser from 'rss-parser';

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const DB = new URL('./docs/data/items.json', import.meta.url);
const MAX_AGE_DAYS = 30, MAX_ITEMS = 80, BATCH = 10;
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const fmtDate = ts => { const d = new Date(ts); return `${d.getDate()} ${NL[d.getMonth()]} ${d.getFullYear()}`; };

const SYSTEM = `Je bent content-strateeg voor een Nederlands horloge-Instagramaccount (Watchful).
Je krijgt nieuwsartikelen. Beoordeel elk artikel en antwoord UITSLUITEND met een JSON-array (geen tekst eromheen).
Per artikel een object:
{"id": "<zelfde id>", "relevant": true|false, "br": "merk of onderwerp (kort)", "t": "korte Nederlandse titel",
 "c": "Nieuwe release | Hype / drops | Samenwerking | Veiling / markt | Industrie | Haute horlogerie | Cultuur",
 "ig": 0-100, "u": 0-100, "what": "1-2 zinnen NL", "why": "1-2 zinnen NL", "f": ["2-3 postformats"], "h": "caption NL met hook, CTA en 4-6 hashtags"}
Zet relevant=false voor niet-horloge-nieuws of advertorials. Verzin geen feiten die niet in de tekst staan.`;

const BRANDS = ['Rolex', 'Omega', 'Patek', 'Audemars', 'Tudor', 'Grand Seiko', 'Seiko', 'Cartier', 'Hublot', 'Swatch', 'IWC', 'Breitling', 'TAG Heuer', 'Zenith', 'Vacheron', 'Lange', 'Panerai', 'Nomos', 'Oris', 'Longines', 'Tissot', 'Casio', 'G-Shock', 'Citizen', 'Bulova', 'Hamilton', 'Hanhart', 'Ebel'];
const BONUS = { Rolex: 20, Omega: 18, Patek: 15, Audemars: 15, Swatch: 15, Tudor: 12, Seiko: 10, 'Grand Seiko': 10, Cartier: 12, Hublot: 8 };
const WATCH = /watch|horloge|chronograph|dial|movement|caliber|calibre|bezel|reference|limited edition|dive|gmt|tourbillon/i;

// Eenvoudige beoordeling zonder AI (gratis, maar minder slim)
export function heuristic(a) {
  const txt = `${a.title} ${a.text}`;
  if (!WATCH.test(txt)) return { id: a.id, relevant: false };
  const br = BRANDS.find(b => txt.toLowerCase().includes(b.toLowerCase())) || 'Horloge';
  let c = 'Industrie';
  if (/auction|veiling|record price|sells for/i.test(txt)) c = 'Veiling / markt';
  else if (/collab|\bx\b|×|teams? up|partnership/i.test(txt)) c = 'Samenwerking';
  else if (/mcqueen|james bond|celebrity|spotted|movie|film/i.test(txt)) c = 'Cultuur';
  else if (/introduc|launch|unveil|new |release|hands-on|reissue|debut/i.test(txt)) c = 'Nieuwe release';
  const hrs = (Date.now() - a.ts) / 36e5;
  const u = hrs < 24 ? 85 : hrs < 48 ? 75 : hrs < 96 ? 60 : 40;
  const ig = Math.max(40, Math.min(92, 55 + (BONUS[br] || 0) + (c === 'Nieuwe release' ? 8 : 0) + (c === 'Cultuur' ? 12 : 0) + (c === 'Samenwerking' ? 6 : 0)));
  const f = { 'Nieuwe release': ['Carrousel: de belangrijkste details', 'Reel: close-up van het horloge', 'Poll: wat vind jij ervan?'], 'Veiling / markt': ['Carrousel: de cijfers uitgelegd'], 'Samenwerking': ['Carrousel: voor en na de samenwerking', 'Debat: top of flop?'], 'Cultuur': ['Reel: het verhaal erachter', 'Carrousel: de geschiedenis'] }[c] || ['Carrousel: korte uitleg'];
  return { id: a.id, relevant: true, br, t: a.title, c, ig, u,
    what: a.text.slice(0, 220) || a.title,
    why: 'Automatische inschatting zonder AI: gebaseerd op merk, onderwerp en hoe recent het bericht is.',
    f, h: `${a.title}\n\nWat vind jij? Laat het weten in de comments.\n\n#watches #horloges #watchesofinstagram${br !== 'Horloge' ? ' #' + br.toLowerCase().replace(/\s/g, '') : ''}` };
}

async function aiScore(batch) {
  const payload = batch.map(b => ({ id: b.id, bron: b.src, titel: b.title, tekst: b.text }));
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(payload) }] })
  });
  if (!r.ok) throw new Error('Anthropic API ' + r.status);
  const j = await r.json();
  const raw = j.content.filter(c => c.type === 'text').map(c => c.text).join('');
  return JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
}

async function main() {
  const feeds = JSON.parse(await fs.readFile(new URL('./feeds.json', import.meta.url), 'utf8'));
  let db = { updated: null, items: [], seen: [] };
  try { db = JSON.parse(await fs.readFile(DB, 'utf8')); } catch {}
  db.seen ||= [];
  const seen = new Set(db.seen);
  const parser = new Parser({ timeout: 15000, customFields: { item: [['media:content', 'media'], ['media:thumbnail', 'thumb'], ['content:encoded', 'full']] } });
  const since = Date.now() - 7 * 864e5, fresh = [];
  await Promise.all(feeds.map(async f => {
    try {
      const feed = await parser.parseURL(f.url);
      for (const e of feed.items.slice(0, 15)) {
        const ts = Date.parse(e.isoDate || e.pubDate || '') || Date.now();
        if (ts < since || !e.link || seen.has(hash(e.link))) continue;
        fresh.push({ id: hash(e.link), src: f.name, link: e.link, ts, title: e.title || '',
          img: e.enclosure?.url || e.media?.$?.url || e.thumb?.$?.url || (/<img[^>]+src=["']([^"']+)/.exec(e.full || e.content || '') || [])[1] || '',
          text: (e.contentSnippet || e.content || '').replace(/\s+/g, ' ').slice(0, 700) });
      }
    } catch (err) { console.warn(`Feed mislukt: ${f.name} (${err.message})`); }
  }));
  console.log(`${fresh.length} nieuwe artikelen; modus: ${KEY ? 'AI' : 'regels (zonder AI)'}`);
  const byId = Object.fromEntries(fresh.map(i => [i.id, i])), added = [];
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    try {
      const res = KEY ? await aiScore(batch) : batch.map(heuristic);
      for (const r of res) {
        const src = byId[r.id];
        if (!src || r.relevant === false) continue;
        added.push({ id: src.id, src: src.src, link: src.link, ts: src.ts, d: fmtDate(src.ts), img: src.img,
          br: r.br, t: r.t, c: r.c, ig: Math.max(0, Math.min(100, +r.ig || 0)), u: Math.max(0, Math.min(100, +r.u || 0)),
          what: r.what, why: r.why, f: r.f || [], h: r.h || '' });
      }
      batch.forEach(b => seen.add(b.id));
    } catch (err) { console.warn('Batch mislukt:', err.message); }
  }
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const items = [...added, ...db.items].filter(i => i.ts > cutoff).sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
  await fs.writeFile(DB, JSON.stringify({ updated: new Date().toISOString(), items, seen: [...seen].slice(-1000) }, null, 1));
  console.log(`Klaar: ${added.length} toegevoegd, ${items.length} in totaal`);
}
if (process.argv[1] && process.argv[1].endsWith('scan.mjs')) main().catch(e => { console.error(e); process.exit(1); });
