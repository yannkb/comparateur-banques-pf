"""Vérification navigateur (Playwright, headless) + captures desktop/mobile.

Usage : npm run build && npx vite preview --port 4173 --strictPort  (autre terminal, avec le même BASE_PATH que le build)
        python3 tests/e2e.py [URL]      (défaut : http://localhost:4173$BASE_PATH)
"""
import datetime
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173" + os.environ.get("BASE_PATH", "/")
HOST = urlparse(URL).netloc
OUT = Path(os.environ.get("SCREENSHOTS_DIR") or Path(__file__).resolve().parent.parent / "screenshots")
OUT.mkdir(parents=True, exist_ok=True)
failures, errors, external = [], [], []
DATA = json.loads((Path(__file__).resolve().parent.parent / "data" / "banks.json").read_text())


def has_code(e, code):
    """Code d'un attribut : valeur unique ou liste (attribut « multi », ex. réseau CB + Visa)."""
    c = e.get("code")
    return code in c if isinstance(c, list) else c == code


def shared(p, attr):
    """Attribut commun de la banque (hérité par le produit s'il ne le redéfinit pas)."""
    return next(b for b in DATA["banks"] if b["id"] == p["bank"]).get("shared", {}).get(attr, {})


def expected_cheapest(attr, code, iso):
    """Réimplémentation indépendante : carte(s) la/les moins chère(s) dont `attr` est publié et vaut `code` à la date `iso`."""
    def at(e):
        ch = sorted([c for c in (e or {}).get("changes", []) if c["effective_from"] <= iso], key=lambda c: c["effective_from"])
        return ch[-1] if ch else e
    best, ids = None, set()
    for p in DATA["products"]:
        if p["kind"] != "carte":
            continue
        for v in p.get("variants") or [None]:
            attrs = {**p["attrs"], **((v or {}).get("attrs") or {})}
            e, fee = at(attrs[attr]), at(attrs["cotisation"])
            if e.get("status") != "found" or not has_code(e, code) or fee.get("status") != "found":
                continue
            rid = p["id"] + ("/" + v["id"] if v else "")
            if best is None or fee["num"] < best:
                best, ids = fee["num"], {rid}
            elif fee["num"] == best:
                ids.add(rid)
    return ids, best


def expected_cheapest_where(conds, iso):
    """Comme expected_cheapest, avec plusieurs attributs imposés (ex. réseau Visa ET utilisable à l'étranger)."""
    def at(e):
        ch = sorted([c for c in (e or {}).get("changes", []) if c["effective_from"] <= iso], key=lambda c: c["effective_from"])
        return ch[-1] if ch else e
    best, ids = None, set()
    for p in DATA["products"]:
        if p["kind"] != "carte":
            continue
        for v in p.get("variants") or [None]:
            attrs = {**p["attrs"], **((v or {}).get("attrs") or {})}
            if any(at(attrs.get(a) or shared(p, a)).get("status") != "found" or not has_code(at(attrs.get(a) or shared(p, a)), c) for a, c in conds.items()):
                continue
            fee = at(attrs["cotisation"])
            if fee.get("status") != "found":
                continue
            rid = p["id"] + ("/" + v["id"] if v else "")
            if best is None or fee["num"] < best:
                best, ids = fee["num"], {rid}
            elif fee["num"] == best:
                ids.add(rid)
    return ids, best


NEW_FINDERS = ["credit_immo", "compte", "epargne", "credit_conso"]


def at_date(e, iso):
    ch = sorted([c for c in (e or {}).get("changes", []) if c["effective_from"] <= iso], key=lambda c: c["effective_from"])
    return ch[-1] if ch else (e or {})


