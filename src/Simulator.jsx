import { useMemo, useState } from 'react';
import { capacite, sanitize, seuilUsure, BOUNDS } from './lib/simulator.js';
import { data, P, fmtMoney, fmtPct, fmtXpf, fmtEur, fmtDate, EUR, bankById } from './lib/data.js';
import { SourceChip, MarketPanel, SecondaryTag } from './common.jsx';

const D = data.simulator.defaults;
const M = data.market;
const PRESETS = data.simulator.bankDossierPresets;
const nf = (x) => String(x).replace('.', ',');

/** Message de validation visible quand une saisie a été ramenée dans ses bornes. */
function adjustMessage(a) {
  const [lo, hi] = BOUNDS[a.field] || [];
  if (a.reason === 'empty') return `Champ vide ou invalide : ${nf(a.to)} utilisé pour le calcul.`;
  const range = hi === Infinity ? `minimum ${nf(lo)}` : `entre ${nf(lo)} et ${nf(hi)}`;
  return `Valeur hors bornes (${range}) : ${nf(a.to)} utilisé pour le calcul.`;
}

function Num({ id, label, value, onChange, step = 1, suffix, hint, error }) {
  const [lo, hi] = BOUNDS[id] || [0, Infinity];
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <label className={error ? 'field has-error' : 'field'} htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input id={id} data-testid={id} type="number" inputMode="decimal" value={value} step={step} min={lo} max={hi === Infinity ? undefined : hi}
          aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
      {error && <span className="field-error" id={`${id}-err`} role="alert" data-testid={`${id}-err`}>{error}</span>}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </label>
  );
}

function Money({ xpf, cur, big }) {
  const main = fmtMoney(xpf, cur);
  const alt = cur === 'EUR' ? fmtXpf(xpf) : fmtEur(xpf * EUR);
  return (
    <span className={big ? 'money big' : 'money'}>
      <span className="money-main">{main}</span>
      <span className="money-alt">{alt}</span>
    </span>
  );
}

