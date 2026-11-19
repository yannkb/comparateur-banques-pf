// Tests adversariaux du simulateur : comportement attendu. SIM=../src/lib/simulator.fixed.js pour tester le correctif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mod = await import(process.env.SIM || '../src/lib/simulator.js');
const { capacite } = mod;
const data = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const P = data.simulator.params;
const D = data.simulator.defaults;

test('S1 acheteur comptant (revenu 0, apport 30 MF) : prix max > 0', () => {
  const r = capacite({ ...D, revenu: 0, apport: 30e6 }, P);
  assert.ok(r.prixMax > 27e6, `prixMax = ${r.prixMax}`);
});
test('S2 charges > capacité mais apport 20 MF : l’apport reste mobilisable', () => {
  const r = capacite({ ...D, revenu: 100000, charges: 50000, apport: 20e6 }, P);
  assert.ok(r.prixMax > 17e6, `prixMax = ${r.prixMax}`);
});
test('S3 charges négatives ignorées', () => {
  assert.equal(capacite({ ...D, charges: -500000 }, P).pretBancaire, capacite({ ...D, charges: 0 }, P).pretBancaire);
});
test('S4 taux négatif / absurde borné', () => {
  const r = capacite({ ...D, taux: -1200 }, P);
  assert.ok(r.pretBancaire <= capacite({ ...D, taux: 0 }, P).pretBancaire);
});
test('S5 apport négatif ignoré', () => {
  assert.equal(capacite({ ...D, apport: -5e6 }, P).prixMax, capacite({ ...D, apport: 0 }, P).prixMax);
});
test('S6 PTZ remboursé sur 25 ans max même si le prêt bancaire dure 30 ans', () => {
  const r = capacite({ ...D, ptz: true, dureeAns: 30 }, P);
  // mensualité PTZ = 12 MF / 300 (et non / 360)
  const ptzPart = r.mensualiteCredit - r.pretBancaire * (3 / 1200) / (1 - (1 + 3 / 1200) ** -360);
  assert.ok(Math.abs(ptzPart - 12e6 / 300) < 2, `part PTZ mensuelle = ${ptzPart}`);
});
test('S7 primo : 3 acquéreurs saisis → plafonné à 2 (champ max=2)', () => {
  const a = capacite({ ...D, typeBien: 'primo', acquereurs: 3, revenu: 2e6, apport: 50e6 }, P);
  const b = capacite({ ...D, typeBien: 'primo', acquereurs: 2, revenu: 2e6, apport: 50e6 }, P);
  assert.equal(a.prixMax, b.prixMax);
});
test('S8 TAEG : 4,9 % + assurance 0,38 % + 1 % de frais sur 25 ans dépasse l’usure 5,40 %', () => {
  assert.ok(mod.taeg, 'pas de calcul de TAEG dans le simulateur (alerte = taux + assurance)');
  assert.ok(mod.taeg({ capital: 20e6, taux: 4.9, assurance: 0.38, n: 300, frais: 200000 }) > 5.40);
});