def catalog_rows(cid, iso):
    """Réimplémentation indépendante des lignes d'un catalogue : variantes, attributs communs hérités de la banque."""
    c = next(x for x in DATA["catalogs"] if x["id"] == cid)
    sh = [a["id"] for a in c["attributes"] if a.get("shared")]
    rows = []
    for p in DATA["products"]:
        if p["kind"] != cid:
            continue
        for v in p.get("variants") or [None]:
            attrs = {**p["attrs"], **((v or {}).get("attrs") or {})}
            for a in sh:
                if a not in attrs and shared(p, a):
                    attrs[a] = shared(p, a)
            rows.append({"id": p["id"] + ("/" + v["id"] if v else ""), "bank": p["bank"], "attrs": {k: at_date(e, iso) if isinstance(e, dict) else e for k, e in attrs.items()}})
    return c, rows


def expected_preset(cid, pid, iso, amount=None):
    """Résultats attendus d'une question rapide (filtres + coût pour le montant + meilleure(s) ligne(s)), recalculés des données."""
    c, rows = catalog_rows(cid, iso)
    preset = next(x for x in c["presets"] if x["id"] == pid)
    facets = {f["id"]: f for f in c["facets"]}
    inp = {i["id"]: i for i in c.get("inputs", [])}
    amt = amount if amount is not None else (inp[c["cost"]["amount"]]["default"] if c.get("cost", {}).get("amount") else None)

    def cost(r):
        e = r["attrs"].get(c["cost"]["attr"]) if c.get("cost") else None
        if not e or e.get("status") != "found":
            return None
        if c["cost"].get("amount"):
            if "fee" in e:
                f = e["fee"]
                v = amt * f["pct"] / 100 if amt > 0 else 0
                v = max(v, f.get("min", 0)) if amt > 0 else 0
                return min(v, f["max"]) if "max" in f else v
            return e.get("num")
        return e.get("num")

    matches = []
    for r in rows:
        ok = True
        for fid, v in preset["state"].items():
            f = facets[fid]
            if f.get("field") == "bank":
                ok = ok and r["bank"] in v
                continue
            e = r["attrs"].get(f["attr"]) or {}
            if e.get("status") != "found":
                ok = False
            elif f["type"] == "bool":
                ok = ok and e.get("code") is v
            else:
                ok = ok and any(has_code(e, x) for x in v)
        if ok:
            matches.append(r)
    if c["best"].get("by"):
        a = c["best"]["by"]["attr"]
        vals = [r["attrs"][a]["num"] for r in matches if r["attrs"].get(a, {}).get("status") == "found" and isinstance(r["attrs"][a].get("num"), (int, float))]
        top = max(vals) if vals else None
        best = {r["id"] for r in matches if top is not None and r["attrs"].get(a, {}).get("num") == top}
    else:
        costs = [cost(r) for r in matches if cost(r) is not None]
        low = min(costs) if costs else None
        best = {r["id"] for r in matches if low is not None and cost(r) == low}
    return {r["id"] for r in matches}, best, {r["id"]: cost(r) for r in matches}


