// Simulateur de capacité d'emprunt — fonctions pures, sans dépendance à l'UI.
// Tous les paramètres chiffrés viennent de data/banks.json (simulator.params), eux-mêmes sourcés.
import { feeAmount } from './cost.js';

/** Facteur d'annuité mensuelle : mensualité = capital × facteur. */
export function annuityFactor(rateAnnualPct, months) {
  const r = rateAnnualPct / 100 / 12;
  if (r === 0) return 1 / months;
  return r / (1 - Math.pow(1 + r, -months));
}

/** Barème par tranches : [[plafond|null, taux], ...] appliqué marginalement. */
export function bareme(amount, tranches) {
  let prev = 0;
  let sum = 0;
  for (const [cap, rate] of tranches) {
    const upper = cap ?? Infinity;
    const part = Math.max(0, Math.min(amount, upper) - prev);
    sum += part * rate;
    prev = upper;
    if (amount <= upper) break;
  }
  return sum;
}

/** Frais de dossier bancaires pour un montant emprunté : max(% × montant, minimum). */
export function fraisDossier(montant, pct, min = 0) {
  return feeAmount({ pct, min }, montant);
}

/** Frais d'acquisition détaillés pour un prix et un montant de prêt donnés. */
export function fraisAcquisition({ prix, pretTotal, pretBancaire, typeBien, acquereurs, garantie, fraisDossierPct, fraisDossierMin }, P) {
  const lines = [];
  // secondary : poste tiré d'une source secondaire, à confirmer par un notaire (affiché dans l'UI)
  const add = (key, label, amount, ref, secondary) => lines.push({ key, label, amount: Math.round(amount), ref, ...(secondary ? { secondary } : {}) });

  let droits = 0;
  if (typeBien === 'ancien') droits = prix * P.droitsAncien.value;
  else if (typeBien === 'primo') {
    const k = Math.max(1, acquereurs);
    const share = prix / k;
    const cap = P.plafondPrimoBati.value;
    droits = k * (Math.min(share, cap) * P.droitsPrimo.value + Math.max(0, share - cap) * P.droitsAncien.value);
  }
  add('droits', typeBien === 'neuf' ? 'Droits d’enregistrement (neuf : TVA 9 % incluse dans le prix)' : 'Droits d’enregistrement', droits, P.droitsAncien.ref);
  const pub = prix * P.publicite.value;
  add('publicite', 'Taxe de publicité immobilière', Math.max(pub, P.publicite.min), P.publicite.ref, pub < P.publicite.min ? P.publicite.secondary : undefined);

  const emolVente = bareme(prix, P.baremeS1.tranches);
  add('emolVente', 'Émoluments de vente (HT)', emolVente, P.baremeS1.ref);
  const hyp = garantie === 'hypotheque';
  const emolPret = pretTotal > 0
    ? bareme(pretTotal, P.baremeS1.tranches) * P.pretRatio.value * (hyp ? 1 + P.pretRatio.hypothequeMajoration : 1)
    : 0;
  add('emolPret', hyp ? 'Émoluments de l’acte de prêt (HT, hypothèque)' : 'Émoluments de l’acte de prêt (HT)', emolPret, P.pretRatio.ref, hyp && pretTotal > 0 ? P.pretRatio.secondary : undefined);
  const formalites = pretTotal > 0 ? P.formalites.avecPret : P.formalites.sansPret;
  add('formalites', 'Émoluments de formalités (HT)', formalites, P.formalites.ref, P.formalites.secondary);
  add('tva', 'TVA 13 % sur émoluments', (emolVente + emolPret + formalites) * P.tva.value, P.tva.ref);
  add('debours', 'Débours (états, cadastre, annexes)', P.debours.value, P.debours.ref, P.debours.secondary);
  add('dossier', 'Frais de dossier bancaires', fraisDossier(pretBancaire, fraisDossierPct, fraisDossierMin), 'bank');

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total };
}

/** Bornes des saisies (utilisées aussi par l'UI pour min/max et les messages de validation). */
export const BOUNDS = {
  revenu: [0, Infinity], charges: [0, Infinity], endettement: [0, 60], dureeAns: [1, 30], taux: [0, 20],
  assurance: [0, 5], apport: [0, Infinity], acquereurs: [1, 2], fraisDossierPct: [0, 10], fraisDossierMin: [0, Infinity],
};

/**
 * Assainit les saisies : pas de négatif, pas de NaN ni de champ vide, bornes réalistes,
 * cohérence PTZ ⇒ primo-accédant. Renvoie { inputs, adjustments } ;
 * adjustments = [{ field, from, to, reason: 'empty' | 'bounds' | 'ptz' }] pour l'affichage.
 */
