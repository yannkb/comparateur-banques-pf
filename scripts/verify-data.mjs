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
import { deriveData, derivationErrors } from '../src/lib/derive.js';
import { publishedBanks, rowsOf } from '../src/lib/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'data/sources') + sep;
const dataPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(root, 'data/banks.json');
const raw = JSON.parse(readFileSync(dataPath, 'utf8'));
const errors = [], warnings = [], infos = [], used = new Set(), cache = new Map();
// Cellules dérivées des catalogues (`from`) : références valides, aucune valeur ressaisie qui diverge ; puis on vérifie
// le jeu de données dérivé (les cellules recopiées sont contrôlées comme les autres).
errors.push(...derivationErrors(raw));
const data = deriveData(raw);
const today = new Date().toISOString().slice(0, 10);

// Ligatures typographiques des PDF (ﬁ, ﬀ…) ramenées à leurs lettres, comme les apostrophes et guillemets.
const norm = (s) => String(s).replace(/[\ufb00-\ufb06]/g, (c) => c.normalize('NFKC')).toLowerCase()
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
// Découpage d'une citation en nombres, dans l'ordre (« 3 804 » = 3804 ; « 11,52 » = 11.52 ; un groupe de milliers au plus,
// pour ne pas fusionner deux colonnes « 955 955 »). Sert au contrôle de position `pos` d'une valeur dans une ligne de tableau.
const numbersOf = (text) => [...norm(text).matchAll(/\d{1,2} \d{3}(?!\d)|\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(' ', '').replace(',', '.')));
const numIn = (v, text) => (v >= 1e6 && Number.isInteger(v / 1e6) && new RegExp(`(^|[^0-9])${v / 1e6} ?(mf|millions)`).test(norm(text))) || forms(v).some((f) => new RegExp(`(^|[^0-9.,])${f.replace(/[.]/g, '\\.')}(?![0-9]|[.,][0-9])`).test(norm(text)));

