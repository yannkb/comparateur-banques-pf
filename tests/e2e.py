"""Vérification navigateur (Playwright, headless) + captures desktop/mobile.

Usage : npm run build && npx vite preview --port 4173 --strictPort  (autre terminal, avec le même BASE_PATH que le build)
        python3 tests/e2e.py [URL]      (défaut : http://localhost:4173$BASE_PATH)
"""
import datetime
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173" + os.environ.get("BASE_PATH", "/")
HOST = urlparse(URL).netloc
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(exist_ok=True)
failures, errors, external = [], [], []


def check(cond, msg):
    print(("✓ " if cond else "✗ ") + msg)
    if not cond:
        failures.append(msg)


def digits(s):
    return int(re.sub(r"[^\d]", "", s.split("XPF")[0].split("€")[0]) or 0)


def text(loc):
    return loc.inner_text().replace("\u00a0", " ").replace("\u202f", " ")


def watch(page):
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: urlparse(r.url).scheme in ("http", "https") and urlparse(r.url).netloc != HOST and external.append(r.url))


def fill(page, values):
    for k, v in values.items():
        page.get_by_test_id(k).fill(str(v))
    page.wait_for_timeout(250)


def run_simulator(page):
    page.get_by_test_id("tab-simu").click()
    fill(page, {"revenu": 350000, "charges": 30000, "endettement": 35, "dureeAns": 25, "taux": 3, "assurance": 0.38, "apport": 0})
    page.get_by_test_id("bien-ancien").check()
    page.get_by_test_id("preset").select_option("bt")
    page.wait_for_timeout(300)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---------- Desktop (date réelle : novembre 2026) ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    ctx.clock.install(time=datetime.datetime(2026, 11, 18, 9, 0))
    page = ctx.new_page()
    watch(page)
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(900)

    check(page.locator("h1").inner_text().startswith("Comparez"), "titre affiché")
    check(page.locator(".card").count() == 4, "4 fiches établissements (crédit immobilier)")
    check(page.locator(".np").count() > 0, "cases « Non publié » affichées")
    check(page.locator("a.src").count() > 40, f"liens sources présents ({page.locator('a.src').count()})")
    top = text(page.locator(".topbar"))
    check("ÉDITION DU 18/11/2026" in top.upper() and "DERNIÈRE VÉRIFICATION DES SOURCES : 18/11/2026" in top.upper(), "date d'édition et de vérification visibles")

    # M5 : frais de dossier classés au coût réel pour le montant saisi
    heads = [text(h) for h in page.get_by_test_id("headline").all()]
    first = page.locator(".card").first.get_attribute("data-testid")
    check(first == "card-bdp" and heads[0].startswith("150 000"), f"frais de dossier pour 20 MF : BDP (0,75 %) la moins chère en premier ({first}, {heads[:3]})")
    page.get_by_test_id("cost-amount").fill("1000000")
    page.wait_for_timeout(300)
    first = page.locator(".card").first.get_attribute("data-testid")
    check(first == "card-socredo", f"frais de dossier pour 1 MF : Socredo (min. 10 310) en premier ({first})")
    page.get_by_test_id("cost-amount").fill("20000000")
    # M6 : badge « nouvelle grille » BT avant le 01/01/2027
    check(page.get_by_test_id("next-badge").count() >= 1 and "01/01/2027" in text(page.get_by_test_id("next-badge").first), "badge « Nouvelle grille au 01/01/2027 » visible")
    check("17 878" in text(page.get_by_test_id("card-bt")), "BT : minimum 2026 (17 878) affiché avant le 01/01/2027")
    check(page.get_by_test_id("tag-indicative").count() >= 1, "taux du simulateur BT étiquetés « non contractuels »")
    page.screenshot(path=str(OUT / "desktop-01-credit-immo-fiches.png"), full_page=True)

    page.get_by_test_id("view-table").click()
    page.wait_for_timeout(300)
    check(page.locator("table.cmp tbody tr").count() == 12, "tableau immo : 12 rubriques")
    check(page.locator("td.is-best").count() >= 1, "meilleure valeur surlignée dans le tableau")
    page.screenshot(path=str(OUT / "desktop-02-credit-immo-tableau.png"), full_page=True)

    page.get_by_test_id("tab-compte").click()
    page.get_by_test_id("view-cards").click()
    page.wait_for_timeout(500)
    first = page.locator(".card").first.get_attribute("data-testid")
    check(first == "card-marara", f"tri par tenue de compte : la moins chère en premier ({first})")
    page.screenshot(path=str(OUT / "desktop-03-comptes-cartes.png"), full_page=True)

    page.get_by_test_id("tab-epargne").click()
    page.wait_for_timeout(400)
    check(page.locator(".card").first.get_attribute("data-testid") == "card-bt", "épargne : meilleur livret (BT 0,30 %) en premier")
    page.get_by_test_id("tab-conso").click()
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / "desktop-04-credit-conso.png"), full_page=True)

    run_simulator(page)
    pret = page.get_by_test_id("res-pret").inner_text()
    mens_max = page.get_by_test_id("res-mensualite-max").inner_text()
    prix = page.get_by_test_id("res-prix").inner_text()
    print("   prêt :", pret.replace("\n", " | "), "· mensualité max :", mens_max.replace("\n", " | "), "· prix :", prix.replace("\n", " | "))
    check(abs(digits(pret) - 18285042) <= 1, "simulateur : prêt max = 18 285 042 XPF (calcul manuel)")
    check(abs(digits(mens_max) - 92500) <= 1, "simulateur : mensualité max = 92 500 XPF")
    check(abs(digits(prix) - 16171248) <= 2, "simulateur : prix max ancien = 16 171 248 XPF")
    check(page.locator("[data-testid=warn-usure]").count() == 0, "pas d'alerte d'usure à 3 % sur 25 ans")
    check(page.get_by_test_id("tag-secondary").count() >= 3, "postes de source secondaire étiquetés « à confirmer par un notaire »")
    check("non applicable à l’ancien" in text(page.get_by_test_id("aim-hint")), "AIM non applicable à l'ancien")
    check(page.get_by_test_id("preset-next").count() == 1 and "18 236" in text(page.get_by_test_id("preset-next")), "preset BT : nouvelle grille (18 236) annoncée")
    page.screenshot(path=str(OUT / "desktop-05-simulateur.png"), full_page=True)

    # M2 : usure par durée sur TAEG
    fill(page, {"dureeAns": 15, "taux": 4.5})
    check(page.locator("[data-testid=warn-usure]").count() == 1 and "4,68" in text(page.get_by_test_id("warn-usure")), "usure : 15 ans à 4,5 % + assurance → alerte au seuil 4,68 %")
    fill(page, {"dureeAns": 25, "taux": 4.9})
    check(page.locator("[data-testid=warn-usure]").count() == 1, "usure : 25 ans à 4,9 % (TAEG > 5,40 %) → alerte")
    # M3 : bornes et messages visibles
    fill(page, {"taux": 3, "charges": -500000, "endettement": 200})
    check(page.get_by_test_id("charges-err").is_visible() and page.get_by_test_id("endettement-err").is_visible(), "saisies hors bornes : messages de validation visibles")
    check(abs(digits(page.get_by_test_id("res-mensualite-max").inner_text()) - 210000) <= 1, "endettement ramené à 60 %, charges négatives ignorées")
    fill(page, {"charges": 0, "endettement": 35, "dureeAns": ""})
    check("vide" in text(page.get_by_test_id("dureeAns-err")), "durée vide : message affiché")
    # M1 : achat comptant
    fill(page, {"dureeAns": 25, "revenu": 0, "apport": 30000000})
    check(digits(page.get_by_test_id("res-prix").inner_text()) > 27000000, f"achat comptant : prix max > 27 MF ({text(page.get_by_test_id('res-prix')).splitlines()[0]})")
    fill(page, {"revenu": 350000, "charges": 30000, "apport": 0})
    # M4 : PTZ ⇒ primo-accédant
    page.get_by_test_id("cur-EUR").click()
    page.wait_for_timeout(200)
    pret_eur = text(page.get_by_test_id("res-pret"))
    check("153 229" in pret_eur, f"bascule € : 18 285 042 XPF → 153 229 € ({pret_eur.splitlines()[0]})")
    page.get_by_text("Éligible au PTZ Pays").click()
    page.wait_for_timeout(200)
    check(page.get_by_test_id("res-ptz").is_visible(), "option PTZ : montant PTZ affiché")
    check(page.get_by_test_id("bien-primo").is_checked() and page.get_by_test_id("notice").is_visible(), "PTZ sur « ancien » → bascule « primo-accédant » signalée")
    page.screenshot(path=str(OUT / "desktop-06-simulateur-eur-ptz.png"), full_page=True)
    ctx.close()

    # ---------- Date simulée au 02/01/2027 : grille BT 2027 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.clock.install(time=datetime.datetime(2027, 1, 2, 9, 0))
    page = ctx.new_page()
    watch(page)
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(900)
    bt = text(page.get_by_test_id("card-bt"))
    check("18 236" in bt and "17 878" not in bt, "02/01/2027 : frais de dossier BT 2027 (min. 18 236)")
    check("25 000" in bt and "22 238" in bt, "02/01/2027 : avenant 25 000 et mainlevée 22 238 (grille 2027)")
    check(page.get_by_test_id("next-badge").count() == 0, "02/01/2027 : plus de badge « nouvelle grille »")
    page.get_by_test_id("tab-compte").click()
    page.wait_for_timeout(300)
    bt = text(page.get_by_test_id("card-bt"))
    check("23 008" in bt and "5 012" in bt and "1 431" in bt, "02/01/2027 : Visa Premier 23 008, rejet chèque 5 012, rejet prélèvement 1 431")
    page.get_by_test_id("tab-simu").click()
    page.wait_for_timeout(300)
    opt = text(page.get_by_test_id("preset"))
    check("min. 18 236" in opt and page.get_by_test_id("preset-next").count() == 0, "02/01/2027 : preset BT du simulateur à 18 236")
    page.screenshot(path=str(OUT / "desktop-07-grille-bt-2027.png"), full_page=True)
    ctx.close()

    # ---------- Mobile ----------
    m = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    watch(m)
    m.goto(URL)
    m.wait_for_load_state("networkidle")
    m.wait_for_timeout(900)
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile : pas de débordement horizontal ({overflow}px)")
    m.screenshot(path=str(OUT / "mobile-01-accueil.png"), full_page=False)
    m.screenshot(path=str(OUT / "mobile-02-credit-immo-complet.png"), full_page=True)
    m.get_by_test_id("view-table").click()
    m.wait_for_timeout(300)
    m.locator(".table-wrap").scroll_into_view_if_needed()
    m.screenshot(path=str(OUT / "mobile-03-tableau.png"), full_page=False)
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile tableau : défilement contenu dans le tableau ({overflow}px)")
    run_simulator(m)
    check(abs(digits(m.get_by_test_id("res-pret").inner_text()) - 18285042) <= 1, "mobile : simulateur identique")
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile simulateur : pas de débordement horizontal ({overflow}px)")
    m.get_by_test_id("res-prix").scroll_into_view_if_needed()
    m.screenshot(path=str(OUT / "mobile-04-simulateur-resultat.png"), full_page=False)
    m.screenshot(path=str(OUT / "mobile-05-simulateur-complet.png"), full_page=True)
    browser.close()

check(not errors, f"aucune erreur console/JS/CSP ({errors[:3]})")
check(not external, f"aucune requête vers un autre domaine (polices auto-hébergées) ({external[:3]})")
print(f"\n{len(failures)} échec(s). Captures : {OUT}")
sys.exit(1 if failures else 0)
