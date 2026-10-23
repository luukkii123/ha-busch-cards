# Visuelle Vergleichsbilder

`ui-0.1.0/` enthält 66 geprüfte lokale Chromium-Bilder der sieben
Busch-Karten: Zeitplan (6), Kalender (12), Landkarte (12), Gerät (6),
Smart Entities (6) und beide Unraid-Karten (24). Jede relevante Kartenbreite
320/480/960 px ist in hellem und dunklem Thema enthalten. Zusätzliche
Kalender- und Unraid-Varianten decken kompakt/voll sowie zwei Datenformen ab.

**Historisch:** Die Unraid-Karten sind ab 0.22.0 in
[Unraid Cards](https://github.com/luukkii123/ha-unraid-cards) umgezogen,
samt Renderskripten. Die 24 Bilder unter `ui-0.1.0/unraid/` zeigen den Stand
von Busch Cards ≤ 0.21 und werden hier nicht mehr erzeugt oder verglichen.

Die Bilder stammen aus den jeweiligen Skripten in `docs/render/` und dem
festen Playwright-Image `mcr.microsoft.com/playwright/python:v1.62.0-noble`.
Zum Vergleich nach einem frischen Renderlauf:

```bash
for k in calendar device map schedule smart; do
  python3 docs/render/compare-baselines.py \
    docs/render/baselines/ui-0.1.0/$k /tmp/hacs-$k
done
```

(Je Ordner einzeln, weil das Skript alle Bilder unter dem Baseline-Ordner
erwartet und die historischen Unraid-Bilder sonst als fehlend meldet.)

Das Skript meldet fehlende Bilder, Größenwechsel und mehr als 0,5 %
deutlich geänderte Pixel. Jede beabsichtigte Designänderung erfordert
Sichtung und bewusste Annahme der neuen Bilder; eine Änderung des
gemeinsamen UI-Vertrags erhält eine neue Versionsnummer. Ein grüner
Pixelvergleich ersetzt weder die geometrischen UI-Regeln noch den Test in
der installierten Home-Assistant-Oberfläche. Insbesondere verwenden die
Geräte- und Smart-Proben Attrappen für HA-interne Komponenten; die
Landkarten-Kacheln können von einem externen Dienst abhängen.
