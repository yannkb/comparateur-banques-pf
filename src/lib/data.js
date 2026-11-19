import data from '../../data/banks.json';

export { data };
export const P = data.simulator.params;
export const EUR = P.xpfToEur.value;

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nbsp = (s) => s.replace(/\u202f/g, '\u00a0');

export const fmtXpf = (n) => `${nbsp(nf0.format(Math.round(n)))}\u00a0XPF`;
export const fmtEur = (n) => `${nbsp((Math.abs(n) >= 1000 ? nf0 : nf2).format(n))}\u00a0€`;
export const fmtMoney = (xpf, cur) => (cur === 'EUR' ? fmtEur(xpf * EUR) : fmtXpf(xpf));
export const fmtPct = (n, d = 2) => `${nbsp(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n))}\u00a0%`;

export const fmtDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (d) return `${d}/${m}/${y}`;
  if (m) return `${m}/${y}`;
  return y;
};

/** Valeur numérique formatée selon l'unité du champ (avec conversion € si demandé). */
export function fmtNum(num, unit, cur) {
  if (num === undefined || num === null) return null;
  if (!unit) return null;
  if (unit === '%') return fmtPct(num, 3);
  if (unit === 'mois') return `${num}\u00a0mois`;
  if (unit.startsWith('XPF')) {
    const suffix = unit.slice(3);
    return fmtMoney(num, cur) + (suffix ? `\u00a0${suffix.replace('/', '/\u00a0').trim()}` : '');
  }
  return String(num);
}

export const sourceOf = (id) => data.sources[id];
export const fieldsOf = (cat) => data.fields.filter((f) => f.category === cat);
export const bankById = Object.fromEntries(data.banks.map((b) => [b.id, b]));
