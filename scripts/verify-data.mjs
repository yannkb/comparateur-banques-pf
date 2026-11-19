#!/usr/bin/env node
// verify-data.mjs — version durcie (proposition de revue). Différences avec l'original :
//  * blancs normalisés en UNE espace (pas supprimés) + frontières de nombre contrôlées ;
//  * citation non vide après normalisation, valeur non vide après trim ;
//  * `num` doit figurer dans la citation (ou une citation `extra`), sauf champ `derived` explicite (avertissement) ;
//  * paramètres du simulateur et presets confrontés aux citations référencées ;
//  * dates de source cohérentes ; instantané confiné à data/sources/.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'data/sources') + sep;
const dataPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(root, 'data/banks.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const errors = [], warnings = [], infos = [], used = new Set(), cache = new Map();
const today = new Date().toISOString().slice(0, 10);

const norm = (s) => String(s).toLowerCase()
  .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'").replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
  .replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
// Comparaison tolérante aux blancs (artefacts PDF « 7, 14 % ») MAIS avec frontières contrôlées
// dans le texte d'origine : la citation ne doit pas commencer/finir au milieu d'un nombre.
function index(text) { // texte sans blancs + position d'origine de chaque caractère
  let flat = ''; const pos = [];
  for (let i = 0; i < text.length; i++) if (text[i] !== ' ') { flat += text[i]; pos.push(i); }
  return { text, flat, pos };
}
function contains(snap, quote) {
  const needle = quote.replace(/ /g, '');
  if (!needle) return false;
  for (let i = snap.flat.indexOf(needle); i !== -1; i = snap.flat.indexOf(needle, i + 1)) {
    const s = snap.pos[i], e = snap.pos[i + needle.length - 1];
    const before = snap.text[s - 1] ?? ' ', after = snap.text[e + 1] ?? ' ';
    const tail = snap.text.slice(e + 1, e + 6);
    const cutStart = /\d/.test(needle[0]) && /[\d.,]/.test(before);
    const cutEnd = /\d/.test(needle.at(-1)) && (/[\d]/.test(after) || /^[.,]\d/.test(tail) || /^ \d{3}(?![\d,])/.test(tail));
    if (!cutStart && !cutEnd) return true;
  }
  return false;
}
// Variantes d'écriture française d'un nombre (1 000 / 1.000 / 1000 ; 0,25 / 0.25).
function forms(v) {
  const out = new Set();
  const add = (x) => { const s = String(x); out.add(s); out.add(s.replace('.', ',')); };
  if (Number.isInteger(v)) { const g = v.toLocaleString('en-US').split(','); add(v); add(v.toFixed(2)); out.add(g.join(' ')); out.add(g.join('.')); }
  else { add(v); for (const d of [2, 3, 4]) add(v.toFixed(d)); }
  return [...out];
}
const numIn = (v, text) => (v >= 1e6 && Number.isInteger(v / 1e6) && new RegExp(`(^|[^0-9])${v / 1e6} ?(mf|millions)`).test(norm(text))) || forms(v).some((f) => new RegExp(`(^|[^0-9.,])${f.replace(/[.]/g, '\\.')}(?![0-9]|[.,][0-9])`).test(norm(text)));

// Valeur calculée déclarée : « 3 000 + 750 + 50 000 », « 951 / 3 », « min. 1 942 + 3 679 », « 25 ans × 12 ».
// Chaque opérande doit figurer dans les citations de l'entrée (sauf les diviseurs d'unité 3 et 12).
function evalDerived(expr, quotes) {
  const ops = [...expr.matchAll(/[+×*/÷-]/g)].map((x) => x[0]);
  const operands = expr.split(/[+×*/÷-]/).map((t) => t.replace(/[^\d,]/g, '').replace(',', '.'));
  if (!operands.length || operands.some((t) => !t)) return { error: 'illisible' };
  const vals = operands.map(Number);
  for (const v of vals) if (![3, 12].includes(v) && !numIn(v, quotes)) return { error: `: opérande ${v} absent de la citation` };
  let acc = vals[0];
  ops.forEach((o, i) => { const v = vals[i + 1]; acc = o === '+' ? acc + v : o === '-' ? acc - v : o === '/' || o === '÷' ? acc / v : acc * v; });
  return { value: acc };
}

// Barème « x % … minimum y » : le pourcentage doit être suivi de « % » et le minimum suivre le mot « minimum ».
function feeIn({ pct, min }, quote) {
  const q = norm(quote ?? '');
  const pctOk = forms(pct).some((f) => new RegExp(`(^|[^0-9.,])${f.replace(/[.]/g, '\\.')} ?%`).test(q));
  const m = /minimum[^0-9]*([0-9][0-9 .]*[0-9]|[0-9])/.exec(q);
  return pctOk && !!m && Number(m[1].replace(/[ .]/g, '')) === min;
}

function snapshot(id) {
  if (!cache.has(id)) {
    const src = data.sources[id];
    const p = src && resolve(root, src.snapshot);
    cache.set(id, p && p.startsWith(srcDir) && existsSync(p) ? index(norm(readFileSync(p, 'utf8'))) : null);
  }
  return cache.get(id);
}

// Valeurs à date d'effet : `changes: [{ effective_from: 'AAAA-MM-JJ', ...entrée complète }]`.
// Chaque changement est vérifié comme une entrée ; sa source ne peut pas être postérieure à sa date d'effet.
function checkChanges(e, where) {
  if (e.changes === undefined) return;
  if (!Array.isArray(e.changes) || !e.changes.length) return errors.push(`${where}: changes vide ou invalide`);
  e.changes.forEach((c, i) => {
    const w = `${where}.changes[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c?.effective_from || '')) return errors.push(`${w}: effective_from invalide`);
    if (c.changes) return errors.push(`${w}: changements imbriqués interdits`);
    checkEntry(c, w);
    const doc = data.sources[c.source]?.documentDate;
    if (doc && doc > c.effective_from) errors.push(`${w}: source ${c.source} datée du ${doc}, après la date d'effet ${c.effective_from}`);
    if (c.effective_from <= today) infos.push(`${w}: en vigueur depuis le ${c.effective_from} (à consolider dans l'entrée de base)`);
  });
}

function checkEntry(e, where) {
  if (!e || typeof e !== 'object') return errors.push(`${where}: entrée manquante`);
  if (e.status === 'found') {
    if (!String(e.value ?? '').trim()) errors.push(`${where}: valeur vide`);
    if (!e.source) return errors.push(`${where}: pas de source`);
    if (!data.sources[e.source]) return errors.push(`${where}: source inconnue « ${e.source} »`);
    used.add(e.source);
    const snap = snapshot(e.source);
    if (snap === null) return errors.push(`${where}: instantané absent ou hors data/sources pour ${e.source}`);
    const q = norm(e.quote ?? '');
    if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 8) return errors.push(`${where}: citation absente ou trop courte`);
    if (!contains(snap, q)) errors.push(`${where}: citation introuvable (ou coupant un nombre) dans ${e.source} → « ${String(e.quote).slice(0, 90)} »`);
    if (e.num !== undefined) {
      if (typeof e.num !== 'number' || !Number.isFinite(e.num)) errors.push(`${where}: num non numérique`);
      else {
        const quotes = [e.quote, ...(e.extra || []).map((x) => x.quote)].join(' | ');
        if (!numIn(e.num, quotes) && !(e.num === 0 && /gratuit/i.test(quotes))) {
          const r = typeof e.derived === 'string' ? evalDerived(e.derived, quotes) : { error: 'absent' };
          if (r.error) errors.push(`${where}: num ${e.num} absent de la citation (si c'est un calcul, ajouter "derived": "<calcul>") — derived ${r.error}`);
          else if (Math.abs(r.value - e.num) > 0.5) errors.push(`${where}: derived « ${e.derived} » = ${r.value}, pas ${e.num}`);
          else infos.push(`${where}: num ${e.num} calculé (${e.derived})`);
        }
      }
    }
    if (e.fee !== undefined) { // barème de frais (pct, min) utilisé pour classer par coût réel
      const ok = e.fee && Number.isFinite(e.fee.pct) && Number.isFinite(e.fee.min) && feeIn(e.fee, e.quote);
      if (!ok) errors.push(`${where}: fee ${JSON.stringify(e.fee)} absent de la citation`);
    }
    (e.extra || []).forEach((x, i) => checkEntry(x, `${where}.extra[${i}]`));
  } else if (e.status !== 'not_published') return errors.push(`${where}: statut invalide « ${e.status} »`);
  checkChanges(e, where);
  if (e.status === 'found') return;
  if (e.status === 'not_published') {
    if (!Array.isArray(e.checked) || !e.checked.length) return errors.push(`${where}: « non publié » sans source consultée`);
    for (const c of e.checked) { if (!data.sources[c]) errors.push(`${where}: source consultée inconnue « ${c} »`); else used.add(c); }
  } else errors.push(`${where}: statut invalide « ${e.status} »`);
}

