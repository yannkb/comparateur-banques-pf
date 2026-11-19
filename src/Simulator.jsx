import { useMemo, useState } from 'react';
import { capacite } from './lib/simulator.js';
import { data, P, fmtMoney, fmtPct, fmtXpf, fmtEur, EUR, bankById } from './lib/data.js';
import { SourceChip, MarketPanel } from './common.jsx';

const D = data.simulator.defaults;
const M = data.market;
const PRESETS = data.simulator.bankDossierPresets;

function Num({ id, label, value, onChange, step = 1, min = 0, max, suffix, hint }) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input id={id} data-testid={id} type="number" inputMode="decimal" value={value} step={step} min={min} max={max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
      {hint && <span className="hint">{hint}</span>}
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
  const [v, setV] = useState({ ...D, preset: 'bt' });
  const set = (k) => (x) => setV((s) => ({ ...s, [k]: x }));
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const both = (x) => `${fmtXpf(x)} ≈ ${fmtEur(x * EUR)}`;

  const inputs = {
    revenu: num(v.revenu), charges: num(v.charges), endettement: num(v.endettement), dureeAns: Math.max(1, num(v.dureeAns)),
    taux: num(v.taux), assurance: num(v.assurance), apport: num(v.apport), typeBien: v.typeBien,
    acquereurs: v.typeBien === 'primo' ? num(v.acquereurs) || 1 : 1, garantie: v.garantie,
    fraisDossierPct: num(v.fraisDossierPct), fraisDossierMin: num(v.fraisDossierMin), ptz: v.ptz,
  };
  const r = useMemo(() => capacite(inputs, P), [JSON.stringify(inputs)]);

  const applyPreset = (id) => {
    const p = PRESETS.find((x) => x.bank === id);
    setV((s) => ({ ...s, preset: id, ...(p ? { fraisDossierPct: p.pct, fraisDossierMin: p.min } : {}) }));
  };
  const usure = M.usure_habitat.num;
  const warnUsure = inputs.taux + inputs.assurance > usure;
  const refOf = (ref) => (ref === 'bank'
    ? (() => { const p = PRESETS.find((x) => x.bank === v.preset); const e = p && bankById[p.ref[0]].fields[p.ref[1]]; return e ? <SourceChip id={e.source} quote={e.quote} /> : <span className="hint">saisie libre</span>; })()
    : <SourceChip id={M[ref].source} quote={M[ref].quote} />);

  return (
    <section className="simu" aria-labelledby="simu-titre">
      <div className="simu-intro">
        <h2 id="simu-titre">Combien puis-je emprunter&nbsp;?</h2>
        <p>Capacité d’emprunt avec un taux d’endettement assurance comprise, puis prix d’achat maximal une fois payés les frais d’acquisition polynésiens (droits, notaire, TVA, débours, frais de dossier), calculés poste par poste à partir des barèmes sourcés.</p>
      </div>

      <div className="simu-grid">
        <form className="simu-form" onSubmit={(e) => e.preventDefault()} aria-label="Paramètres">
          <fieldset>
            <legend>Vos revenus</legend>
            <Num id="revenu" label="Revenu net mensuel du foyer" value={v.revenu} onChange={set('revenu')} step={1000} suffix="XPF" hint={both(inputs.revenu)} />
            <Num id="charges" label="Crédits en cours (mensualités)" value={v.charges} onChange={set('charges')} step={1000} suffix="XPF/mois" hint={both(inputs.charges)} />
            <Num id="endettement" label="Taux d’endettement maximal" value={v.endettement} onChange={set('endettement')} step={1} max={60} suffix="%"
              hint="Hypothèse : aucun plafond public en PF (norme HCSF hexagonale : 35 %)." />
            <Num id="apport" label="Apport personnel" value={v.apport} onChange={set('apport')} step={100000} suffix="XPF" hint={both(inputs.apport)} />
          </fieldset>

          <fieldset>
            <legend>Le prêt</legend>
            <Num id="dureeAns" label="Durée" value={v.dureeAns} onChange={set('dureeAns')} min={1} max={30} suffix="ans"
              hint={inputs.dureeAns > 25 ? '⚠ Au-delà des 25 ans (300 mois) publiés par Socredo et la BDP.' : 'Durée max publiée : 25 ans (Socredo, BDP).'} />
            <Num id="taux" label="Taux nominal" value={v.taux} onChange={set('taux')} step={0.05} suffix="%" />
            <div className="quick">
              <button type="button" onClick={() => set('taux')(M.ieom_habitat.num)}>Moyenne PF IEOM {M.ieom_habitat.value}</button>
            </div>
            <Num id="assurance" label="Assurance emprunteur" value={v.assurance} onChange={set('assurance')} step={0.01} suffix="%/an"
              hint="0,38 % = taux de l’exemple Socredo (2019) ; varie selon l’âge et la santé." />
            <label className="switch">
              <input type="checkbox" data-testid="ptz" checked={v.ptz} onChange={(e) => set('ptz')(e.target.checked)} />
              <span className="switch-ui" aria-hidden="true" />
              <span>Éligible au PTZ Pays (≤ 12 MF à 0 %)</span>
            </label>
            {v.ptz && <p className="hint">Conditions : primo-accédant, 5 ans de résidence, revenus bruts N-2 sous plafond (personne seule 386 194 XPF/mois). <SourceChip id={M.ptz_plafonds.source} quote={M.ptz_plafonds.quote} /></p>}
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
                  <input type="radio" name="typeBien" value={id} checked={v.typeBien === id} onChange={() => set('typeBien')(id)} data-testid={`bien-${id}`} />
                  <span>{l}</span><small>{s}</small>
                </label>
              ))}
            </div>
            {v.typeBien === 'primo' && (
              <Num id="acquereurs" label="Acquéreurs primo-accédants (plafond 40 MF chacun)" value={v.acquereurs} onChange={set('acquereurs')} min={1} max={2} />
            )}
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
              <span className="field-label">Frais de dossier (barème 2026)</span>
              <select value={v.preset} onChange={(e) => applyPreset(e.target.value)} data-testid="preset">
                {PRESETS.map((p) => <option key={p.bank} value={p.bank}>{bankById[p.bank].name} — {String(p.pct).replace('.', ',')} % (min. {fmtXpf(p.min)})</option>)}
                <option value="custom">Saisie libre</option>
              </select>
            </label>
            {v.preset === 'custom' && (
              <div className="two-cols">
                <Num id="fraisDossierPct" label="% du prêt" value={v.fraisDossierPct} onChange={set('fraisDossierPct')} step={0.05} suffix="%" />
                <Num id="fraisDossierMin" label="Minimum" value={v.fraisDossierMin} onChange={set('fraisDossierMin')} step={1000} suffix="XPF" />
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
            <div><dt>Coût des intérêts / de l’assurance sur {r.n} mois</dt><dd><span className="money-main">{fmtMoney(r.coutInterets || 0, cur)}</span><small>assurance {fmtMoney(r.coutAssurance || 0, cur)}</small></dd></div>
            <div><dt>Frais d’acquisition</dt><dd data-testid="res-frais"><Money xpf={r.frais.total} cur={cur} /><small>{fmtPct(r.fraisPct || 0, 1)} du prix</small></dd></div>
          </dl>
          {warnUsure && <p className="warn">⚠ Taux + assurance ({fmtPct(inputs.taux + inputs.assurance)}) au-dessus du taux d’usure ({M.usure_habitat.value}) : offre impossible en l’état. <SourceChip id={M.usure_habitat.source} quote={M.usure_habitat.quote} /></p>}

          <table className="frais" data-testid="frais-table">
            <caption>Détail des frais d’acquisition</caption>
            <tbody>
              {r.frais.lines.map((l) => (
                <tr key={l.key}><th scope="row">{l.label}</th><td>{fmtMoney(l.amount, cur)}</td><td className="ref">{refOf(l.ref)}</td></tr>
              ))}
              <tr className="total"><th scope="row">Total</th><td>{fmtMoney(r.frais.total, cur)}</td><td /></tr>
            </tbody>
          </table>
          <p className="hint">Non inclus : salaire du conservateur, commission de caution, frais d’agence. Barème des émoluments : arrêté 1376 CM (série S1), vérifié sur l’exemple KP Finance 2026. Le neuf (permis ≥ 2025) ressort autour de 3 % du prix, comme indiqué par la source.</p>
        </div>
      </div>
      <MarketPanel title="Hypothèses sourcées du simulateur" ids={['notaire_droits', 'notaire_publicite', 'notaire_emoluments', 'notaire_pret', 'notaire_tva', 'notaire_formalites', 'notaire_debours', 'notaire_neuf_total', 'ptz_pays', 'aim', 'usure_habitat', 'endettement_35']} />
    </section>
  );
}
