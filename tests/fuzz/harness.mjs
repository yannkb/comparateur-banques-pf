// Harnais : lit des cas JSON sur stdin, renvoie les résultats de src/lib/simulator.js (données de banks.json).
import { capacite } from '../../src/lib/simulator.js';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../../data/banks.json', import.meta.url)));
const P = data.simulator.params;
const cases = JSON.parse(readFileSync(0, 'utf8'));
const out = cases.map((c) => { try { const r = capacite(c, P); return { ...r, frais: r.frais.total }; } catch (e) { return { error: String(e) }; } });
process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)));
