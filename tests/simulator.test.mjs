import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveData } from '../src/lib/derive.js';
import { annuityFactor, bareme, fraisAcquisition, capacite, sanitize, taeg, seuilUsure, fraisDossier } from '../src/lib/simulator.js';

const data = deriveData(JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url))));
const P = data.simulator.params;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('facteur d’annuité 3 % / 300 mois (calcul manuel)', () => {
  near(annuityFactor(3, 300), 0.0047421131, 1e-9, 'facteur');
  near(annuityFactor(0, 120), 1 / 120, 1e-12, 'taux nul');
});

test('barème S1 : 28 MF → 452 000 XPF HT (exemple KP Finance)', () => {
  assert.equal(Math.round(bareme(28e6, P.baremeS1.tranches)), 452000);
});

test('frais KP : ancien 28 MF sans prêt → droits + publicité + émoluments TTC = 2 498 760', () => {
  const f = fraisAcquisition({ prix: 28e6, pretTotal: 0, pretBancaire: 0, typeBien: 'ancien', acquereurs: 1, garantie: 'hypotheque', fraisDossierPct: 1, fraisDossierMin: 0 }, P);
  const sub = ['droits', 'publicite', 'emolVente'].reduce((s, k) => s + f.lines.find((l) => l.key === k).amount, 0) + Math.round(452000 * 0.13);
  assert.equal(sub, 2498760);
});

test('cas de contrôle : 350 000 net, 30 000 de charges, 25 ans, 3 %, assurance 0,38 %', () => {
  const r = capacite({ ...data.simulator.defaults, revenu: 350000, charges: 30000, dureeAns: 25, taux: 3, assurance: 0.38, apport: 0, typeBien: 'ancien', ptz: false }, P);
  // Calcul manuel : 35 % × 350 000 − 30 000 = 92 500 ; prêt = 92 500 / (0,0047421131 + 0,0038/12) = 18 285 042
  near(r.mensualiteMax, 92500, 0.01, 'mensualité max');
  near(r.pretBancaire, 18285042, 1, 'prêt max');
  near(r.mensualite, 92500, 1, 'mensualité totale');
  near(r.prixMax, 16171248, 2, 'prix max (ancien, apport 0)');
  near(r.fraisPct, 13.07, 0.01, 'frais en % du prix');
});

test('primo-accédant : droits à 1 % sous 40 MF par acquéreur', () => {
  const f = fraisAcquisition({ prix: 30e6, pretTotal: 0, pretBancaire: 0, typeBien: 'primo', acquereurs: 1, garantie: 'caution', fraisDossierPct: 1, fraisDossierMin: 0 }, P);
  assert.equal(f.lines.find((l) => l.key === 'droits').amount, 300000);
  const f2 = fraisAcquisition({ prix: 50e6, pretTotal: 0, pretBancaire: 0, typeBien: 'primo', acquereurs: 1, garantie: 'caution', fraisDossierPct: 1, fraisDossierMin: 0 }, P);
  assert.equal(f2.lines.find((l) => l.key === 'droits').amount, 400000 + 700000);
});

test('PTZ : plafonné à 12 MF et mensualité respectée', () => {
  const r = capacite({ ...data.simulator.defaults, revenu: 600000, charges: 0, ptz: true }, P);
  assert.equal(r.ptz, 12000000);
  near(r.mensualite, r.mensualiteMax, 2, 'mensualité = capacité');
});

test('capacité nulle si charges > 35 % du revenu', () => {
  const r = capacite({ ...data.simulator.defaults, revenu: 100000, charges: 50000 }, P);
  assert.equal(r.pretTotal, 0);
});

const D = data.simulator.defaults;
const M = data.market;

test('M1 : sans capacité d’emprunt, l’apport finance un achat comptant (prix + frais = apport)', () => {
  const r = capacite({ ...D, revenu: 0, apport: 30e6 }, P);
  assert.equal(r.pretBancaire, 0);
  assert.ok(r.prixMax > 27e6, `prixMax ${r.prixMax}`);
  assert.ok(r.prixMax + r.frais.total <= 30e6 && r.prixMax + r.frais.total > 30e6 - 3, 'budget entièrement utilisé');
  assert.equal(r.frais.lines.find((l) => l.key === 'dossier').amount, 0, 'pas de frais de dossier sans prêt');
  assert.equal(r.frais.lines.find((l) => l.key === 'formalites').amount, P.formalites.sansPret);
});

