// Valeurs à date d'effet : une entrée (ou un preset) peut porter `changes: [{ effective_from: 'AAAA-MM-JJ', ...valeurs }]`.
// L'application affiche la valeur en vigueur à la date du visiteur et annonce la prochaine (badge « nouvelle grille »).

const pad = (n) => String(n).padStart(2, '0');
/** Date locale du visiteur au format AAAA-MM-JJ. */
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function pick(changes, iso) {
  const sorted = [...(changes || [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const past = sorted.filter((c) => c.effective_from <= iso);
  return { current: past.at(-1) || null, next: sorted.find((c) => c.effective_from > iso) || null };
}

/** Entrée en vigueur à `iso` ; `next` = changement à venir (ou absent). */
export function entryAt(e, iso) {
  if (!e?.changes?.length) return e;
  const { changes, ...base } = e;
  const { current, next } = pick(changes, iso);
  return { ...(current || base), ...(next ? { next } : {}) };
}

/** Preset de frais de dossier en vigueur à `iso` (les champs du changement remplacent ceux de base). */
export function presetAt(p, iso) {
  if (!p?.changes?.length) return p;
  const { changes, ...base } = p;
  const { current, next } = pick(changes, iso);
  return { ...base, ...(current || {}), ...(next ? { next: { ...base, ...next } } : {}) };
}

/** Jeu de données résolu à la date `iso` (banques, presets et valeurs par défaut du simulateur). */
export function dataAt(data, iso) {
  const banks = data.banks.map((b) => ({ ...b, fields: Object.fromEntries(Object.entries(b.fields).map(([k, e]) => [k, entryAt(e, iso)])) }));
  const presets = data.simulator.bankDossierPresets.map((p) => presetAt(p, iso));
  const def = presets.find((p) => p.bank === data.simulator.defaults.preset);
  const defaults = def ? { ...data.simulator.defaults, fraisDossierPct: def.pct, fraisDossierMin: def.min } : data.simulator.defaults;
  return { ...data, banks, simulator: { ...data.simulator, bankDossierPresets: presets, defaults }, asOf: iso };
}
