#!/usr/bin/env node
// Vérifie data/banks.json : chaque valeur « found » doit citer une source existante
// et sa citation (quote) doit figurer dans l'instantané texte de la source.
// Usage : node scripts/verify-data.mjs [chemin/banks.json] [--strict]  (--strict : les avertissements font échouer)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(root, 'data/banks.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const errors = [];
const warnings = [];
const used = new Set();
const cache = new Map();

// Normalisation : minuscules, apostrophes/guillemets unifiés, tout blanc supprimé.
const norm = (s) =>
  s.toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, '');

function snapshot(id) {
  if (!cache.has(id)) {
    const src = data.sources[id];
    const p = src && join(root, src.snapshot);
    cache.set(id, p && existsSync(p) ? norm(readFileSync(p, 'utf8')) : null);
  }
  return cache.get(id);
}

function checkEntry(e, where) {
  if (!e || typeof e !== 'object') return errors.push(`${where}: entrée manquante`);
  if (e.status === 'found') {
    if (!e.value) errors.push(`${where}: valeur vide`);
    if (!e.source) return errors.push(`${where}: pas de source`);
    if (!data.sources[e.source]) return errors.push(`${where}: source inconnue « ${e.source} »`);
    used.add(e.source);
    const snap = snapshot(e.source);
    if (snap === null) return errors.push(`${where}: instantané absent pour ${e.source}`);
    if (!e.quote || e.quote.length < 8) return errors.push(`${where}: citation absente ou trop courte`);
    if (!snap.includes(norm(e.quote))) errors.push(`${where}: citation introuvable dans ${e.source} → « ${e.quote.slice(0, 90)} »`);
    if (e.num !== undefined && typeof e.num !== 'number') errors.push(`${where}: num non numérique`);
    (e.extra || []).forEach((x, i) => checkEntry(x, `${where}.extra[${i}]`));
  } else if (e.status === 'not_published') {
    if (!Array.isArray(e.checked) || !e.checked.length) return errors.push(`${where}: « non publié » sans source consultée`);
    for (const c of e.checked) {
      if (!data.sources[c]) errors.push(`${where}: source consultée inconnue « ${c} »`);
      else used.add(c);
    }
  } else errors.push(`${where}: statut invalide « ${e.status} »`);
}

// Sources : champs obligatoires
for (const [id, s] of Object.entries(data.sources)) {
  for (const k of ['title', 'short', 'publisher', 'url', 'accessed', 'snapshot', 'dateLabel']) if (!s[k]) errors.push(`source ${id}: champ ${k} manquant`);
  if (!/^https?:\/\//.test(s.url || '')) errors.push(`source ${id}: URL invalide`);
  if (!existsSync(join(root, s.snapshot))) errors.push(`source ${id}: fichier ${s.snapshot} absent`);
}

// Banques : tous les champs présents
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

// Paramètres du simulateur : chaque paramètre renvoie à une entrée de marché ou de banque sourcée
for (const [k, p] of Object.entries(data.simulator.params)) {
  if (p.ref && !data.market[p.ref]) errors.push(`simulator.${k}: référence inconnue ${p.ref}`);
  if (p.ref && data.market[p.ref]?.status !== 'found') errors.push(`simulator.${k}: référence non sourcée ${p.ref}`);
}
for (const p of data.simulator.bankDossierPresets) {
  const e = data.banks.find((b) => b.id === p.ref[0])?.fields[p.ref[1]];
  if (!e || e.status !== 'found') errors.push(`preset ${p.bank}: référence non sourcée`);
}

// Instantanés non utilisés (avertissement)
for (const f of readdirSync(join(root, 'data/sources'))) {
  const id = f.replace(/\.txt$/, '');
  if (!data.sources[id]) warnings.push(`instantané non référencé : data/sources/${f}`);
  else if (!used.has(id)) warnings.push(`source jamais utilisée : ${id}`);
}

console.log('Couverture (found / non publié) :');
for (const [id, s] of Object.entries(stats)) console.log(`  ${id.padEnd(8)} ${String(s.found).padStart(2)} / ${s.not_published}`);
warnings.forEach((w) => console.log('⚠ ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('✗ ' + e));
  console.error(`\n${errors.length} erreur(s).`);
  process.exit(1);
}
if (process.argv.includes('--strict') && warnings.length) process.exit(1);
console.log(`✓ ${Object.keys(data.sources).length} sources, ${data.banks.length} établissements, toutes les citations vérifiées.`);