export default function Simulator({ cur }) {
  const [v, setV] = useState({ ...D, preset: D.preset || 'bt' });
  const [notice, setNotice] = useState(null);
  const set = (k) => (x) => setV((s) => ({ ...s, [k]: x }));
  const both = (x) => `${fmtXpf(x)} ≈ ${fmtEur(x * EUR)}`;

  const raw = {
    revenu: v.revenu, charges: v.charges, endettement: v.endettement, dureeAns: v.dureeAns,
    taux: v.taux, assurance: v.assurance, apport: v.apport, typeBien: v.typeBien,
    acquereurs: v.typeBien === 'primo' ? v.acquereurs : 1, garantie: v.garantie,
    fraisDossierPct: v.fraisDossierPct, fraisDossierMin: v.fraisDossierMin, ptz: v.ptz,
  };
  const key = JSON.stringify(raw);
  const { inputs, adjustments } = useMemo(() => sanitize(raw), [key]);
  const r = useMemo(() => capacite(inputs, P), [key]);
  const err = Object.fromEntries(adjustments.filter((a) => a.field in BOUNDS).map((a) => [a.field, adjustMessage(a)]));

  const applyPreset = (id) => {
    const p = PRESETS.find((x) => x.bank === id);
    setV((s) => ({ ...s, preset: id, ...(p ? { fraisDossierPct: p.pct, fraisDossierMin: p.min } : {}) }));
  };
  // PTZ ⇒ primo-accédant : cocher le PTZ sur « ancien » bascule en « ancien, primo-accédant » ; revenir à « ancien » décoche le PTZ.
  const setPtz = (on) => {
    setNotice(on && v.typeBien === 'ancien' ? 'PTZ réservé aux primo-accédants : type de bien passé à « Ancien, primo-accédant » (droits 1 %).' : null);
    setV((s) => ({ ...s, ptz: on, typeBien: on && s.typeBien === 'ancien' ? 'primo' : s.typeBien }));
  };
  const setType = (id) => {
    setNotice(id === 'ancien' && v.ptz ? 'PTZ décoché : il est réservé aux primo-accédants.' : null);
    setV((s) => ({ ...s, typeBien: id, ptz: id === 'ancien' ? false : s.ptz }));
  };

  const usure = seuilUsure(inputs.dureeAns, M);
  const warnUsure = r.pretBancaire > 0 && r.taeg > usure.num;
  const preset = PRESETS.find((x) => x.bank === v.preset);
  const refOf = (ref) => (ref === 'bank'
    ? (() => { const e = preset && bankById[preset.ref[0]].fields[preset.ref[1]]; return e ? <SourceChip id={e.source} quote={e.quote} /> : <span className="hint">saisie libre</span>; })()
    : <SourceChip id={M[ref].source} quote={M[ref].quote} />);

  return (
    <section className="simu" aria-labelledby="simu-titre">
      <div className="simu-intro">
        <h2 id="simu-titre">Combien puis-je emprunter&nbsp;?</h2>
        <p>Capacité d’emprunt avec un taux d’endettement assurance comprise, puis prix d’achat maximal une fois payés les frais d’acquisition polynésiens (droits, notaire, TVA, débours, frais de dossier), calculés poste par poste à partir des barèmes sourcés.</p>
      </div>

      <div className="simu-grid">
        <form className="simu-form" onSubmit={(e) => e.preventDefault()} aria-label="Paramètres" noValidate>
          <fieldset>
            <legend>Vos revenus</legend>
            <Num id="revenu" label="Revenu net mensuel du foyer" value={v.revenu} onChange={set('revenu')} step={1000} suffix="XPF" hint={both(inputs.revenu)} error={err.revenu} />
            <Num id="charges" label="Crédits en cours (mensualités)" value={v.charges} onChange={set('charges')} step={1000} suffix="XPF/mois" hint={both(inputs.charges)} error={err.charges} />
            <Num id="endettement" label="Taux d’endettement maximal" value={v.endettement} onChange={set('endettement')} step={1} suffix="%" error={err.endettement}
              hint="Hypothèse : aucun plafond réglementaire publié en PF ; 35 % assurance comprise est la pratique de place citée par les professionnels." />
            <Num id="apport" label="Apport personnel" value={v.apport} onChange={set('apport')} step={100000} suffix="XPF" hint={both(inputs.apport)} error={err.apport} />
          </fieldset>

          <fieldset>
            <legend>Le prêt</legend>
            <Num id="dureeAns" label="Durée" value={v.dureeAns} onChange={set('dureeAns')} suffix="ans" error={err.dureeAns}
              hint={inputs.dureeAns > 25 ? '⚠ Au-delà des 25 ans (300 mois) publiés par Socredo et la BDP.' : 'Durée max publiée : 25 ans (Socredo, BDP).'} />
            <Num id="taux" label="Taux nominal" value={v.taux} onChange={set('taux')} step={0.05} suffix="%" error={err.taux} />
            <div className="quick">
              <button type="button" onClick={() => set('taux')(M.ieom_habitat.num)}>Moyenne PF IEOM {M.ieom_habitat.value}</button>
            </div>
            <Num id="assurance" label="Assurance emprunteur" value={v.assurance} onChange={set('assurance')} step={0.01} suffix="%/an" error={err.assurance}
              hint="0,38 % = taux de l’exemple Socredo (2019), repris par son simulateur en ligne ; varie selon l’âge et la santé." />
            <label className="switch">
              <input type="checkbox" data-testid="ptz" checked={v.ptz} onChange={(e) => setPtz(e.target.checked)} />
              <span className="switch-ui" aria-hidden="true" />
              <span>Éligible au PTZ Pays (≤ 12 MF à 0 %, primo-accédant)</span>
            </label>
            {v.ptz && <p className="hint">Conditions : primo-accédant, 5 ans de résidence, revenus bruts N-2 sous plafond (personne seule 386 194 XPF/mois). PTZ remboursé sur {Math.round(r.nPtz / 12)} ans (25 ans au plus). <SourceChip id={M.ptz_plafonds.source} quote={M.ptz_plafonds.quote} /></p>}
          </fieldset>

          <fieldset>
            <legend>Le bien</legend>
            <div className="radios" role="radiogroup" aria-label="Type de bien">
              {[
                ['ancien', 'Ancien', 'droits 7 %'],
                ['primo', 'Ancien, primo-accédant', 'droits 1 % ≤ 40 MF'],
                ['neuf', 'Neuf / VEFA', 'permis ≥ 2025, TVA incluse'],
              ].map(([id, l, s]) => (
                <label key={id} className={v.typeBien === id ? 'radio on' : 'radio'}>
                  <input type="radio" name="typeBien" value={id} checked={v.typeBien === id} onChange={() => setType(id)} data-testid={`bien-${id}`} />
                  <span>{l}</span><small>{s}</small>
                </label>
              ))}
            </div>
            {notice && <p className="notice" role="status" data-testid="notice">{notice}</p>}
            {v.typeBien === 'primo' && (<>
              <Num id="acquereurs" label="Acquéreurs primo-accédants (plafond 40 MF chacun)" value={v.acquereurs} onChange={set('acquereurs')} error={err.acquereurs} />
              <p className="hint">Bien bâti uniquement : pour un terrain à bâtir, le taux de 1 % s’applique jusqu’à 25 MF par acquéreur (cas non simulé). <SourceChip id={M.notaire_droits.extra[2].source} quote={M.notaire_droits.extra[2].quote} /></p>
            </>)}
            <p className="hint" data-testid="aim-hint">
              {v.typeBien === 'neuf'
                ? 'AIM (aide du Pays, jusqu’à 4 MF) possible pour un logement neuf ou récent (certificat de conformité de moins de 5 ans) ou une construction : non incluse dans ce calcul.'
                : 'AIM : non applicable à l’ancien (réservée à la construction ou à un logement récent de moins de 5 ans).'}
              {' '}<SourceChip id={M.aim.extra[0].source} quote={M.aim.extra[0].quote} />
            </p>
            <div className="radios two" role="radiogroup" aria-label="Garantie">
              {[['hypotheque', 'Hypothèque'], ['caution', 'Caution (Crédit Logement…)']].map(([id, l]) => (
                <label key={id} className={v.garantie === id ? 'radio on' : 'radio'}>
                  <input type="radio" name="garantie" value={id} checked={v.garantie === id} onChange={() => set('garantie')(id)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
            {v.garantie === 'caution' && <p className="hint">⚠ Commission de caution non publiée : non incluse.</p>}
            <label className="field">
              <span className="field-label">Frais de dossier (grille en vigueur)</span>
              <select value={v.preset} onChange={(e) => applyPreset(e.target.value)} data-testid="preset">
                {PRESETS.map((p) => <option key={p.bank} value={p.bank}>{bankById[p.bank].name} — {nf(p.pct)} % (min. {fmtXpf(p.min)})</option>)}
                <option value="custom">Saisie libre</option>
              </select>
            </label>
            {preset?.next && <p className="hint" data-testid="preset-next"><span className="tag tag-soon">Nouvelle grille au {fmtDate(preset.next.effective_from)}</span> {bankById[preset.bank].short} : {nf(preset.next.pct)} % (min. {fmtXpf(preset.next.min)}).</p>}
            {v.preset === 'socredo' && <p className="hint">La grille Socredo liste aussi « Crédit logement (frais de dossier) 21 120 XPF » et des frais d’étude de 1 % (min. 20 500) sans préciser comment ils se combinent : non inclus.</p>}
            {v.preset === 'custom' && (
              <div className="two-cols">
                <Num id="fraisDossierPct" label="% du prêt" value={v.fraisDossierPct} onChange={set('fraisDossierPct')} step={0.05} suffix="%" error={err.fraisDossierPct} />
                <Num id="fraisDossierMin" label="Minimum" value={v.fraisDossierMin} onChange={set('fraisDossierMin')} step={1000} suffix="XPF" error={err.fraisDossierMin} />
              </div>
            )}
          </fieldset>
        </form>

        <div className="simu-result" aria-live="polite">
          <div className="res-hero">
            <span className="res-label">Prix d’achat maximal</span>
            <span data-testid="res-prix"><Money xpf={r.prixMax} cur={cur} big /></span>
            <span className="res-sub">frais d’acquisition inclus, avec {fmtMoney(inputs.apport, cur)} d’apport</span>
          </div>
          <dl className="res-list">
            <div><dt>Mensualité maximale ({fmtPct(inputs.endettement, 1)} − crédits en cours)</dt><dd data-testid="res-mensualite-max"><Money xpf={r.mensualiteMax} cur={cur} /></dd></div>
            <div><dt>Prêt bancaire</dt><dd data-testid="res-pret"><Money xpf={r.pretBancaire} cur={cur} /></dd></div>
            {v.ptz && <div><dt>PTZ Pays (0 %)</dt><dd data-testid="res-ptz"><Money xpf={r.ptz} cur={cur} /></dd></div>}
            <div><dt>Mensualité : crédit + assurance</dt><dd data-testid="res-mensualite"><Money xpf={r.mensualite || 0} cur={cur} /><small>{fmtMoney(r.mensualiteCredit || 0, cur)} + {fmtMoney(r.mensualiteAssurance || 0, cur)}</small></dd></div>
            <div><dt>TAEG estimé du prêt bancaire (frais de dossier et assurance inclus)</dt><dd data-testid="res-taeg"><span className="money-main">{r.pretBancaire > 0 ? fmtPct(r.taeg) : '—'}</span><small>seuil d’usure {usure.value} ({inputs.dureeAns < 10 ? 'moins de 10 ans' : inputs.dureeAns < 20 ? '10 à 20 ans' : '20 ans et plus'})</small></dd></div>
            <div><dt>Coût des intérêts / de l’assurance sur {r.n} mois</dt><dd><span className="money-main">{fmtMoney(r.coutInterets || 0, cur)}</span><small>assurance {fmtMoney(r.coutAssurance || 0, cur)}</small></dd></div>
            <div><dt>Frais d’acquisition</dt><dd data-testid="res-frais"><Money xpf={r.frais.total} cur={cur} /><small>{fmtPct(r.fraisPct || 0, 1)} du prix</small></dd></div>
          </dl>
          {warnUsure && <p className="warn" data-testid="warn-usure">⚠ TAEG estimé ({fmtPct(r.taeg)}) au-dessus du taux d’usure de cette durée ({usure.value}) : offre impossible en l’état. <SourceChip id={usure.source} quote={usure.quote} /></p>}

          <table className="frais" data-testid="frais-table">
            <caption>Détail des frais d’acquisition</caption>
            <tbody>
              {r.frais.lines.map((l) => (
                <tr key={l.key}>
                  <th scope="row">{l.label}{l.secondary && <SecondaryTag detail={l.secondary} />}</th>
                  <td>{fmtMoney(l.amount, cur)}</td><td className="ref">{refOf(l.ref)}</td>
                </tr>
              ))}
              <tr className="total"><th scope="row">Total</th><td>{fmtMoney(r.frais.total, cur)}</td><td /></tr>
            </tbody>
          </table>
          <p className="hint" data-testid="neuf-hint">Non inclus : salaire du conservateur, commission de caution, frais d’agence, AIM. Barème des émoluments : arrêté 1376 CM (série S1), vérifié sur l’exemple KP Finance 2026. Neuf (permis ≥ 2025) : la source annonce « autour de 3 % du prix » sans compter le prêt ; le simulateur trouve 2 à 3 % sans prêt (3,1 % à 15 MF, 1,9 % à 60 MF) et 4 à 6 % avec un prêt finançant l’essentiel du prix (acte de prêt, formalités et frais de dossier en plus).</p>
        </div>
      </div>
      <MarketPanel title="Hypothèses sourcées du simulateur" ids={['notaire_droits', 'notaire_publicite', 'notaire_emoluments', 'notaire_pret', 'notaire_tva', 'notaire_tva_neuf', 'notaire_formalites', 'notaire_debours', 'notaire_neuf_total', 'ptz_pays', 'aim', 'usure_habitat_moins_10', 'usure_habitat_10_20', 'usure_habitat', 'endettement_35', 'endettement_35_pratique', 'parite']} />
    </section>
  );
}
