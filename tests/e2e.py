"""Vérification navigateur (Playwright, headless) + captures desktop/mobile.

Usage : npm run build && (npm run preview -- --port 4173 --strictPort &) && python3 tests/e2e.py
"""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(exist_ok=True)
failures, errors = [], []


def check(cond, msg):
    print(("✓ " if cond else "✗ ") + msg)
    if not cond:
        failures.append(msg)


def digits(s):
    return int(re.sub(r"[^\d]", "", s.split("XPF")[0].split("€")[0]) or 0)


def run_simulator(page):
    page.get_by_test_id("tab-simu").click()
    for k, v in {"revenu": 350000, "charges": 30000, "endettement": 35, "dureeAns": 25, "taux": 3, "assurance": 0.38, "apport": 0}.items():
        page.get_by_test_id(k).fill(str(v))
    page.get_by_test_id("bien-ancien").check()
    page.get_by_test_id("preset").select_option("bt")
    page.wait_for_timeout(300)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---------- Desktop ----------
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(900)

    check(page.locator("h1").inner_text().startswith("Comparez"), "titre affiché")
    check(page.locator(".card").count() == 4, "4 fiches établissements (crédit immobilier)")
    check(page.locator(".np").count() > 0, "cases « Non publié » affichées")
    check(page.locator("a.src").count() > 40, f"liens sources présents ({page.locator('a.src').count()})")
    check("17/11/2026" in page.locator(".topbar").inner_text(), "date de mise à jour visible")
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
    page.screenshot(path=str(OUT / "desktop-05-simulateur.png"), full_page=True)

    page.get_by_test_id("cur-EUR").click()
    page.wait_for_timeout(200)
    pret_eur = page.get_by_test_id("res-pret").inner_text()
    print("   prêt en € :", pret_eur.replace("\n", " | "))
    check("153 229" in pret_eur.replace("\u00a0", " ").replace("\u202f", " "), "bascule € : 18 285 042 XPF → 153 229 €")
    page.get_by_text("Éligible au PTZ Pays").click()
    page.wait_for_timeout(200)
    check(page.get_by_test_id("res-ptz").is_visible(), "option PTZ : montant PTZ affiché")
    page.screenshot(path=str(OUT / "desktop-06-simulateur-eur-ptz.png"), full_page=True)
    page.close()

    # ---------- Mobile ----------
    m = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    m.on("pageerror", lambda e: errors.append(str(e)))
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

check(not errors, f"aucune erreur console/JS ({errors[:3]})")
print(f"\n{len(failures)} échec(s). Captures : {OUT}")
sys.exit(1 if failures else 0)
