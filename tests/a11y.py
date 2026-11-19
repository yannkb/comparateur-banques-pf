"""Audit d'accessibilité (Playwright + axe-core local, règles WCAG 2.1 A/AA + bonnes pratiques) et navigation clavier,
dans les DEUX thèmes (clair et sombre, `prefers-color-scheme` émulé) : 0 violation attendue, contrastes compris.

Usage : python3 tests/a11y.py [URL]   (défaut : http://localhost:4173$BASE_PATH)
        A11Y_SCHEMES=dark python3 tests/a11y.py   (un seul thème)
axe-core est lu dans node_modules (aucun CDN) ; le contexte contourne la CSP uniquement pour l'injecter.
"""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173" + os.environ.get("BASE_PATH", "/")
AXE = (ROOT / "node_modules/axe-core/axe.min.js").read_text()
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]
SCHEMES = os.environ.get("A11Y_SCHEMES", "light,dark").split(",")
failures = []


def check(cond, msg):
    print(("✓ " if cond else "✗ ") + msg)
    if not cond:
        failures.append(msg)


def axe(page, label):
    page.add_script_tag(content=AXE)
    res = page.evaluate("async (tags) => (await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })).violations"
                        ".map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').slice(0, 140)) }))", TAGS)
    check(not res, f"axe {label} : {len(res)} violation(s)" + ("" if not res else "\n" + json.dumps(res, ensure_ascii=False, indent=1)))


