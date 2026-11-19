"""Implémentation de référence indépendante (Python) du simulateur, pour le fuzz contre src/lib/simulator.js.

Les paramètres sont recopiés à la main depuis les textes (et non lus dans banks.json) : un écart signale
soit une erreur de calcul dans l'app, soit une donnée modifiée.
"""
import math

PARAMS = dict(droits=0.07, primo=0.01, plafond_primo=40e6, pub=0.001, pub_min=1500,
              s1=[(1e6, .05), (2e6, .03), (10e6, .016), (20e6, .014), (50e6, .013), (math.inf, .011)],
              pret_ratio=2 / 3, hyp=0.25, tva=0.13, form_avec=80775, form_sans=70125, debours=53750,
              ptz_max=12e6, ptz_duree_max_mois=300)
BOUNDS = dict(revenu=(0, math.inf), charges=(0, math.inf), endettement=(0, 60), dureeAns=(1, 30), taux=(0, 20),
              assurance=(0, 5), apport=(0, math.inf), acquereurs=(1, 2), fraisDossierPct=(0, 10), fraisDossierMin=(0, math.inf))


def clamp(c):
    c = dict(c)
    for k, (lo, hi) in BOUNDS.items():
        x = c.get(k)
        c[k] = min(hi, max(lo, x)) if isinstance(x, (int, float)) and math.isfinite(x) else lo
    c['acquereurs'] = int(math.floor(c['acquereurs'] + 0.5))
    if c['ptz'] and c['typeBien'] == 'ancien':
        c['typeBien'] = 'primo'  # PTZ réservé aux primo-accédants
    if c['typeBien'] != 'primo':
        c['acquereurs'] = 1
    return c


def s1(x):
    tot, lo = 0.0, 0.0
    for hi, r in PARAMS['s1']:
        if x > lo:
            tot += (min(x, hi) - lo) * r
        lo = hi
    return tot


def jround(x):  # Math.round de JavaScript (demi vers +∞)
    return math.floor(x + 0.5)


def frais(prix, pret_total, pret_banc, c):
    p = PARAMS
    if c['typeBien'] == 'ancien':
        d = prix * p['droits']
    elif c['typeBien'] == 'primo':
        k = max(1, c['acquereurs']); sh = prix / k
        d = k * (min(sh, p['plafond_primo']) * p['primo'] + max(0, sh - p['plafond_primo']) * p['droits'])
    else:
        d = 0
    pub = max(prix * p['pub'], p['pub_min'])
    ev = s1(prix)
    ep = s1(pret_total) * p['pret_ratio'] * (1 + p['hyp'] if c['garantie'] == 'hypotheque' else 1) if pret_total > 0 else 0
    fo = p['form_avec'] if pret_total > 0 else p['form_sans']
    tva = (ev + ep + fo) * p['tva']
    dos = max(pret_banc * c['fraisDossierPct'] / 100, c['fraisDossierMin']) if pret_banc > 0 else 0
    return sum(jround(x) for x in [d, pub, ev, ep, fo, tva, p['debours'], dos])


def capacite(raw):
    c = clamp(raw)
    n = jround(c['dureeAns'] * 12)
    r = c['taux'] / 1200
    a = 1 / n if r == 0 else r / (1 - (1 + r) ** -n)
    i = c['assurance'] / 1200
    m = max(0.0, c['revenu'] * c['endettement'] / 100 - c['charges'])
    nP = min(n, PARAMS['ptz_duree_max_mois'])
    L, ptz = m / (a + i), 0.0
    if c['ptz'] and m > 0:
        cP = 1 / nP + i
        both = m / (a + i + cP)  # PTZ = prêt bancaire tant que le total < 24 MF
        if both <= PARAMS['ptz_max']:
            L = ptz = both
        else:
            ptz = PARAMS['ptz_max']; L = (m - ptz * cP) / (a + i)
    budget = L + ptz + c['apport']
    # plus grand prix entier tel que prix + frais(prix) <= budget (frais non décroissants)
    lo, hi = 0, max(0, int(budget))
    if frais(0, L + ptz, L, c) > budget:
        return dict(prixMax=0, pretBancaire=L, ptz=ptz, mensualiteMax=m, budget=budget)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if mid + frais(mid, L + ptz, L, c) <= budget:
            lo = mid
        else:
            hi = mid - 1
    return dict(prixMax=lo, pretBancaire=L, ptz=ptz, mensualiteMax=m, budget=budget,
                mensualite=L * a + (ptz / nP if ptz else 0) + (L + ptz) * i)
