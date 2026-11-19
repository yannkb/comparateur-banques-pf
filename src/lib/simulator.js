// Simulateur de capacité d'emprunt — fonctions pures, sans dépendance à l'UI.
// Tous les paramètres chiffrés viennent de data/banks.json (simulator.params), eux-mêmes sourcés.

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

/** Frais d'acquisition détaillés pour un prix et un montant de prêt donnés. */
export function fraisAcquisition({ prix, pretTotal, pretBancaire, typeBien, acquereurs, garantie, fraisDossierPct, fraisDossierMin }, P) {
  const lines = [];
  const add = (key, label, amount, ref) => lines.push({ key, label, amount: Math.round(amount), ref });

  let droits = 0;
  if (typeBien === 'ancien') droits = prix * P.droitsAncien.value;
  else if (typeBien === 'primo') {
    const k = Math.max(1, acquereurs);
    const share = prix / k;
    const cap = P.plafondPrimoBati.value;
    droits = k * (Math.min(share, cap) * P.droitsPrimo.value + Math.max(0, share - cap) * P.droitsAncien.value);
  }
  add('droits', typeBien === 'neuf' ? 'Droits d’enregistrement (neuf : TVA 9 % incluse dans le prix)' : 'Droits d’enregistrement', droits, P.droitsAncien.ref);
  add('publicite', 'Taxe de publicité immobilière', Math.max(prix * P.publicite.value, P.publicite.min), P.publicite.ref);

  const emolVente = bareme(prix, P.baremeS1.tranches);
  add('emolVente', 'Émoluments de vente (HT)', emolVente, P.baremeS1.ref);
  const emolPret = pretTotal > 0
    ? bareme(pretTotal, P.baremeS1.tranches) * P.pretRatio.value * (garantie === 'hypotheque' ? 1 + P.pretRatio.hypothequeMajoration : 1)
    : 0;
  add('emolPret', garantie === 'hypotheque' ? 'Émoluments de l’acte de prêt (HT, hypothèque)' : 'Émoluments de l’acte de prêt (HT)', emolPret, P.pretRatio.ref);
  const formalites = pretTotal > 0 ? P.formalites.avecPret : P.formalites.sansPret;
  add('formalites', 'Émoluments de formalités (HT)', formalites, P.formalites.ref);
  add('tva', 'TVA 13 % sur émoluments', (emolVente + emolPret + formalites) * P.tva.value, P.tva.ref);
  add('debours', 'Débours (états, cadastre, annexes)', P.debours.value, P.debours.ref);
  const dossier = pretBancaire > 0 ? Math.max(pretBancaire * fraisDossierPct / 100, fraisDossierMin) : 0;
  add('dossier', 'Frais de dossier bancaires', dossier, 'bank');

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total };
}

/**
 * Capacité d'emprunt et prix d'achat maximal.
 * inputs : revenu, charges (XPF/mois), endettement (%), dureeAns, taux (%), assurance (%/an du capital initial),
 *          apport (XPF), typeBien ('ancien'|'primo'|'neuf'), acquereurs, garantie ('hypotheque'|'caution'),
 *          fraisDossierPct, fraisDossierMin, ptz (bool)
 */
export function capacite(inputs, P) {
  const n = Math.round(inputs.dureeAns * 12);
  const a = annuityFactor(inputs.taux, n);
  const i = inputs.assurance / 100 / 12;
  const mensualiteMax = inputs.revenu * inputs.endettement / 100 - inputs.charges;
  const base = { n, mensualiteMax, pretBancaire: 0, ptz: 0, pretTotal: 0, mensualite: 0, prixMax: 0, frais: { lines: [], total: 0 } };
  if (!(mensualiteMax > 0) || n <= 0) return { ...base, mensualiteMax: Math.max(0, mensualiteMax), budget: inputs.apport };

  // PTZ (0 %) : remboursement du capital seul (+ assurance), plafonné et ≤ prêt bancaire.
  let L = mensualiteMax / (a + i);
  let ptz = 0;
  if (inputs.ptz) {
    const cP = 1 / n + i;
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
  const mensualiteCredit = L * a + ptz / n;
  const mensualiteAssurance = pretTotal * i;
  return {
    n, mensualiteMax, budget,
    pretBancaire: Math.round(L), ptz: Math.round(ptz), pretTotal: Math.round(pretTotal),
    mensualiteCredit: Math.round(mensualiteCredit), mensualiteAssurance: Math.round(mensualiteAssurance),
    mensualite: Math.round(mensualiteCredit + mensualiteAssurance),
    coutInterets: Math.round(L * a * n - L), coutAssurance: Math.round(mensualiteAssurance * n),
    prixMax, frais: f, fraisPct: prixMax ? f.total / prixMax * 100 : 0,
  };
}

export const toEur = (xpf, P) => xpf * P.xpfToEur.value;