export function sanitize(raw) {
  const inputs = { ...raw };
  const adjustments = [];
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) {
    if (!(k in raw)) continue;
    const x = raw[k];
    const finite = typeof x === 'number' && Number.isFinite(x);
    let v = finite ? Math.min(hi, Math.max(lo, x)) : lo;
    if (k === 'acquereurs') v = Math.round(v);
    inputs[k] = v;
    if (v !== x) adjustments.push({ field: k, from: x, to: v, reason: finite ? 'bounds' : 'empty' });
  }
  // Le PTZ Pays est réservé aux primo-accédants : « ancien » devient « ancien, primo-accédant » (droits 1 %).
  if (inputs.ptz && inputs.typeBien === 'ancien') {
    inputs.typeBien = 'primo';
    adjustments.push({ field: 'typeBien', from: 'ancien', to: 'primo', reason: 'ptz' });
  }
  if (inputs.typeBien !== 'primo') inputs.acquereurs = 1;
  return { inputs, adjustments };
}

/**
 * Capacité d'emprunt et prix d'achat maximal.
 * inputs : revenu, charges (XPF/mois), endettement (%), dureeAns, taux (%), assurance (%/an du capital initial),
 *          apport (XPF), typeBien ('ancien'|'primo'|'neuf'), acquereurs, garantie ('hypotheque'|'caution'),
 *          fraisDossierPct, fraisDossierMin, ptz (bool)
 */
export function capacite(raw, P) {
  const { inputs, adjustments } = sanitize(raw);
  const n = Math.round(inputs.dureeAns * 12);
  const a = annuityFactor(inputs.taux, n);
  const i = inputs.assurance / 100 / 12;
  const mensualiteMax = Math.max(0, inputs.revenu * inputs.endettement / 100 - inputs.charges);

  // Prêt bancaire L : 0 sans capacité, mais l'apport reste mobilisable (achat comptant).
  // PTZ (0 %) : ≤ 12 MF, remboursé sur 25 ans au plus même si le prêt bancaire est plus long,
  // au moins égal au prêt bancaire tant que le financement total est < 24 MF.
  let L = mensualiteMax / (a + i);
  let ptz = 0;
  const nP = Math.min(n, Math.round(P.ptzDureeMaxAns.value * 12));
  if (inputs.ptz && mensualiteMax > 0) {
    const cP = 1 / nP + i;
    const both = mensualiteMax / (a + i + cP);
    if (both <= P.ptzMax.value) { L = both; ptz = both; } else { ptz = P.ptzMax.value; L = (mensualiteMax - ptz * cP) / (a + i); }
  }
  const pretTotal = L + ptz;
  const budget = pretTotal + inputs.apport;

  const frais = (prix) => fraisAcquisition({ ...inputs, prix, pretTotal, pretBancaire: L }, P);
  // prix + frais(prix) = budget ; frais croissants → dichotomie.
  let lo = 0, hi = budget;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (mid + frais(mid).total > budget) hi = mid; else lo = mid;
  }
  const prixMax = Math.max(0, Math.floor(lo));
  const f = frais(prixMax);
  const mensualiteCredit = L * a + (ptz ? ptz / nP : 0);
  const mensualiteAssurance = pretTotal * i;
  const dossier = f.lines.find((l) => l.key === 'dossier').amount;
  return {
    n, nPtz: nP, mensualiteMax, budget, inputs, adjustments,
    pretBancaire: Math.round(L), ptz: Math.round(ptz), pretTotal: Math.round(pretTotal),
    mensualiteCredit: Math.round(mensualiteCredit), mensualiteAssurance: Math.round(mensualiteAssurance),
    mensualite: Math.round(mensualiteCredit + mensualiteAssurance),
    coutInterets: Math.round(L * a * n - L), coutAssurance: Math.round(mensualiteAssurance * n),
    prixMax, frais: f, fraisPct: prixMax ? f.total / prixMax * 100 : 0,
    taeg: taeg({ capital: L, taux: inputs.taux, assurance: inputs.assurance, n, frais: dossier }),
  };
}

/**
 * TAEG actuariel du prêt bancaire (%), frais de dossier et assurance sur capital initial inclus :
 * r mensuel tel que capital − frais = Σ mensualités actualisées ; TAEG = (1 + r)^12 − 1.
 */
export function taeg({ capital, taux, assurance, n, frais = 0 }) {
  if (!(capital > 0) || !(n > 0)) return 0;
  const pay = capital * annuityFactor(taux, n) + capital * assurance / 1200;
  const net = capital - frais;
  if (!(net > 0)) return Infinity;
  const pv = (r) => (r === 0 ? pay * n : pay * (1 - (1 + r) ** -n) / r);
  let lo = 0, hi = 0.05;
  while (pv(hi) > net && hi < 10) hi *= 2;
  for (let k = 0; k < 200; k++) { const r = (lo + hi) / 2; if (pv(r) > net) lo = r; else hi = r; }
  return ((1 + lo) ** 12 - 1) * 100;
}

/** Seuil d'usure applicable selon la durée (catégories Banque de France : < 10 ans, 10 à < 20 ans, ≥ 20 ans). */
export function seuilUsure(dureeAns, M) {
  if (dureeAns < 10) return M.usure_habitat_moins_10;
  if (dureeAns < 20) return M.usure_habitat_10_20;
  return M.usure_habitat;
}

export const toEur = (xpf, P) => xpf * P.xpfToEur.value;
