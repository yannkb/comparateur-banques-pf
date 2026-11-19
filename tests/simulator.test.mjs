import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annuityFactor, bareme, fraisAcquisition, capacite } from '../src/lib/simulator.js';

const data = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
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
