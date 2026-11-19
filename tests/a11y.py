"""Audit d'accessibilité (Playwright + axe-core local, règles WCAG 2.1 A/AA + bonnes pratiques) et navigation clavier.

Usage : python3 tests/a11y.py [URL]   (défaut : http://localhost:4173$BASE_PATH)
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


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, bypass_csp=True)
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)  # fin des animations d'apparition

    for t in ["immo", "compte", "epargne", "conso"]:
        page.get_by_test_id(f"tab-{t}").click()
        page.wait_for_timeout(900)
        axe(page, f"onglet {t} (fiches)")
    page.get_by_test_id("tab-immo").click()
    page.get_by_test_id("view-table").click()
    page.wait_for_timeout(900)
    axe(page, "onglet immo (tableau)")

    page.get_by_test_id("tab-simu").click()
    page.wait_for_timeout(900)
    page.get_by_test_id("ptz").check(force=True)
    page.get_by_test_id("charges").fill("-1")
    page.get_by_test_id("dureeAns").fill("15")
    page.get_by_test_id("taux").fill("4.5")
    page.wait_for_timeout(500)
    axe(page, "simulateur (PTZ, erreur de saisie, alerte d'usure)")

    # Onglets : tabindex itinérant + flèches / Début / Fin
    page.get_by_test_id("tab-immo").click()
    page.get_by_test_id("tab-immo").focus()
    tabindex = page.evaluate("[...document.querySelectorAll('[role=tab]')].map(t => t.tabIndex)")
    check(tabindex == [0, -1, -1, -1, -1], f"un seul onglet dans l'ordre de tabulation ({tabindex})")
    page.keyboard.press("ArrowRight")
    active = page.evaluate("[document.activeElement.dataset.testid, document.activeElement.getAttribute('aria-selected')]")
    check(active == ["tab-compte", "true"], f"flèche droite → onglet suivant sélectionné et focalisé ({active})")
    page.keyboard.press("End")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-simu", "Fin → dernier onglet")
    page.keyboard.press("ArrowRight")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-immo", "flèche droite sur le dernier → premier (boucle)")
    page.keyboard.press("ArrowLeft")
    check(page.evaluate("document.activeElement.dataset.testid") == "tab-simu", "flèche gauche → précédent")
    panel = page.evaluate("(() => { const p = document.querySelector('[role=tabpanel]'); return [p.id, p.getAttribute('aria-labelledby')]; })()")
    check(panel == ["panel-simu", "tab-simu"], f"panneau relié à l'onglet ({panel})")
    check(page.get_by_role("tab", name="Simulateur").get_attribute("aria-controls") == "panel-simu", "aria-controls sur l'onglet")

    # Focus visible sur les champs et les boutons radio
    page.get_by_test_id("revenu").focus()
    o = page.evaluate("getComputedStyle(document.querySelector('[data-testid=revenu]').closest('.field-input')).outlineStyle")
    check(o == "solid", f"focus visible sur un champ numérique ({o})")
    page.get_by_test_id("bien-ancien").focus()
    o = page.evaluate("getComputedStyle(document.querySelector('[data-testid=bien-ancien]').closest('label')).outlineStyle")
    check(o == "solid", f"focus visible sur un bouton radio ({o})")
    browser.close()

print(f"\n{len(failures)} échec(s).")
sys.exit(1 if failures else 0)
