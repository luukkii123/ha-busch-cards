# Busch Cards — Lovelace-Karten

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/)

Eigene Karten für Home-Assistant-Dashboards, installierbar über HACS.
**Kein Build-Schritt** — `dist/busch-cards.js` ist Quelltext *und* Auslieferung.

## Installation über HACS

1. HACS → ⋮ → **Custom repositories**
2. Repository: `https://github.com/buschi/busch-cards`, Kategorie: **Dashboard**
3. **Busch Cards** herunterladen, Seite neu laden (Strg+F5)

Manuell: `dist/busch-cards.js` nach `<config>/www/busch-cards.js` kopieren und
unter Einstellungen → Dashboards → ⋮ → **Ressourcen** eintragen:
`/local/busch-cards.js`, Typ **JavaScript-Modul**.

## Enthaltene Karten

### `busch-entities-card`

Entitätenliste mit optionalen Spalten, Icons und Klick auf den Detaildialog.

```yaml
type: custom:busch-entities-card
title: Werkstatt
columns: 2
entities:
  - sensor.busch_temperatur
  - entity: sensor.busch_fortschritt
    name: Druckfortschritt
    icon: mdi:printer-3d
```

| Option | Pflicht | Standard | Bedeutung |
| --- | --- | --- | --- |
| `entities` | ja | — | Liste aus Entity-IDs oder `{entity, name, icon}` |
| `title` | nein | — | Überschrift der Karte |
| `columns` | nein | `1` | Spalten des Rasters, 1–4 |

Ein grafischer Editor ist dabei — die Karte taucht in der Kartenauswahl unter
„Busch Entities" auf.

## Eine weitere Karte hinzufügen

Alles passiert in `dist/busch-cards.js`:

1. Klasse `extends HTMLElement` mit `setConfig(config)`, `set hass(hass)` und
   `getCardSize()`.
2. `customElements.define("busch-xyz-card", BuschXyzCard)`.
3. Eintrag in `window.customCards` anhängen, damit sie in der Kartenauswahl
   erscheint.

Der Dateiname bleibt `busch-cards.js` — er steht in `hacs.json` unter
`filename` und ist der Vertrag mit HACS. Wird er geändert, findet HACS die
Karten nicht mehr.

## Veröffentlichen

```bash
# CARD_VERSION in dist/busch-cards.js hochziehen, dann:
git tag v0.1.0 && git push origin v0.1.0
# auf GitHub aus dem Tag ein Release erzeugen
```

`.github/workflows/release.yml` hängt die JS-Datei automatisch als Asset an.
`.github/workflows/validate.yml` prüft mit der HACS-Action, ob das Repo
installierbar bleibt.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