const isDate = (s) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s || '');
for (const [id, s] of Object.entries(data.sources)) {
  for (const k of ['title', 'short', 'publisher', 'url', 'accessed', 'snapshot', 'dateLabel']) if (!s[k]) errors.push(`source ${id}: champ ${k} manquant`);
  if (!/^https?:\/\//.test(s.url || '')) errors.push(`source ${id}: URL invalide`);
  if (!resolve(root, s.snapshot || '').startsWith(srcDir)) errors.push(`source ${id}: instantané hors de data/sources/`);
  else if (!existsSync(join(root, s.snapshot))) errors.push(`source ${id}: fichier ${s.snapshot} absent`);
  if (!isDate(s.accessed) || s.accessed > today) errors.push(`source ${id}: date de consultation invalide ${s.accessed}`);
  if (s.documentDate && (!isDate(s.documentDate) || s.documentDate.slice(0, 4) > String(+s.accessed.slice(0, 4) + 1))) errors.push(`source ${id}: documentDate ${s.documentDate} postérieure à la consultation`);
  if (data.meta?.updated && s.accessed < data.meta.updated.slice(0, 4) - 1 + data.meta.updated.slice(4)) warnings.push(`source ${id}: consultée il y a plus d'un an (${s.accessed})`);
}

const fieldIds = data.fields.map((f) => f.id);
const stats = {};
for (const b of data.banks) {
  stats[b.id] = { found: 0, not_published: 0 };
  for (const f of fieldIds) {
    checkEntry(b.fields[f], `${b.id}.${f}`);
    if (b.fields[f]) stats[b.id][b.fields[f].status] = (stats[b.id][b.fields[f].status] || 0) + 1;
  }
  for (const k of Object.keys(b.fields)) if (!fieldIds.includes(k)) errors.push(`${b.id}: champ inconnu ${k}`);
  if (b.descriptionSource) checkEntry({ status: 'found', value: b.description, ...b.descriptionSource }, `${b.id}.description`);
}
for (const [k, e] of Object.entries(data.market)) checkEntry(e, `market.${k}`);

// Paramètres du simulateur : chaque paramètre cite (champ `cite`) l'une des citations de son entrée de
// référence, et chaque nombre du paramètre doit figurer dans CETTE citation (pas ailleurs dans l'entrée).
const quotesOf = (e) => (e ? [e.quote, ...(e.extra || []).map((x) => x.quote)].filter(Boolean) : []);
const pct = (v) => Math.round(v * 1e6) / 1e4; // 0.07 → 7 ; 0.001 → 0.1
const fr2 = (v) => v.toFixed(2).replace('.', ',');
for (const [k, p] of Object.entries(data.simulator.params)) {
  const where = `simulator.${k}`;
  if (!p.ref) { errors.push(`${where}: paramètre sans référence`); continue; }
  const m = data.market[p.ref];
  if (!m) { errors.push(`${where}: référence inconnue ${p.ref}`); continue; }
  if (m.status !== 'found') { errors.push(`${where}: référence non sourcée ${p.ref}`); continue; }
  const Q = quotesOf(m);
  if (k === 'xpfToEur') { // parité citée sous la forme « 1 euro = 119,332 F CFP »
    const x = /1 euro = ([\d ]+,\d+) f cfp/.exec(norm(Q.join(' | ')));
    const eurPerXpf = x && 1 / Number(x[1].replace(/ /g, '').replace(',', '.'));
    if (!eurPerXpf || Math.abs(p.value - eurPerXpf) / eurPerXpf > 1e-4) errors.push(`${where}: ${p.value} incompatible avec la parité citée dans ${p.ref}`);
    continue;
  }
  if (k === 'baremeS1') { // taux dans l'ordre exact, plafonds dans l'ordre
    const rates = p.tranches.map(([, r]) => `${fr2(r * 100)} %`).join(' ');
    if (!Q.some((q) => norm(q).includes(rates))) errors.push(`${where}: taux « ${rates} » absents (dans cet ordre) des citations de ${p.ref}`);
    const caps = p.tranches.filter(([c]) => c).map(([c]) => new RegExp(`(^|[^0-9])${c.toLocaleString('en-US').replace(/,/g, '[., ]')}(?![0-9])`));
    if (!Q.some((q) => { let at = 0; return caps.every((re) => { const r = re.exec(norm(q).slice(at)); if (!r) return false; at += r.index + r[0].length; return true; }); }))
      errors.push(`${where}: plafonds de tranches absents (dans cet ordre) des citations de ${p.ref}`);
    continue;
  }
  if (k === 'pretRatio') {
    if (Math.abs(p.value - 2 / 3) > 1e-6 || !Q.some((q) => /deux tiers/i.test(q))) errors.push(`${where}: 2/3 non cité`);
    if (!Q.some((q) => /deux tiers/i.test(q) && numIn(pct(p.hypothequeMajoration), q))) errors.push(`${where}: majoration hypothèque non citée`);
    continue;
  }
  if (k === 'debours') { if (p.value !== m.num) errors.push(`${where}: ${p.value} ≠ market.${p.ref}.num`); continue; }
  if (!p.cite) { errors.push(`${where}: champ « cite » manquant`); continue; }
  if (!Q.some((q) => norm(q) === norm(p.cite))) { errors.push(`${where}: « cite » n'est pas une citation de market.${p.ref}`); continue; }
  const nums = [];
  if (k === 'formalites') nums.push(p.avecPret, p.sansPret);
  else if (p.unit === '%') nums.push(pct(p.value));
  else nums.push(p.value);
  if (p.min !== undefined) nums.push(p.min);
  for (const v of nums) if (!numIn(v, p.cite)) errors.push(`${where}: valeur ${v} absente de la citation « ${p.cite.slice(0, 60)}… »`);
}
const entryOn = (e, iso) => [...(e?.changes || [])].filter((c) => c.effective_from <= iso).sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-1) || e;
for (const p of data.simulator.bankDossierPresets) {
  const e = data.banks.find((b) => b.id === p.ref?.[0])?.fields[p.ref?.[1]];
  if (!e || e.status !== 'found') { errors.push(`preset ${p.bank}: référence non sourcée`); continue; }
  const variants = [[p, e], ...(p.changes || []).map((c) => [{ ...p, ...c }, entryOn(e, c.effective_from)])];
  for (const [v, ent] of variants) {
    const at = v.effective_from ? ` au ${v.effective_from}` : '';
    if (v.effective_from && !/^\d{4}-\d{2}-\d{2}$/.test(v.effective_from)) errors.push(`preset ${p.bank}: effective_from invalide`);
    if (!feeIn(v, ent.quote)) errors.push(`preset ${p.bank}${at}: ${v.pct} % / min ${v.min} absents de la citation`);
  }
}
const D = data.simulator.defaults;
const dp = data.simulator.bankDossierPresets.find((p) => p.bank === D.preset);
if (!dp || D.fraisDossierPct !== dp.pct || D.fraisDossierMin !== dp.min) errors.push(`simulator.defaults: frais de dossier ≠ preset « ${D.preset} »`);

for (const f of readdirSync(join(root, 'data/sources'))) {
  const id = f.replace(/\.txt$/, '');
  if (!data.sources[id]) warnings.push(`instantané non référencé : data/sources/${f}`);
  else if (!used.has(id)) warnings.push(`source jamais utilisée : ${id}`);
}
console.log('Couverture (found / non publié) :');
for (const [id, s] of Object.entries(stats)) console.log(`  ${id.padEnd(8)} ${String(s.found).padStart(2)} / ${s.not_published}`);
infos.forEach((w) => console.log('ℹ ' + w));
warnings.forEach((w) => console.log('⚠ ' + w));
if (errors.length) { errors.forEach((e) => console.error('✗ ' + e)); console.error(`\n${errors.length} erreur(s).`); process.exit(1); }
if (process.argv.includes('--strict') && warnings.length) process.exit(1);
console.log(`✓ ${Object.keys(data.sources).length} sources, ${data.banks.length} établissements, toutes les citations vérifiées.`);
