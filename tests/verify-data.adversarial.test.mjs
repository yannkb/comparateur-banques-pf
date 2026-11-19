// Tests adversariaux du vérificateur : chaque cas DEVRAIT être rejeté (exit 1).
// Un test qui échoue ici = une faille du vérificateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = process.env.VERIFY_SCRIPT || new URL('../scripts/verify-data.mjs', import.meta.url).pathname;
const data = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const run = (d) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cbpf-adv-')), 'banks.json');
  writeFileSync(p, JSON.stringify(d));
  return spawnSync('node', [script, p], { encoding: 'utf8' });
};
const mustReject = (d) => {
  const r = run(d);
  assert.equal(r.status, 1, 'le vérificateur a accepté des données falsifiées');
  assert.match(r.stderr, /✗ /, `rejet sans diagnostic (plantage ?) : ${r.stderr.slice(0, 300)}`);
};
const clone = () => structuredClone(data);
const bank = (d, id) => d.banks.find((b) => b.id === id);

test('A1 valeur affichée falsifiée, citation intacte', () => {
  const d = clone();
  Object.assign(bank(d, 'socredo').fields.cpt_tenue, { value: '38 XPF/mois', num: 38 });
  mustReject(d);
});

test('A2 citation tronquée au milieu d’un nombre (383 → 38)', () => {
  const d = clone();
  Object.assign(bank(d, 'socredo').fields.cpt_tenue, { value: '38 XPF/mois', num: 38, quote: 'Tenue de compte à vue (forfait mensuel) 38' });
  mustReject(d);
});

test('A3 nombre recomposé par suppression des blancs (« 3 83 » ≡ « 383 »)', () => {
  const d = clone();
  bank(d, 'socredo').fields.cpt_tenue.quote = 'Tenue de compte à vue (forfait mensuel) 3 83';
  mustReject(d);
});

test('A4 citation composée uniquement de blancs (8 espaces)', () => {
  const d = clone();
  bank(d, 'socredo').fields.cpt_tenue.quote = '        ';
  mustReject(d);
});

test('A5 paramètre du simulateur falsifié (droits 7 % → 1 %)', () => {
  const d = clone();
  d.simulator.params.droitsAncien.value = 0.01;
  mustReject(d);
});

test('A6 barème S1 falsifié', () => {
  const d = clone();
  d.simulator.params.baremeS1.tranches[0][1] = 0.5;
  mustReject(d);
});

test('A7 parité XPF/EUR falsifiée (aucune référence)', () => {
  const d = clone();
  d.simulator.params.xpfToEur.value = 0.01;
  mustReject(d);
});

test('A8 preset de frais de dossier falsifié (BT 1 % → 0,1 %, min 1)', () => {
  const d = clone();
  Object.assign(d.simulator.bankDossierPresets.find((p) => p.bank === 'bt'), { pct: 0.1, min: 1 });
  mustReject(d);
});

test('A9 date de consultation périmée / incohérente', () => {
  const d = clone();
  d.sources.socredo_tarifs_2026.accessed = '1999-01-01';
  d.sources.socredo_tarifs_2026.documentDate = '2099-12-31';
  mustReject(d);
});

test('A10 chemin d’instantané hors de data/sources (lecture arbitraire)', () => {
  const d = clone();
  d.sources.evil = { ...d.sources.socredo_tarifs_2026, snapshot: 'package-lock.json' };
  Object.assign(bank(d, 'socredo').fields.cpt_tenue, { source: 'evil', quote: '"name": "comparateur-banques-pf"' });
  mustReject(d);
});

test('A11 valeur vide déguisée (une espace)', () => {
  const d = clone();
  bank(d, 'socredo').fields.cpt_tenue.value = ' ';
  mustReject(d);
});

test('A12 valeur de tri calculée sans déclaration « derived »', () => {
  const d = clone();
  delete bank(d, 'bt').fields.cpt_tenue.derived;
  mustReject(d);
});

test('A13 parité sans référence sourcée', () => {
  const d = clone();
  delete d.simulator.params.xpfToEur.ref;
  mustReject(d);
});

test('A14 instantané remonté hors de data/sources via « ../ »', () => {
  const d = clone();
  d.sources.socredo_tarifs_2026.snapshot = 'data/sources/../../package.json';
  mustReject(d);
});

test('A15 calcul « derived » faux (951 / 3 annoncé, num 300)', () => {
  const d = clone();
  bank(d, 'bt').fields.cpt_tenue.num = 300;
  mustReject(d);
});

test('A16 opérande d’un calcul « derived » absent de la citation', () => {
  const d = clone();
  Object.assign(bank(d, 'bt').fields.cpt_tenue, { num: 400, derived: '1 200 / 3' });
  mustReject(d);
});

test('A17 paramètre simulateur : « cite » qui n’est pas une citation de la référence', () => {
  const d = clone();
  Object.assign(d.simulator.params.droitsAncien, { value: 0.01, cite: 'droit réduit à 1 %' });
  mustReject(d);
});

test('les données versionnées passent la vérification stricte', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'cbpf-adv-')), 'banks.json');
  writeFileSync(p, JSON.stringify(data));
  assert.equal(spawnSync('node', [script, p, '--strict'], { encoding: 'utf8' }).status, 0);
});
