// Coûts calculés à partir d'un montant saisi par le visiteur (moteur pur, sans connaissance d'un produit).
// Utilisé par le moteur de catalogues (`catalog.js`), la comparaison par banque (App) et le simulateur.

/**
 * Frais proportionnels avec plancher et plafond publiés : `fee = { pct, min?, max? }`.
 * Montant nul ou invalide → 0 (rien n'est emprunté, aucun frais de dossier).
 */
export function feeAmount(fee, amount) {
  if (!fee || !(amount > 0)) return 0;
  let v = amount * (fee.pct || 0) / 100;
  if (Number.isFinite(fee.min)) v = Math.max(v, fee.min);
  if (Number.isFinite(fee.max)) v = Math.min(v, fee.max);
  return v;
}

/** Mensualité d'un prêt amortissable à taux fixe (taux annuel en %, durée en mois). */
export function monthlyPayment(amount, ratePct, months) {
  if (!(amount > 0) || !(months > 0)) return 0;
  const r = ratePct / 100 / 12;
  return r === 0 ? amount / months : amount * r / (1 - (1 + r) ** -months);
}

/** Intérêts totaux d'un prêt amortissable (hors assurance) : n × mensualité − capital. */
export function interestTotal(amount, ratePct, months) {
  if (!(amount > 0) || !(months > 0) || !Number.isFinite(ratePct)) return 0;
  return monthlyPayment(amount, ratePct, months) * months - amount;
}

const isFound = (e) => e?.status === 'found';

/**
 * Coût d'une entrée sourcée pour un montant : barème `fee` (pourcentage, minimum, plafond) s'il est publié,
 * sinon montant fixe `num`. `null` si non publié ou non chiffré.
 */
export function entryCost(e, amount) {
  if (!isFound(e)) return null;
  if (e.fee) return feeAmount(e.fee, amount);
  return typeof e.num === 'number' ? e.num : null;
}

/**
 * Coût total indicatif d'un prêt : frais (entrée `feeEntry`) + intérêts au taux publié (entrée `rateEntry`, `num` en %).
 * `null` si le taux n'est pas publié (on ne devine jamais un taux).
 */
export function loanCost({ feeEntry, rateEntry, amount, months }) {
  const rate = rateFor(rateEntry, amount, months);
  if (rate === null || !(months > 0)) return null;
  const fee = entryCost(feeEntry, amount);
  const interest = interestTotal(amount, rate, months);
  return { interest, fee, rate, total: interest + (fee || 0) };
}

/**
 * Taux publié applicable : `num`, ou palier de `tiers: [{ upToAmount? | upToMonths?, num }]` (premier palier dont la borne
 * couvre le montant ou la durée). Hors de tous les paliers publiés → null (jamais extrapolé). Un exemple ancien
 * (`stale: true`, ex. taux 2019) n'est jamais utilisé pour calculer un coût.
 */
export function rateFor(e, amount, months) {
  if (!isFound(e) || e.stale) return null; // exemple ancien (`stale`) : affiché, jamais utilisé pour un coût
  if (Array.isArray(e.tiers) && e.tiers.length) {
    const t = e.tiers.find((x) => (x.upToAmount === undefined || amount <= x.upToAmount) && (x.upToMonths === undefined || months <= x.upToMonths));
    return t && typeof t.num === 'number' ? t.num : null;
  }
  return typeof e.num === 'number' ? e.num : null;
}