def audit(browser, scheme):
    print(f"\n=== Thème {scheme} ===")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, bypass_csp=True, color_scheme=scheme)
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)  # fin des animations d'apparition
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check((bg == "rgb(13, 27, 28)") == (scheme == "dark"), f"[{scheme}] fond de page du thème ({bg})")

    for t in ["immo", "compte", "epargne", "conso"]:
        page.get_by_test_id(f"tab-{t}").click()
        page.wait_for_timeout(900)
        axe(page, f"[{scheme}] onglet {t} (fiches)")
    page.get_by_test_id("tab-immo").click()
    page.get_by_test_id("view-table").click()
    page.wait_for_timeout(900)
    axe(page, f"[{scheme}] onglet immo (tableau)")
    page.get_by_test_id("view-cards").click()

    # Trouver ma carte : questions rapides, filtres, résultats et « non publié »
    page.get_by_test_id("tab-compte").click()
    page.get_by_test_id("subview-carte").click()
    page.get_by_test_id("preset-sans-contact-moins-chere").click()
    page.wait_for_timeout(900)
    page.locator(".pmore summary").first.click()
    axe(page, f"[{scheme}] Trouver ma carte (sans contact, détails ouverts)")
    page.get_by_test_id("preset-visa-moins-chere").click()
    page.wait_for_timeout(900)
    axe(page, f"[{scheme}] Trouver ma carte (Visa la moins chère, question liée, alerte « pas à l’étranger »)")
    page.get_by_test_id("preset-carte-jeune").click()
    page.get_by_test_id("f-carte-mobile").select_option("apple_google")
    page.wait_for_timeout(900)
    axe(page, f"[{scheme}] Trouver ma carte (carte jeune + paiement mobile)")
    # clavier : une question rapide s'active au clavier et le focus reste visible
    page.get_by_test_id("preset-visa-moins-chere").focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    check(page.get_by_test_id("preset-visa-moins-chere").get_attribute("aria-pressed") == "true", f"[{scheme}] question rapide activable au clavier (Entrée)")
    o = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
    check(o == "solid", f"[{scheme}] focus visible sur une question rapide ({o})")
    page.get_by_test_id("f-carte-sans_contact-oui").focus()
    o = page.evaluate("getComputedStyle(document.activeElement.closest('label')).outlineStyle")
    check(o == "solid", f"[{scheme}] focus visible sur un filtre Oui/Non ({o})")
    page.get_by_test_id("subview-compare").click()

    # Repères officiels : tableaux sourcés, règles, engagements filtrables
    page.get_by_test_id("tab-reperes").click()
    page.wait_for_timeout(1200)
    axe(page, f"[{scheme}] Repères officiels")
    page.get_by_test_id("preset-suivi-ieom").click()
    page.wait_for_timeout(900)
    page.locator("[data-testid=finder-engagement] .pmore summary").first.click()
    axe(page, f"[{scheme}] Repères officiels (suivi IEOM, détails ouverts)")
    page.locator(".cell-src").nth(1).focus()
    page.keyboard.press("Shift+Tab")
    o = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
    check(o == "solid", f"[{scheme}] focus visible sur une valeur sourcée de tableau ({o})")

    mob = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, bypass_csp=True, color_scheme=scheme).new_page()
    mob.goto(URL + "?vue=carte&sans_contact=1")
    mob.wait_for_load_state("networkidle")
    mob.wait_for_timeout(1200)
    mob.get_by_test_id("facets-toggle").click()
    mob.wait_for_timeout(300)
    axe(mob, f"[{scheme}] mobile Trouver ma carte (filtres ouverts)")
    mob.goto(URL + "?vue=engagement")
    mob.wait_for_load_state("networkidle")
    mob.wait_for_timeout(1200)
    axe(mob, f"[{scheme}] mobile Repères officiels")
    mob.close()

    page.get_by_test_id("tab-simu").click()
    page.wait_for_timeout(900)
    page.get_by_test_id("ptz").check(force=True)
    page.get_by_test_id("charges").fill("-1")
    page.get_by_test_id("dureeAns").fill("15")
    page.get_by_test_id("taux").fill("4.5")
    page.wait_for_timeout(500)
    axe(page, f"[{scheme}] simulateur (PTZ, erreur de saisie, alerte d'usure)")

    # Onglets : tabindex itinérant + flèches / Début / Fin
    page.get_by_test_id("tab-immo").click()
    page.get_by_test_id("tab-immo").focus()
    tabindex = page.evaluate("[...document.querySelectorAll('[role=tab]')].map(t => t.tabIndex)")
    check(tabindex == [0, -1, -1, -1, -1, -1], f"[{scheme}] un seul onglet dans l'ordre de tabulation ({tabindex})")
    page.keyboard.press("ArrowRight")
    active = page.evaluate("[document.activeElement.dataset.testid, document.activeElement.getAttribute('aria-selected')]")
    check(active == ["tab-compte", "true"], f"[{scheme}] flèche droite → onglet suivant sélectionné et focalisé ({active})")
    page.keyboard.press("End")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-simu", f"[{scheme}] Fin → dernier onglet")
    page.keyboard.press("ArrowRight")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-immo", f"[{scheme}] flèche droite sur le dernier → premier (boucle)")
    page.keyboard.press("ArrowLeft")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-simu", f"[{scheme}] flèche gauche → précédent")
    page.keyboard.press("ArrowLeft")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-reperes", f"[{scheme}] flèche gauche → Repères officiels")
    page.keyboard.press("ArrowRight")
    panel = page.evaluate("(() => { const p = document.querySelector('[role=tabpanel]'); return [p.id, p.getAttribute('aria-labelledby')]; })()")
    check(panel == ["panel-simu", "tab-simu"], f"[{scheme}] panneau relié à l'onglet ({panel})")
    check(page.get_by_role("tab", name="Simulateur").get_attribute("aria-controls") == "panel-simu", f"[{scheme}] aria-controls sur l'onglet")

    # Focus visible sur les champs et les boutons radio
    page.get_by_test_id("revenu").focus()
    o = page.evaluate("getComputedStyle(document.querySelector('[data-testid=revenu]').closest('.field-input')).outlineStyle")
    check(o == "solid", f"[{scheme}] focus visible sur un champ numérique ({o})")
    page.get_by_test_id("bien-ancien").focus()
    o = page.evaluate("getComputedStyle(document.querySelector('[data-testid=bien-ancien]').closest('label')).outlineStyle")
    check(o == "solid", f"[{scheme}] focus visible sur un bouton radio ({o})")
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for scheme in SCHEMES:
        audit(browser, scheme)
    browser.close()

print(f"\n{len(failures)} échec(s).")
sys.exit(1 if failures else 0)