test('M2 : seuil d’usure selon la durée (< 10, 10–20, ≥ 20 ans)', () => {
  assert.equal(seuilUsure(9, M).num, 4.09);
  assert.equal(seuilUsure(10, M).num, 4.68);
  assert.equal(seuilUsure(19, M).num, 4.68);
  assert.equal(seuilUsure(20, M).num, 5.4);
});

test('M2 : TAEG actuariel (frais + assurance) — 15 ans à 4,5 % + 0,38 % dépasse 4,68 %, 25 ans à 4,9 % dépasse 5,40 %', () => {
  near(taeg({ capital: 1e6, taux: 3, assurance: 0, n: 300 }), (1 + 0.0025) ** 12 * 100 - 100, 1e-6, 'sans frais ni assurance = taux actuariel du nominal');
  const r15 = capacite({ ...D, dureeAns: 15, taux: 4.5 }, P);
  assert.ok(r15.taeg > seuilUsure(15, M).num, `TAEG 15 ans ${r15.taeg}`);
  const r25 = capacite({ ...D, dureeAns: 25, taux: 4.9 }, P);
  assert.ok(4.9 + 0.38 < 5.4 && r25.taeg > 5.4, `TAEG 25 ans ${r25.taeg}`);
  const ok = capacite({ ...D, dureeAns: 25, taux: 3 }, P);
  assert.ok(ok.taeg < 5.4, `TAEG 3 % ${ok.taeg}`);
});

test('M3 : saisies assainies et signalées (vide, négatif, hors bornes)', () => {
  const { inputs, adjustments } = sanitize({ ...D, revenu: '', charges: -500000, endettement: 200, dureeAns: '', taux: -1200, acquereurs: 5, typeBien: 'primo' });
  assert.deepEqual([inputs.revenu, inputs.charges, inputs.endettement, inputs.dureeAns, inputs.taux, inputs.acquereurs], [0, 0, 60, 1, 0, 2]);
  const by = Object.fromEntries(adjustments.map((a) => [a.field, a.reason]));
  assert.deepEqual(by, { revenu: 'empty', charges: 'bounds', endettement: 'bounds', dureeAns: 'empty', taux: 'bounds', acquereurs: 'bounds' });
  assert.equal(sanitize(D).adjustments.length, 0, 'valeurs par défaut valides');
});

test('M4 : PTZ remboursé sur 25 ans max ; PTZ sur « ancien » ⇒ droits primo-accédant', () => {
  const r = capacite({ ...D, ptz: true, dureeAns: 30 }, P);
  assert.equal(r.nPtz, 300);
  near(r.mensualite, r.mensualiteMax, 2, 'mensualité = capacité');
  const a = capacite({ ...D, ptz: true, typeBien: 'ancien' }, P);
  const p = capacite({ ...D, ptz: true, typeBien: 'primo' }, P);
  assert.equal(a.prixMax, p.prixMax);
  assert.deepEqual(a.adjustments.map((x) => x.reason), ['ptz']);
});

test('M5 : frais de dossier au coût réel — pour 20 MF la BDP (0,75 %) est moins chère que Socredo et BT (1 %)', () => {
  const cost = (b) => { const e = data.banks.find((x) => x.id === b).fields.immo_frais_dossier; return fraisDossier(20e6, e.fee.pct, e.fee.min); };
  assert.equal(cost('bdp'), 150000);
  assert.equal(cost('socredo'), 200000);
  assert.ok(cost('bdp') < cost('socredo') && cost('bdp') < cost('bt'));
  assert.equal(fraisDossier(1e6, 0.75, 51300), 51300, 'petit prêt : minimum facturé');
});

test('M7 : postes issus d’une source secondaire signalés (formalités, débours, +25 % hypothèque, minimum de publicité)', () => {
  const f = fraisAcquisition({ prix: 1e6, pretTotal: 1e6, pretBancaire: 1e6, typeBien: 'ancien', acquereurs: 1, garantie: 'hypotheque', fraisDossierPct: 1, fraisDossierMin: 0 }, P);
  const sec = f.lines.filter((l) => l.secondary).map((l) => l.key).sort();
  assert.deepEqual(sec, ['debours', 'emolPret', 'formalites', 'publicite']);
  const g = fraisAcquisition({ prix: 20e6, pretTotal: 1e6, pretBancaire: 1e6, typeBien: 'ancien', acquereurs: 1, garantie: 'caution', fraisDossierPct: 1, fraisDossierMin: 0 }, P);
  assert.deepEqual(g.lines.filter((l) => l.secondary).map((l) => l.key).sort(), ['debours', 'formalites'], 'caution, publicité au taux : postes primaires');
});