def run_new_finders(page, iso):
    """Questions rapides de chaque nouvel onglet : résultats et meilleure(s) ligne(s) identiques au calcul de référence."""
    for cid in NEW_FINDERS:
        c = next(x for x in DATA["catalogs"] if x["id"] == cid)
        page.get_by_test_id(f"tab-{c['category']}").click()
        page.get_by_test_id(f"subview-{cid}").click()
        page.wait_for_timeout(700)
        check(page.get_by_test_id(f"finder-{cid}").is_visible(), f"{cid} : sous-vue « {c['label']} » affichée dans l'onglet {c['category']}")
        for pr in c["presets"]:
            page.get_by_test_id(f"preset-{pr['id']}").click()
            page.wait_for_timeout(300)
            exp, best, costs = expected_preset(cid, pr["id"], iso)
            got = {x.get_attribute("data-testid")[6:] for x in page.locator("[data-testid=finder-results] .pcard").all()}
            got_best = {x.get_attribute("data-testid")[6:] for x in page.locator("[data-testid=finder-results] .pcard:has([data-testid=tag-cheapest])").all()}
            check(got == exp and got_best == best, f"{cid} · « {pr['label']} » : {len(got)} résultat(s), meilleur(s) {sorted(got_best)} (référence : {len(exp)}, {sorted(best)})")
            if pr["state"]:
                check(f"vue={cid}" in page.url, f"{cid} · « {pr['id']} » : état dans l'URL ({page.url.split('?')[-1][:60]})")
        if c.get("rules"):
            check(page.get_by_test_id("finder-rules").locator("li").count() == len(c["rules"]), f"{cid} : {len(c['rules'])} règles communes affichées et sourcées")
        if c.get("cost", {}).get("amount"):
            amount_in = page.get_by_test_id(f"in-{cid}-montant")
            if amount_in.count():
                pr = c["presets"][0]
                page.get_by_test_id(f"preset-{pr['id']}").click()
                amount_in.fill("5000000")
                page.wait_for_timeout(400)
                exp, best, costs = expected_preset(cid, pr["id"], iso, amount=5000000)
                first = first_card(page)
                shown = digits(text(page.locator(f"[data-testid=pcard-{first}] [data-testid=pcost-value]")))
                check(first in best and abs(shown - round(costs[first])) <= 1, f"{cid} : pour 5 000 000 XPF, {first} en tête à {shown} XPF de frais (référence {round(costs[first])})")
                amount_in.fill(str(next(i for i in c["inputs"] if i["id"] == "montant")["default"]))
        page.get_by_test_id("finder-reset").click()


