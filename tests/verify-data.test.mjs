import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/verify-data.mjs', import.meta.url).pathname;
const data = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const run = (d) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cbpf-')), 'banks.json');
  writeFileSync(p, JSON.stringify(d));
  return spawnSync('node', [script, p], { encoding: 'utf8' });
};

test('les données versionnées passent la vérification', () => {
  assert.equal(run(data).status, 0);
});

test('une citation inventée est rejetée', () => {
  const d = structuredClone(data);
  const e = d.products.find((p) => p.id === 'cpt-socredo-compte').attrs.prix; // source de la cellule cpt_tenue (dérivée)
  e.quote = 'Tenue de compte à vue (forfait mensuel) 1';
  e.quote += '99';
  const r = run(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /citation introuvable/);
});

test('une valeur sans source est rejetée', () => {
  const d = structuredClone(data);
  delete d.products.find((p) => p.id === 'cpt-bt-compte').attrs.prix.source;
  assert.equal(run(d).status, 1);
});

test('« non publié » sans source consultée est rejeté', () => {
  const d = structuredClone(data);
  d.banks[2].fields.immo_taux.checked = [];
  assert.equal(run(d).status, 1);
});