// Valeur calculée déclarée : « 3 000 + 750 + 50 000 », « 951 / 3 », « min. 1 942 + 3 679 », « 25 ans × 12 ».
// Chaque opérande doit figurer dans les citations de l'entrée (sauf les facteurs d'unité 3, 4 et 12 : mois, trimestres).
function evalDerived(expr, quotes) {
  const ops = [...expr.matchAll(/[+×*/÷-]/g)].map((x) => x[0]);
  const operands = expr.split(/[+×*/÷-]/).map((t) => t.replace(/[^\d,]/g, '').replace(',', '.'));
  if (!operands.length || operands.some((t) => !t)) return { error: 'illisible' };
  const vals = operands.map(Number);
  for (const v of vals) if (![3, 4, 12].includes(v) && !numIn(v, quotes)) return { error: `: opérande ${v} absent de la citation` };
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
        if (!numIn(e.num, quotes) && !(e.num === 0 && /gratuit|sans frais/i.test(quotes))) {
          const r = typeof e.derived === 'string' ? evalDerived(e.derived, quotes) : { error: 'absent' };
          if (r.error) errors.push(`${where}: num ${e.num} absent de la citation (si c'est un calcul, ajouter "derived": "<calcul>") — derived ${r.error}`);
          else if (Math.abs(r.value - e.num) > 0.5) errors.push(`${where}: derived « ${e.derived} » = ${r.value}, pas ${e.num}`);
          else infos.push(`${where}: num ${e.num} calculé (${e.derived})`);
        }
      }
    }
    if (e.pos !== undefined) { // ligne de tableau : `num` doit être le pos-ième nombre de la citation (pas un autre nombre de la ligne)
      const n = numbersOf(e.quote ?? '');
      if (!Number.isInteger(e.pos) || e.pos < 1 || typeof e.num !== 'number') errors.push(`${where}: pos invalide ou num absent`);
      else if (n[e.pos - 1] === undefined || Math.abs(n[e.pos - 1] - e.num) > 1e-9) errors.push(`${where}: num ${e.num} n'est pas le nombre n° ${e.pos} de la citation (${n.join(' | ')})`);
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

// ---------- Catalogues de produits (cartes…) : facettes déclaratives, attributs sourcés ----------
// Chaque attribut déclaré est présent sur chaque ligne (produit × variante) : soit sourcé + cité, soit « non publié »
// avec les sources consultées. Les codes (enum/bool) doivent être cohérents avec la citation (motif `match`).
const catalogs = data.catalogs || [], products = data.products || [];
const ATYPES = ['enum', 'bool', 'number', 'text', 'list'], FTYPES = ['enum', 'bool', 'anyOf', 'listHas', 'max', 'flag'];
const quotesText = (e) => norm([e.quote, ...(e.extra || []).map((x) => x.quote)].join(' | '));
const reOf = (s, where) => { try { return new RegExp(s, 'u'); } catch { errors.push(`${where}: motif invalide « ${s} »`); return null; } };
const catIds = new Set(), pstats = {};
for (const c of catalogs) {
  const w = `catalogue ${c.id}`;
  if (!c.id || catIds.has(c.id)) { errors.push(`${w}: id manquant ou en double`); continue; }
  catIds.add(c.id);
  if (!data.categories.some((x) => x.id === c.category)) errors.push(`${w}: rubrique inconnue ${c.category}`);
  const A = new Map();
  for (const a of c.attributes || []) {
    if (A.has(a.id)) errors.push(`${w}: attribut ${a.id} en double`);
    A.set(a.id, a);
    if (!ATYPES.includes(a.type)) errors.push(`${w}.${a.id}: type inconnu ${a.type}`);
    if (a.type === 'enum') for (const o of a.options || []) if (!o.match || !reOf(o.match, `${w}.${a.id}.${o.value}`)) errors.push(`${w}.${a.id}.${o.value}: motif « match » manquant`);
    if (a.type === 'bool' && (!a.match || !reOf(a.match, `${w}.${a.id}`))) errors.push(`${w}.${a.id}: motif « match » manquant`);
    if (a.type === 'list' && !(a.audiences || []).length) errors.push(`${w}.${a.id}: publics (audiences) manquants`);
  }
  const isA = (id, ...types) => A.has(id) && types.includes(A.get(id).type);
  if (c.cost && !isA(c.cost.attr, 'number')) errors.push(`${w}: cost.attr doit être un attribut numérique`);
  if (c.cost?.alt && !isA(c.cost.alt.attr, 'list')) errors.push(`${w}: cost.alt.attr doit être un attribut liste`);
  for (const s of c.summary || []) if (!A.has(s)) errors.push(`${w}: résumé : attribut inconnu ${s}`);
  const F = new Map(), params = new Set(), I = new Map();
  // Montants saisis par le visiteur (ex. montant emprunté) : bornes, paramètre d'URL, même défaut que le champ de comparaison partagé.
  for (const i of c.inputs || []) {
    const iw = `${w}.montant ${i.id}`;
    if (!i.id || I.has(i.id) || !String(i.label ?? '').trim()) errors.push(`${iw}: id ou libellé manquant, ou en double`);
    I.set(i.id, i);
    if (!i.param || params.has(i.param) || ['tri', 'np', 'vue'].includes(i.param)) errors.push(`${iw}: paramètre d'URL manquant, réservé ou en double`);
    params.add(i.param);
    if (!Number.isFinite(i.default) || i.default < (i.min ?? 0) || (i.max !== undefined && i.default > i.max)) errors.push(`${iw}: valeur par défaut hors bornes`);
    for (const f of data.fields.filter((x) => i.key && x.costFor?.key === i.key)) if (f.costFor.default !== i.default) errors.push(`${iw}: défaut ${i.default} ≠ ${f.id} (${f.costFor.default}) pour le montant partagé ${i.key}`);
  }
  if (c.cost?.amount && !I.has(c.cost.amount)) errors.push(`${w}: cost.amount ne désigne aucun montant saisi`);
  if (c.cost?.loan && !(c.cost.amount && isA(c.cost.loan.rate, 'number') && I.has(c.cost.loan.months) && String(c.cost.loan.label ?? '').trim())) errors.push(`${w}: cost.loan incomplet (montant, taux numérique, durée saisie, libellé)`);
  for (const a of c.absent || []) {
    if (!data.banks.some((b) => b.id === a.bank)) errors.push(`${w}.absent: banque inconnue ${a.bank}`);
    if (products.some((p) => p.kind === c.id && p.bank === a.bank)) errors.push(`${w}.absent: ${a.bank} a des produits dans ce catalogue`);
    if (a.status !== 'not_published') errors.push(`${w}.absent ${a.bank}: statut « not_published » attendu`);
    checkEntry(a, `${w}.absent ${a.bank}`);
  }
  for (const f of c.facets || []) {
    const fw = `${w}.facette ${f.id}`;
    F.set(f.id, f);
    if (!FTYPES.includes(f.type)) errors.push(`${fw}: type inconnu ${f.type}`);
    if (!f.param || params.has(f.param) || ['tri', 'np', 'vue'].includes(f.param)) errors.push(`${fw}: paramètre d'URL manquant, réservé ou en double`);
    params.add(f.param);
    const ok = f.type === 'enum' ? (f.field === 'bank' || isA(f.attr, 'enum'))
      : f.type === 'bool' ? isA(f.attr, 'bool')
        : f.type === 'anyOf' ? (f.choices || []).length > 0 && f.choices.every((ch) => ch.value && ch.attrs?.length && ch.attrs.every((x) => isA(x, 'bool')))
          : f.type === 'listHas' ? isA(f.attr, 'list') && !!f.listField && (f.values || []).every((v) => A.get(f.attr).audiences.some((x) => x.value === v))
            : f.type === 'max' ? f.cost === true && !!c.cost
              : f.type === 'flag' ? f.role === 'includeAlt' && !!c.cost?.alt : false;
    if (!ok) errors.push(`${fw}: incohérente avec les attributs déclarés`);
  }
  const S = new Set((c.sorts || []).map((s) => s.id));
  for (const s of c.sorts || []) for (const k of s.by || []) if (!(k.cost === 'total' ? !!c.cost?.loan : k.cost ? !!c.cost : k.field === 'bank' || isA(k.attr, 'enum', 'number'))) errors.push(`${w}.tri ${s.id}: clé invalide`);
  if (!S.has(c.defaultSort)) errors.push(`${w}: tri par défaut inconnu`);
  for (const p of c.presets || []) {
    const pw = `${w}.question ${p.id}`;
    if (p.sort && !S.has(p.sort)) errors.push(`${pw}: tri inconnu ${p.sort}`);
    for (const [k, v] of Object.entries(p.state || {})) {
      const f = F.get(k);
      if (!f) { errors.push(`${pw}: facette inconnue ${k}`); continue; }
      const opts = f.field === 'bank' ? data.banks.map((b) => b.id) : f.type === 'enum' ? A.get(f.attr).options.map((o) => o.value) : null;
      const valid = f.type === 'enum' ? Array.isArray(v) && v.length && v.every((x) => opts.includes(x))
        : f.type === 'bool' ? typeof v === 'boolean' : f.type === 'anyOf' ? f.choices.some((ch) => ch.value === v)
          : f.type === 'max' ? Number.isFinite(v) && v > 0 : v === true;
      if (!valid) errors.push(`${pw}: valeur invalide pour ${k}`);
    }
    for (const r of p.related || []) if (!(c.presets || []).some((x) => x.id === r.preset && x !== p)) errors.push(`${pw}: question liée inconnue ${r.preset}`);
  }
  if (c.compare && !(c.compare.attrs?.length === 2 && c.compare.attrs.every((x) => isA(x, 'number')))) errors.push(`${w}: compare doit citer deux attributs numériques`);
  for (const a of c.attributes || []) if (a.flagFalse !== undefined && (a.type !== 'bool' || !String(a.flagFalse).trim())) errors.push(`${w}.${a.id}: flagFalse réservé aux attributs booléens`);
}
const catalogOf = Object.fromEntries(catalogs.map((c) => [c.id, c]));
function checkAttr(a, e, where) {
  if (a.type === 'list') {
    if (!Array.isArray(e)) return errors.push(`${where}: liste attendue`);
    return e.forEach((x, i) => {
      const w = `${where}[${i}]`;
      if (!String(x?.name ?? '').trim()) errors.push(`${w}: nom manquant`);
      if (!a.audiences.some((o) => o.value === x?.audience)) errors.push(`${w}: public inconnu ${x?.audience}`);
      if (x?.status !== 'found' || typeof x.num !== 'number') errors.push(`${w}: offre non sourcée ou sans prix (num)`);
      checkAttr({ ...a, type: 'number' }, x, w);
    });
  }
  checkEntry(e, where);
  for (const [v, w] of [[e, where], ...(e?.changes || []).map((c, i) => [c, `${where}.changes[${i}]`])]) {
    if (v?.status === 'not_published') { if (v.code !== undefined || v.num !== undefined || v.value !== undefined) errors.push(`${w}: « non publié » portant une valeur`); continue; }
    if (v?.status !== 'found') continue;
    if (a.type === 'number' && typeof v.num !== 'number') errors.push(`${w}: num manquant (attribut numérique)`);
    if (a.type === 'enum') {
      if (Array.isArray(v.code) && (!a.multi || !v.code.length || new Set(v.code).size !== v.code.length)) errors.push(`${w}: plusieurs codes réservés aux attributs « multi » (sans doublon)`);
      for (const code of Array.isArray(v.code) ? v.code : [v.code]) {
        const o = a.options.find((x) => x.value === code);
        if (!o) errors.push(`${w}: code « ${code} » hors des options`);
        else if (!reOf(o.match, w)?.test(quotesText(v))) errors.push(`${w}: la citation ne justifie pas « ${o.label} » (motif ${o.match})`);
      }
    }
    if (a.type === 'bool') {
      if (typeof v.code !== 'boolean') errors.push(`${w}: code booléen manquant`);
      else if (!reOf(a.match, w)?.test(quotesText(v))) errors.push(`${w}: la citation ne parle pas de « ${a.label} » (motif ${a.match})`);
    }
  }
}
const prodIds = new Set();
for (const p of products) {
  const w = `produit ${p.id}`, c = catalogOf[p.kind];
  if (!p.id || prodIds.has(p.id)) { errors.push(`${w}: id manquant ou en double`); continue; }
  prodIds.add(p.id);
  if (!c) { errors.push(`${w}: catalogue inconnu ${p.kind}`); continue; }
  if (!data.banks.some((b) => b.id === p.bank)) errors.push(`${w}: banque inconnue ${p.bank}`);
  if (!String(p.name ?? '').trim()) errors.push(`${w}: nom manquant`);
  const vids = (p.variants || []).map((v) => v.id);
  if (p.variants && (!p.variants.length || new Set(vids).size !== vids.length || vids.some((x) => !x))) errors.push(`${w}: variantes invalides`);
  const ids = new Set(c.attributes.map((a) => a.id));
  for (const k of [...Object.keys(p.attrs || {}), ...(p.variants || []).flatMap((v) => Object.keys(v.attrs || {}))]) if (!ids.has(k)) errors.push(`${w}: attribut inconnu ${k}`);
  const st = (pstats[`${p.kind}:${p.bank}`] ||= { found: 0, not_published: 0 });
  const shared = data.banks.find((b) => b.id === p.bank)?.shared || {};
  for (const v of p.variants?.length ? p.variants : [null]) {
    const own = { ...p.attrs, ...(v?.attrs || {}) }, vw = v ? `${w}/${v.id}` : w;
    for (const a of c.attributes) {
      const inherited = a.shared && own[a.id] === undefined && shared[a.id] !== undefined;
      const e = inherited ? shared[a.id] : own[a.id];
      if (e === undefined) { if (!a.optional) errors.push(`${vw}.${a.id}: attribut manquant (sourcé, « non publié » ou hérité de la banque obligatoire)`); continue; }
      if (!inherited) checkAttr(a, e, `${vw}.${a.id}`);
      else if (a.type !== 'list') st.inherited = (st.inherited || 0) + 1;
      if (a.shared && !inherited && shared[a.id] !== undefined) { // redéfinition d'un attribut commun : justifiée, jamais contradictoire ni redondante
        const b = shared[a.id], { override, ...rest } = e;
        if (!String(override ?? '').trim()) errors.push(`${vw}.${a.id}: redéfinit l'attribut commun de la banque sans « override » (raison)`);
        if (JSON.stringify(rest) === JSON.stringify(b)) errors.push(`${vw}.${a.id}: redondant avec l'attribut commun de la banque (le supprimer)`);
        else if (e.source && e.source === b.source && norm(e.quote ?? '') === norm(b.quote ?? '') && (e.num !== b.num || JSON.stringify(e.code) !== JSON.stringify(b.code) || e.status !== b.status))
          errors.push(`${vw}.${a.id}: contredit l'attribut commun de la banque avec la même citation (${b.num ?? b.code} → ${e.num ?? e.code})`);
      } else if (e?.override !== undefined && !inherited) errors.push(`${vw}.${a.id}: « override » sans attribut commun à redéfinir`);
      if (a.type !== 'list') st[e?.status] = (st[e?.status] || 0) + 1;
    }
  }
}

// Attributs communs d'une banque (`bank.shared`) : déclarés une fois, hérités par les produits des catalogues dont
// l'attribut est marqué `shared` ; contrôlés comme un attribut de produit (codes, citations, changements).
const sharedDefs = new Map();
for (const c of catalogs) for (const a of c.attributes || []) if (a.shared) sharedDefs.set(a.id, a);
for (const b of data.banks) for (const [k, e] of Object.entries(b.shared || {})) {
  const a = sharedDefs.get(k);
  if (!a) errors.push(`${b.id}.shared.${k}: aucun attribut de catalogue « shared » ne porte cet id`);
  else checkAttr(a, e, `${b.id}.shared.${k}`);
}
// Liens entre catalogues (ex. carte incluse dans une offre groupée → fiche de la carte).
for (const p of products) for (const [pre, attrs] of [[p.id, p.attrs], ...(p.variants || []).map((v) => [`${p.id}/${v.id}`, v.attrs])]) {
  for (const [k, e] of Object.entries(attrs || {})) for (const x of [e, ...(e?.changes || [])]) {
    if (!x?.link) continue;
    const c = catalogOf[x.link.catalog];
    if (!c || !rowsOf(c, products, data.banks).some((r) => r.id === x.link.row)) errors.push(`produit ${pre}.${k}: lien vers ${x.link.catalog}/${x.link.row} introuvable`);
  }
}
// Règle des filtres : un critère n'est proposé en filtre que si au moins deux établissements le publient ; sinon il reste
// visible dans les fiches (« critère peu publié »).
for (const c of catalogs) {
  const rows = rowsOf(c, products, data.banks);
  for (const f of c.facets || []) {
    if (f.field || f.type === 'flag') continue;
    const attrs = f.type === 'anyOf' ? (f.choices || []).flatMap((ch) => ch.attrs || []) : f.type === 'max' ? [c.cost?.attr, c.cost?.alt?.attr].filter(Boolean) : [f.attr];
    const n = new Set(attrs.flatMap((a) => [...publishedBanks(rows, a)])).size;
    if (n < 2) errors.push(`catalogue ${c.id}.facette ${f.id}: critère publié par ${n} établissement(s) — moins de 2 : à garder dans les fiches (« critère peu publié »), pas en filtre`);
  }
}

// ---------- Repères officiels : tableaux (séries trimestrielles, seuils), règles, catalogues ----------
// Tableau : chaque cellule est une entrée sourcée avec `pos` (rang du nombre dans la ligne citée). Chaque source d'un tableau
// a un en-tête `headers[]` : citation présente dans l'instantané, libellés de colonnes dans l'ordre ; une cellule n'est
// acceptée que dans une colonne annoncée par l'en-tête de SA source, et pour une série, au rang de cette colonne.
const reperes = data.reperes;
let reperesCells = 0;
if (reperes !== undefined) {
  const catIdsR = new Set(catalogs.map((c) => c.id)), secIds = new Set();
  if (!Array.isArray(reperes.sections) || !reperes.sections.length) errors.push('reperes: sections manquantes');
  for (const s of reperes.sections || []) {
    const w = `reperes.${s.id}`;
    if (!s.id || secIds.has(s.id)) errors.push(`${w}: id manquant ou en double`);
    secIds.add(s.id);
    if (s.kind === 'catalog') {
      if (!catIdsR.has(s.catalog)) errors.push(`${w}: catalogue inconnu ${s.catalog}`);
      else if (catalogOf[s.catalog].category !== 'reperes') errors.push(`${w}: le catalogue ${s.catalog} n'est pas rattaché à la rubrique reperes`);
    } else if (s.kind === 'rules') {
      if (!(s.items || []).length) errors.push(`${w}: règles manquantes`);
      const ids = new Set();
      for (const it of s.items || []) {
        if (!it.id || ids.has(it.id) || !String(it.label ?? '').trim()) errors.push(`${w}.${it.id}: id ou libellé manquant`);
        ids.add(it.id);
        checkEntry(it, `${w}.${it.id}`);
      }
    } else if (s.kind === 'table') {
      const t = s.table || {};
      const cols = (t.columns || []).map((c) => c.id);
      if (!cols.length || new Set(cols).size !== cols.length) errors.push(`${w}: colonnes manquantes ou en double`);
      const heads = new Map();
      for (const h of t.headers || []) {
        const hw = `${w}.en-tête ${h.source}`;
        if (heads.has(h.source)) errors.push(`${hw}: en double`);
        heads.set(h.source, h);
        checkEntry({ status: 'found', value: h.labels?.join(' '), source: h.source, quote: h.quote }, hw);
        if (!Array.isArray(h.columns) || h.columns.length !== h.labels?.length || h.columns.some((c) => !cols.includes(c))) { errors.push(`${hw}: colonnes/libellés incohérents`); continue; }
        let at = 0; const q = norm(h.quote);
        for (const l of h.labels) { const i = q.indexOf(norm(l), at); if (i < 0) { errors.push(`${hw}: libellé « ${l} » absent (ou hors ordre) de la citation`); break; } at = i + norm(l).length; }
      }
      const rowIds = new Set();
      for (const r of t.rows || []) {
        const rw = `${w}.${r.id}`;
        if (!r.id || rowIds.has(r.id) || !String(r.label ?? '').trim()) errors.push(`${rw}: id ou libellé manquant`);
        rowIds.add(r.id);
        for (const [col, e] of Object.entries(r.cells || {})) {
          const cw = `${rw}[${col}]`;
          if (!cols.includes(col)) { errors.push(`${cw}: colonne inconnue`); continue; }
          checkEntry(e, cw);
          reperesCells++;
          if (e?.status !== 'found') continue;
          if (e.pos === undefined || typeof e.num !== 'number') errors.push(`${cw}: cellule chiffrée sans num/pos`);
          const h = heads.get(e.source);
          if (!h) { errors.push(`${cw}: aucun en-tête pour la source ${e.source}`); continue; }
          const k = h.columns.indexOf(col);
          if (k < 0) errors.push(`${cw}: la source ${e.source} ne publie pas la colonne ${col}`);
          else if (t.series) { // série : la ligne citée liste les valeurs dans l'ordre des colonnes de l'en-tête
            const offset = numbersOf(e.quote).length - h.columns.length;
            if (e.pos !== offset + k + 1) errors.push(`${cw}: rang ${e.pos} ≠ colonne ${col} (attendu ${offset + k + 1})`);
          }
        }
      }
      for (const e of t.apply || []) checkEntry(e, `${w}.apply`);
    } else errors.push(`${w}: type de section inconnu ${s.kind}`);
  }
}

for (const f of readdirSync(join(root, 'data/sources'))) {
  const id = f.replace(/\.txt$/, '');
  if (!data.sources[id]) warnings.push(`instantané non référencé : data/sources/${f}`);
  else if (!used.has(id)) warnings.push(`source jamais utilisée : ${id}`);
}
console.log('Couverture (found / non publié) :');
for (const [id, s] of Object.entries(stats)) console.log(`  ${id.padEnd(8)} ${String(s.found).padStart(2)} / ${s.not_published}`);
if (products.length) {
  console.log('Catalogues (attributs found / non publié) :');
  for (const [id, s] of Object.entries(pstats)) console.log(`  ${id.padEnd(16)} ${String(s.found).padStart(3)} / ${s.not_published}${s.inherited ? ` (dont ${s.inherited} hérités de la banque)` : ''}`);
}
infos.forEach((w) => console.log('ℹ ' + w));
warnings.forEach((w) => console.log('⚠ ' + w));
if (errors.length) { errors.forEach((e) => console.error('✗ ' + e)); console.error(`\n${errors.length} erreur(s).`); process.exit(1); }
if (process.argv.includes('--strict') && warnings.length) process.exit(1);
console.log(`✓ ${Object.keys(data.sources).length} sources, ${data.banks.length} établissements, ${products.length} produits catalogués, ${reperesCells} cellules de repères, toutes les citations vérifiées.`);