def first_card(page, sel="finder-results"):
    return page.locator(f"[data-testid={sel}] .pcard").first.get_attribute("data-testid").removeprefix("pcard-")


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

    # ---------- Trouver ma carte (questions rapides, non publié, URL, devise) ----------
    page.get_by_test_id("subview-carte").click()
    page.wait_for_timeout(300)
    check(page.get_by_test_id("finder-carte").is_visible(), "sous-vue « Trouver ma carte » affichée dans Comptes & cartes")
    page.get_by_test_id("preset-visa-moins-chere").click()
    page.wait_for_timeout(300)
    exp, price = expected_cheapest("reseau", "visa", "2026-11-18")
    got = first_card(page)
    check(got in exp and page.locator(f"[data-testid='pcard-{got}'] [data-testid=tag-cheapest]").count() == 1,
          f"« Visa la moins chère » : {got} en tête, étiquetée « La moins chère » (attendu d'après les données : {sorted(exp)}, {price} XPF/an)")
    check(str(price)[:-3] + " " + str(price)[-3:] in text(page.locator(f"[data-testid='pcard-{got}'] [data-testid=pcost-value]")), "« Visa la moins chère » : cotisation affichée")
    pre = text(page.locator("[data-testid=pcard-bt-visa-infinite] [data-testid=pcost]"))
    check("55 843" in pre and "NOUVELLE GRILLE AU 01/01/2027" in pre.upper() and "56 960" in pre, "18/11/2026 : Visa Infinite BT 55 843, nouvelle grille 56 960 annoncée")
    check("reseau=visa" in page.url and "vue=carte" in page.url, f"question rapide reflétée dans l'URL ({page.url.split('?')[-1]})")
    check(page.get_by_test_id("preset-visa-moins-chere").get_attribute("aria-pressed") == "true", "question rapide active : aria-pressed")
    # Carte « Visa » la moins chère non utilisable à l'étranger : alerte dans la fiche + réponse « utilisable à l'étranger » à côté
    intl = DATA["products"][[q["id"] for q in DATA["products"]].index(got.split("/")[0])]["attrs"]["international"]
    if intl.get("status") == "found" and intl.get("code") is False:
        card = page.locator(f"[data-testid='pcard-{got}']")
        check(card.get_by_test_id("tag-flag-international").count() == 1 and "Non" in text(card.locator(".pattrs").first),
              f"« Visa la moins chère » ({got}) : « Pas utilisable à l’étranger » affiché dans la fiche")
    page.screenshot(path=str(OUT / "desktop-light-trouver-ma-carte.png"), full_page=False)
    exp2, price2 = expected_cheapest_where({"reseau": "visa", "international": True}, "2026-11-18")
    rel = text(page.get_by_test_id("related-visa-etranger-moins-chere"))
    names = {f"{b['short']} {q['name']}" for q in DATA["products"] for b in DATA["banks"] if q["id"] in {i.split("/")[0] for i in exp2} and b["id"] == q["bank"]}
    check(any(n in rel for n in names) and f"{price2:,}".replace(",", " ") in rel,
          f"question liée : « Visa la moins chère utilisable à l’étranger » → {sorted(names)} {price2} XPF (affiché : {rel})")
    page.get_by_test_id("related-apply-visa-etranger-moins-chere").click()
    page.wait_for_timeout(300)
    got2 = first_card(page)
    check(got2 in exp2 and page.get_by_test_id("preset-visa-etranger-moins-chere").get_attribute("aria-pressed") == "true"
          and "etranger=1" in page.url and page.locator(f"[data-testid='pcard-{got2}'] [data-testid=tag-cheapest]").count() == 1,
          f"« voir » : question « Visa utilisable à l’étranger » active, {got2} en tête et « La moins chère »")
    page.screenshot(path=str(OUT / "desktop-light-trouver-ma-carte-visa-etranger.png"), full_page=False)
    page.get_by_test_id("preset-visa-moins-chere").click()
    page.wait_for_timeout(300)
    page.get_by_test_id("preset-sans-contact-moins-chere").click()
    page.wait_for_timeout(300)
    exp, price = expected_cheapest("sans_contact", True, "2026-11-18")
    got = first_card(page)
    check(got in exp and page.locator(f"[data-testid='pcard-{got}'] [data-testid=tag-cheapest]").count() == 1,
          f"« Sans contact la moins chère » : {got} en tête (attendu d'après les données : {sorted(exp)}, {price} XPF/an)")
    unknown = [c.get_attribute("data-testid") for c in page.locator("[data-testid=finder-unknown] .pcard").all()]
    check("pcard-marara-fenua" in unknown, f"carte au sans contact non publié listée « à vérifier », pas comptée comme « oui » ({len(unknown)} à vérifier)")
    check(page.locator("[data-testid=finder-results] [data-testid=pcard-socredo-classic]").count() == 0, "carte « sans contact : Non » exclue")
    page.locator("label:has([data-testid=include-unknown])").click()
    page.wait_for_timeout(200)
    check(page.locator("[data-testid=finder-unknown]").count() == 0 and "np=0" in page.url, "option « masquer les non publié » (et dans l'URL)")
    page.locator("label:has([data-testid=include-unknown])").click()
    page.get_by_test_id("cur-EUR").click()
    page.wait_for_timeout(200)
    check("€" in text(page.locator("[data-testid=pcost-value]").first), f"bascule € dans les résultats ({text(page.locator('[data-testid=pcost-value]').first)})")
    page.get_by_test_id("cur-XPF").click()
    page.screenshot(path=str(OUT / "desktop-08-trouver-ma-carte.png"), full_page=True)
    page.get_by_test_id("preset-carte-jeune").click()
    page.wait_for_timeout(300)
    check(page.locator("[data-testid=pcard-socredo-uru-jeunes]").count() == 1 and "via offre groupée" in text(page.get_by_test_id("pcard-socredo-uru-jeunes")),
          "« Carte jeune » : carte vendue en offre groupée affichée « via offre groupée »")
    page.get_by_test_id("finder-reset").click()
    page.get_by_test_id("subview-compare").click()
    page.wait_for_timeout(200)
    check("vue=" not in page.url and page.locator(".card").count() == 4, "retour à la comparaison : URL nettoyée, fiches établissements")

    # Lien partagé : ouverture directe de la vue filtrée
    page.goto(URL + "?vue=carte&reseau=visa&etranger=1&tri=frais_etranger")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    check(page.get_by_test_id("finder-carte").is_visible() and page.get_by_test_id("f-carte-reseau-visa").is_checked(), "lien partagé : vue et filtres restaurés")
    check(page.get_by_test_id("finder-sort").input_value() == "frais_etranger", "lien partagé : tri restauré")

    # ---------- Repères officiels ----------
    page.get_by_test_id("tab-reperes").click()
    page.wait_for_timeout(700)
    R = DATA["reperes"]
    sec = {x["id"]: x for x in R["sections"]}
    check(page.get_by_test_id("reperes").is_visible() and page.locator(".rep-table").count() == sum(1 for x in R["sections"] if x["kind"] == "table"),
          "Repères officiels : onglet et tableaux affichés")
    taux = sec["taux"]["table"]
    last = taux["columns"][-1]["id"]
    hab = next(r for r in taux["rows"] if r["id"] == "pf_habitat")["cells"][last]
    cell = text(page.locator("[data-testid=rep-row-pf_habitat] td").last)
    check(hab["value"].replace("\u00a0", " ") in cell and hab["value"].replace("\u00a0", " ") == DATA["market"]["ieom_habitat"]["value"].replace("\u00a0", " "),
          f"taux moyen habitat IEOM {last} = {cell} (= repère du bandeau)")
    check(page.locator("[data-testid=rep-row-pf_habitat] td a.cell-src").count() == len(taux["columns"]), "série habitat : chaque trimestre est un lien sourcé")
    title = page.locator("[data-testid=rep-row-pf_habitat] td a.cell-src").last.get_attribute("title")
    check("IEOM" in title and "Citation" in title and "2,85" in title, "survol d'une cellule : source et citation")
    us = sec["usure"]["table"]
    ucol = us["columns"][-1]["id"]
    u20 = next(r for r in us["rows"] if r["id"] == "immo_20_plus")["cells"][ucol]
    check(u20["num"] == DATA["market"]["usure_habitat"]["num"] and u20["value"].replace("\u00a0", " ") in text(page.locator("[data-testid=rep-row-immo_20_plus]")),
          f"seuil d'usure ≥ 20 ans au {ucol} : {u20['value']} (= paramètre du simulateur)")
    ira = text(page.get_by_test_id("rule-ira-immo"))
    check("3 %" in ira and "Arrêté 1813 CM" in ira, "barème IRA immobilier (arrêté n° 1813 CM) affiché et sourcé")
    check("FIT" in text(page.get_by_test_id("rule-fit-immo")), "fiche d'information type obligatoire (LP 2025-21) affichée")
    check(page.get_by_test_id("finder-engagement").is_visible(), "engagements de l'accord : moteur de filtres générique")
    page.get_by_test_id("preset-carte-debit-immediat").click()
    page.wait_for_timeout(300)
    cards = page.locator("[data-testid=finder-results] .pcard")
    exp_rows = [q for q in DATA["products"] if q["kind"] == "engagement" and q["attrs"].get("service", {}).get("code") == "carte_di"]
    check(cards.count() == len(exp_rows), f"engagements « carte à débit immédiat » : {cards.count()} lignes (données : {len(exp_rows)})")
    num = {q["id"]: q["attrs"]["tarif"]["num"] for q in exp_rows}
    tarifs = [num[c.get_attribute("data-testid")[6:]] for c in cards.all()]
    check(tarifs == sorted(tarifs), f"tri par tarif IEOM croissant ({tarifs})")
    check("service=carte_di" in page.url and "vue=engagement" in page.url, f"état des engagements dans l'URL ({page.url.split('?')[-1]})")
    page.get_by_test_id("preset-suivi-ieom").click()
    page.wait_for_timeout(300)
    bt = page.get_by_test_id("pcard-eng-bt-suivi")
    check(bt.count() == 1 and bt.get_by_test_id("tag-compare-diff").count() == 1 and "3 150" in text(bt), "suivi IEOM : écart BT (virement permanent 3 150 vs grille) signalé")
    check(page.locator("[data-testid=finder-results] [data-testid=tag-compare-diff]").count() == 1, "un seul écart IEOM / grille dans le suivi")
    page.goto(URL + "?vue=engagement&eb=marara")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    check(page.get_by_test_id("tab-reperes").get_attribute("aria-selected") == "true" and page.get_by_test_id("f-engagement-banque-marara").is_checked(),
          "lien partagé ?vue=engagement : onglet Repères et filtre banque restaurés")
    marara = page.locator("[data-testid=finder-results] .pcard")
    check(marara.count() >= 5 and all(c.get_attribute("data-testid").startswith("pcard-eng-marara") for c in marara.all()), f"filtre banque MARARA ({marara.count()} engagements)")
    page.get_by_test_id("finder-reset").click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "desktop-light-reperes-officiels.png"), full_page=True)

    page.get_by_test_id("tab-epargne").click()
    page.wait_for_timeout(400)
    check(page.locator(".card").first.get_attribute("data-testid") == "card-bt", "épargne : meilleur livret (BT 0,30 %) en premier")
    page.get_by_test_id("tab-conso").click()
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / "desktop-04-credit-conso.png"), full_page=True)

    run_new_finders(page, datetime.date.today().isoformat())
    for cid in NEW_FINDERS:
        page.goto(URL + f"?vue={cid}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / f"desktop-light-trouver-{cid}.png"), full_page=True)
    page.get_by_test_id("tab-immo").click()
    page.get_by_test_id("subview-compare").click()

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
    page.get_by_test_id("subview-carte").click()
    page.get_by_test_id("preset-haut-de-gamme").click()
    page.wait_for_timeout(300)
    inf = text(page.locator("[data-testid=pcard-bt-visa-infinite] [data-testid=pcost]"))
    check("56 960" in inf and "55 843" not in inf and "NOUVELLE GRILLE" not in inf.upper(), f"02/01/2027 : Trouver ma carte, Visa Infinite BT à 56 960 (grille 2027) ({inf.splitlines()[0]})")
    exp, price = expected_cheapest("sans_contact", True, "2027-01-02")
    page.get_by_test_id("preset-sans-contact-moins-chere").click()
    page.wait_for_timeout(300)
    check(first_card(page) in exp, f"02/01/2027 : « Sans contact la moins chère » cohérente avec les données ({sorted(exp)})")
    page.get_by_test_id("subview-compare").click()
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
    m.goto(URL + "?vue=carte&sans_contact=1")
    m.wait_for_load_state("networkidle")
    m.wait_for_timeout(700)
    exp, _ = expected_cheapest("sans_contact", True, datetime.date.today().isoformat())
    check(first_card(m) in exp, "mobile : « Sans contact la moins chère » via lien partagé")
    m.get_by_test_id("facets-toggle").click()
    m.wait_for_timeout(200)
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile Trouver ma carte (filtres ouverts) : pas de débordement horizontal ({overflow}px)")
    m.locator("[data-testid=pmore] summary, .pmore summary").first.click()
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile Trouver ma carte (détails ouverts) : pas de débordement horizontal ({overflow}px)")
    m.screenshot(path=str(OUT / "mobile-06-trouver-ma-carte.png"), full_page=True)
    m.goto(URL)
    m.wait_for_load_state("networkidle")
    run_simulator(m)
    check(abs(digits(m.get_by_test_id("res-pret").inner_text()) - 18285042) <= 1, "mobile : simulateur identique")
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile simulateur : pas de débordement horizontal ({overflow}px)")
    m.get_by_test_id("res-prix").scroll_into_view_if_needed()
    m.screenshot(path=str(OUT / "mobile-04-simulateur-resultat.png"), full_page=False)
    m.screenshot(path=str(OUT / "mobile-05-simulateur-complet.png"), full_page=True)
    m.goto(URL + "?vue=engagement")
    m.wait_for_load_state("networkidle")
    m.wait_for_timeout(900)
    overflow = m.evaluate("document.documentElement.scrollWidth - 390")
    check(overflow <= 0, f"mobile Repères officiels : pas de débordement horizontal ({overflow}px)")
    m.screenshot(path=str(OUT / "mobile-light-reperes-officiels.png"), full_page=True)
    m.goto(URL + "?vue=carte&reseau=visa")
    m.wait_for_load_state("networkidle")
    m.wait_for_timeout(700)
    m.screenshot(path=str(OUT / "mobile-light-trouver-ma-carte.png"), full_page=False)
    for cid in NEW_FINDERS:
        m.goto(URL + f"?vue={cid}")
        m.wait_for_load_state("networkidle")
        m.wait_for_timeout(700)
        m.get_by_test_id("facets-toggle").click()
        m.locator(".pmore summary").first.click()
        m.wait_for_timeout(200)
        overflow = m.evaluate("document.documentElement.scrollWidth - 390")
        check(overflow <= 0, f"mobile {cid} (filtres et détails ouverts) : pas de débordement horizontal ({overflow}px)")
        m.screenshot(path=str(OUT / f"mobile-light-trouver-{cid}.png"), full_page=True)
    m.close()

    # ---------- Thème sombre (prefers-color-scheme: dark) ----------
    for vp, name, mobile in (({"width": 1440, "height": 900}, "desktop", False), ({"width": 390, "height": 844}, "mobile", True)):
        dctx = browser.new_context(viewport=vp, color_scheme="dark", is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        d = dctx.new_page()
        watch(d)
        d.goto(URL)
        d.wait_for_load_state("networkidle")
        d.wait_for_timeout(900)
        bg = d.evaluate("getComputedStyle(document.body).backgroundColor")
        fg = d.evaluate("getComputedStyle(document.body).color")
        check(bg == "rgb(13, 27, 28)" and fg == "rgb(236, 228, 211)", f"{name} sombre : fond et texte du thème sombre ({bg}, {fg})")
        check(d.evaluate("document.querySelector('meta[name=color-scheme]').content") == "light dark", f"{name} sombre : <meta name=color-scheme content=\"light dark\">")
        d.get_by_test_id("tab-reperes").click()
        d.wait_for_timeout(900)
        overflow = d.evaluate(f"document.documentElement.scrollWidth - {vp['width']}")
        check(overflow <= 0, f"{name} sombre Repères officiels : pas de débordement horizontal ({overflow}px)")
        d.screenshot(path=str(OUT / f"{name}-dark-reperes-officiels.png"), full_page=True)
        d.goto(URL + "?vue=carte&reseau=visa")
        d.wait_for_load_state("networkidle")
        d.wait_for_timeout(900)
        check(d.get_by_test_id("related-visa-etranger-moins-chere").count() == 1, f"{name} sombre : question liée affichée")
        overflow = d.evaluate(f"document.documentElement.scrollWidth - {vp['width']}")
        check(overflow <= 0, f"{name} sombre Trouver ma carte : pas de débordement horizontal ({overflow}px)")
        d.screenshot(path=str(OUT / f"{name}-dark-trouver-ma-carte.png"), full_page=not mobile)
        for cid in NEW_FINDERS:
            d.goto(URL + f"?vue={cid}")
            d.wait_for_load_state("networkidle")
            d.wait_for_timeout(800)
            overflow = d.evaluate(f"document.documentElement.scrollWidth - {vp['width']}")
            check(overflow <= 0, f"{name} sombre {cid} : pas de débordement horizontal ({overflow}px)")
            d.screenshot(path=str(OUT / f"{name}-dark-trouver-{cid}.png"), full_page=True)
        dctx.close()
    browser.close()

check(not errors, f"aucune erreur console/JS/CSP ({errors[:3]})")
check(not external, f"aucune requête vers un autre domaine (polices auto-hébergées) ({external[:3]})")
print(f"\n{len(failures)} échec(s). Captures : {OUT}")
sys.exit(1 if failures else 0)
