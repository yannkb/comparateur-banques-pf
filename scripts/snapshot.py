#!/usr/bin/env python3
"""Télécharge une source publique et enregistre son texte brut dans data/sources/<id>.txt.

Usage : python3 scripts/snapshot.py <id> <url> [--links]
PDF -> pypdf ; HTML -> texte visible (scripts/styles retirés).
--links affiche les liens de la page (aide à la découverte).
"""
import io, re, sys, urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
OUT = Path(__file__).resolve().parent.parent / "data" / "sources"


class Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template"}
    BLOCK = {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td", "th", "dt", "dd", "table", "ul", "ol"}

    def __init__(self, base):
        super().__init__()
        self.base, self.out, self.links, self.skip = base, [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag in self.BLOCK:
            self.out.append("\n")
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(urljoin(self.base, href))

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", ""), r.geturl()


def to_text(raw, ctype, url):
    if raw[:4] == b"%PDF" or "pdf" in ctype:
        from pypdf import PdfReader
        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages), []
    html = raw.decode("utf-8", errors="replace")
    p = Text(url)
    p.feed(html)
    txt = "".join(p.out).replace("\xa0", " ")
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n\s*\n+", "\n", txt)
    return txt.strip(), p.links


if __name__ == "__main__":
    sid, url = sys.argv[1], sys.argv[2]
    raw, ctype, final = fetch(url)
    txt, links = to_text(raw, ctype, final)
    if sid != "-":
        (OUT / f"{sid}.txt").write_text(txt)
    print(f"{sid}: {final} [{ctype}] {len(raw)} o -> {len(txt)} car.")
    if "--links" in sys.argv:
        for l in dict.fromkeys(links):
            print("  ", l)
