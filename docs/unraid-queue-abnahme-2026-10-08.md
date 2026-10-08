# Unraid Cards — Queue-Abnahme 08.10.2026

Todo #154, Version 0.17.0. Quelle sind ausschließlich die Backendattribute:
Queue/Phasen/Positionen/echte optionale Prozentwerte, Fehler und Backendzähler.
Keine eigene Queue, Zeitheuristik oder geschätzten Prozentwerte. Ein nativer
Stack-Update-All-Button; kein Phantomknopf ohne zugehörige Entität. Details
bleiben während eines Jobs verfügbar; Queuebutton/konkurrierende Aktionen
bleiben gesperrt. Failed/Completed bleiben nach dem Batch nachvollziehbar.

Tatsächlich: kompletter Node-Lauf 433 Fälle (432 bestanden, 1 bestehender
optionaler Differenztest gegen externe auto-entities-Module übersprungen),
52 gezielte Unraid-/Namensraumfälle bestanden. Pure Backend-/echte HA-
Contract-/Reloadtests siehe Nachbarrepo `docs/update-queue-abnahme-2026-10-08.md`.
Statischer UI-Prüfer 0 Verstöße. `docs/render/unraid-queue.py`: je 216
synthetische und bestehender HA-Host/native Komponentenfälle, sechs Breiten
320/360/390/480/768/960, beide Themes, neun Zustandsvarianten. Überlauf und
Touchziele >=44px tatsächlich gemessen. Native Details per Tastatur,
Stateänderung ohne neue hass-Zuweisung, keine Serviceaufrufe. Screenshots
privat außerhalb Git; Mobilbild angesehen, doppelte Headerbuttons und lange
Positionslabels im disabled Button korrigiert. Native HA-Themes lokal im
Probeharness; Nutzerpräferenzen/Dashboardkonfiguration unverändert.

## Alle 26 Regeln im Änderungsumfang

| ID | Urteil / tatsächlich ausgeführter Beleg und Grenze |
|---|---|
| R01 | Einheitliche Statushilfe für Stack/Container, Node-/Browserfälle. |
| R02 | Batch über nativen Backendbutton; kein eigener Auswahlpfad. |
| R03 | Details im echten Host per Keyboard bedienbar; vollständige andere Karten-/Editor-Keyboardabnahme hier ungeprüft. |
| R04 | Kein neuer Queue-Dialog; native More-info wird delegiert. Zeitblock-R04 separat lokal. |
| R05 | Keine neue Navigation; Update-Details Event getestet, komplette Host Back/Forward-Abnahme hier ungeprüft. |
| R06 | Sechs tatsächliche Viewports, Theme/Overflow/44px Touchchecks bestanden. |
| R07 | Eingebettete HA-Karte, kein eigenes PWA-Manifest; Hostinstallation ungeprüft. |
| R08 | Zentraler Parser/Status/Progressrenderer, beide Karten mit gleichem Backendvertrag. |
| R09 | BuschUI/HA-Tokens und native Status/Buttons; Light/Dark reale Komponenten bestanden. |
| R10 | Keine neuen Editorfelder; bestehende Editorsuite bestanden. Alle Hosteditor-Dirtyfälle nicht erneut geprüft. |
| R11 | Backendphasen, Positionsbadge, Zähler und echter optionaler Balken; Doppelklicktests bestanden. |
| R12 | Backendfehler mit Auswirkung/nächster Aktion in Alert, Fehler-/Blockadefälle bestanden. |
| R13 | Keine neue Lösch-/Stoplogik; vorhandene Bestätigungstests grün, keine produktive Schaltung. |
| R14 | Drei Container sowie historischer abgeschlossener Job im Batch; große Listenleistung nicht profiliert. |
| R15 | Keine neue Ziehaktion. |
| R16 | Echte Keyboard-/Touch-/Overflowprüfung und gelabelter Progress; Screenreader/200/400%Zoom/Kontrast ungeprüft. |
| R17 | Queued/Phasen/Prozent/disabled/failed/completed/blocked/offline getestet. |
| R18 | Neun Zustandsszenarien × beide Karten × sechs Breiten × zwei Themes bestanden. |
| R19 | Keine Browserpermission. |
| R20 | Bestehende sichtbare State-/Signature-Renderlogik, Node-Reuse-/Streamtest; keine WebVitals-Feldmessung. |
| R21 | Keine neuen Präferenzen; Klapp-/Filterkonfiguration erhalten, bestehende Tests grün. |
| R22 | Status/Details/Batch sichtbar; essentielle Queueanzeige ohne Hover/Geste. |
| R23 | Gleiche Komponenten/Logik bei allen sechs Breiten, kein fachlicher Mobile-Sonderweg. |
| R24 | Gesamtprozent = abgearbeitete Ziele inkl. separat genannter Fehler; Zielwerte nie geschätzt. Hostgrenzen oben. |
| R25 | Keine weiteren Editoroptionen oder lange Settingsliste; nur ein zugeordneter Batchbutton. |
| R26 | Deutsche Phasen-/Positions-/Fehlertexte plus Englisch, Image/Compose/Unraid erhalten, Node-Wörterbuchtests. |

Todo #154 bleibt bis unabhängiger Review/koordiniertem Release und
Livebundle-Abgleich offen. Quellen- und Umfangsgrenze: #139 ist damit keine
vollständige Laufzeitabnahme aller übrigen Karten/Hostdialoge.
