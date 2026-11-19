"""Fuzz : N cas aléatoires (dont saisies invalides) comparés entre l'app (JS) et la référence Python.

Usage : python3 tests/fuzz/fuzz.py [N=3000] [graine=2026]   → échec si un prix max diffère de plus de 2 XPF.
"""
import json
import random
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ref_simulator import capacite  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 2026)


def odd(x):  # de temps en temps, une saisie invalide (vide, négative, hors bornes)
    return rnd.choice(['', -x, x * 50, float('nan')]) if rnd.random() < 0.04 else x


cases = []
for _ in range(N):
    cases.append(dict(
        revenu=odd(rnd.choice([0, rnd.uniform(50e3, 2e6), rnd.uniform(150e3, 600e3)])),
        charges=odd(rnd.choice([0, rnd.uniform(0, 200e3)])),
        endettement=odd(rnd.choice([33, 35, rnd.uniform(10, 60)])),
        dureeAns=odd(rnd.randint(1, 30)),
        taux=odd(round(rnd.uniform(0, 9), 2)),
        assurance=odd(round(rnd.uniform(0, 0.8), 2)),
        apport=odd(rnd.choice([0, rnd.uniform(0, 40e6)])),
        typeBien=rnd.choice(['ancien', 'primo', 'neuf']),
        acquereurs=odd(rnd.choice([1, 2])),
        garantie=rnd.choice(['hypotheque', 'caution']),
        fraisDossierPct=rnd.choice([1, 0.75, round(rnd.uniform(0, 2), 2)]),
        fraisDossierMin=rnd.choice([10310, 17878, 18236, 51300, 0]),
        ptz=rnd.random() < 0.35,
    ))

js = [{k: (None if isinstance(v, float) and v != v else v) for k, v in c.items()} for c in cases]  # NaN → null en JSON
out = subprocess.run(['node', str(Path(__file__).parent / 'harness.mjs')], input=json.dumps(js), capture_output=True, text=True, check=True)
app = json.loads(out.stdout)
worst, bad = 0, []
for c, a in zip(cases, app):
    ref = capacite({k: (None if v is None else v) for k, v in c.items()})
    if 'error' in a:
        bad.append((c, a['error'])); continue
    d = abs(a['prixMax'] - ref['prixMax'])
    worst = max(worst, d)
    if d > 2 or (a['prixMax'] > 0 and a['prixMax'] + a['frais'] > a['budget'] + 1e-6):
        bad.append((c, a['prixMax'], ref['prixMax']))
print(f"{N} cas · écart max sur le prix : {worst} XPF · cas > 2 XPF ou prix + frais > budget : {len(bad)}")
for b in bad[:5]:
    print('  ', b)
sys.exit(1 if bad else 0)
