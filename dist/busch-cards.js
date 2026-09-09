/**
 * Busch Cards — Lovelace-Karten für Home Assistant.
 *
 * Bewusst ohne Build-Schritt: eine einzelne Datei, reines Vanilla-JS mit
 * Custom Elements. Das Repo liegt auf einer SMB-Share, auf der kein npm läuft
 * — was hier steht, ist genau das, was ausgeliefert wird.
 *
 * Neue Karte hinzufügen: Klasse schreiben, `customElements.define(...)`,
 * Eintrag in `window.customCards` — alles in dieser Datei.
 *
 * Enthält seit 0.4.0 nur noch `busch-schedule-card`. Die Timeline-Karte ist
 * mitsamt dem eingebetteten Leaflet in ein eigenes Repo umgezogen
 * (https://github.com/luukkii123/ha-localtrack-cards), weil sie zur
 * Integration `localtrack` gehört und nichts mit dem Zeitplan-Helfer zu tun
 * hat. Diese Datei lädt deshalb keine Fremdbibliothek mehr.
 */

const CARD_VERSION = "0.9.1";

console.info(
  `%c BUSCH-CARDS %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);


/* ────────────────────────────────────────────────────────────────────────────
 * Sprache und Wörterbücher — gemeinsam für alle drei Karten
 *
 * `docs/ui-regeln.md`, Regel 3: jede Karte hat EIN Wörterbuch mit beiden
 * Sprachen für Labels, Helper, Knöpfe, Fehlermeldungen und Leerzustände. Kein
 * nutzersichtbarer Text steht außerhalb davon.
 *
 * Welche Sprache gilt, entscheidet `hass.locale.language`. Der Eintrag im
 * Kartenwähler (`window.customCards`) entsteht aber beim Laden der Datei —
 * da gibt es noch keinen `hass`. Dort entscheidet `navigator.language`.
 * ──────────────────────────────────────────────────────────────────────── */

/** `de` oder `en` — mehr Sprachen hat diese Datei nicht. */
function buschSprache(hass) {
  let sprache = "";
  if (hass && hass.locale && hass.locale.language) sprache = hass.locale.language;
  else if (hass && hass.language) sprache = hass.language;
  else if (typeof navigator !== "undefined" && navigator.language) sprache = navigator.language;
  return String(sprache).toLowerCase().indexOf("de") === 0 ? "de" : "en";
}

/** Der Sprachabschnitt eines Wörterbuchs. Ohne `hass`: der Kartenwähler-Fall. */
function buschTexte(tabelle, hass) {
  return tabelle[buschSprache(hass)] || tabelle.en;
}

/**
 * Ein `ha-form`-Schema mit übersetzten Auswahl-Beschriftungen.
 *
 * Die Schemakonstanten stehen bewusst als reines Objektliteral in der Datei —
 * `scripts/ui-regeln-pruefen.py` liest sie so. Übersetzbarer Text darf darin
 * also nicht stehen. Die Beschriftung einer Auswahloption kommt deshalb aus
 * `texte.texte["<feld>_<wert>"]`; fehlt sie, bleibt die Vorgabe des Schemas
 * stehen (bei der Landkarte sind das Eigennamen wie „OpenStreetMap", die in
 * beiden Sprachen gleich heißen).
 */
function buschSchemaMitTexten(schema, texte) {
  return schema.map((eintrag) => {
    const kopie = { ...eintrag };
    if (Array.isArray(eintrag.schema)) {
      kopie.schema = buschSchemaMitTexten(eintrag.schema, texte);
    }
    const auswahl = eintrag.selector && eintrag.selector.select;
    if (auswahl && Array.isArray(auswahl.options)) {
      kopie.selector = {
        ...eintrag.selector,
        select: {
          ...auswahl,
          options: auswahl.options.map((option) => ({
            ...option,
            label:
              (texte.texte && texte.texte[`${eintrag.name}_${option.value}`]) ||
              option.label ||
              option.value,
          })),
        },
      };
    }
    return kopie;
  });
}

/** Platzhalter `{name}` in einem Text ersetzen. */
function buschFuellen(text, werte) {
  let aus = String(text);
  for (const name of Object.keys(werte || {})) {
    aus = aus.split(`{${name}}`).join(String(werte[name]));
  }
  return aus;
}


/* ────────────────────────────────────────────────────────────────────────────
 * busch-schedule-card — Zeitplan-Helfer (`schedule.*`) direkt im Dashboard
 *
 * Der Datenvertrag stammt aus homeassistant/components/schedule/__init__.py
 * (gelesen an 2026.8.2, gegengeprüft an einer laufenden Installation):
 *
 *   - Ein Eintrag je Wochentag: `{ from: "HH:MM:SS", to: "HH:MM:SS", data? }`
 *   - `from` < `to`, strikt. Gleiche Zeiten sind ungültig.
 *   - Blöcke dürfen sich **berühren** (`vorheriges_to == from`), aber nicht
 *     überlappen. Die Prüfung lautet `previous_to > from`.
 *   - `to` darf `24:00:00` sein (wird intern zu `time.max`); `from` nicht.
 *   - `schedule/update` **ersetzt den ganzen Datensatz**. Was nicht mitkommt,
 *     ist weg — nachgewiesen: ein Update ohne `icon` liefert den Eintrag ohne
 *     Icon zurück. Deshalb gehen Name, Icon, alle sieben Tage und ein etwaiges
 *     `data` je Block bei jedem Speichern mit.
 * ──────────────────────────────────────────────────────────────────────────── */

const SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const MINUTES_PER_DAY = 1440;

const SCHEMA_BUSCH_SCHEDULE_CARD = [
  { name: "entity", required: true, selector: { entity: { filter: { domain: "schedule" } } } },
  { name: "title", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
  {
    name: "first_day",
    selector: {
      select: {
        mode: "dropdown",
        options: [{ value: "auto" }, { value: "monday" }, { value: "sunday" }],
      },
    },
  },
  {
    name: "step",
    selector: { number: { min: 5, max: 60, step: 5, mode: "slider", unit_of_measurement: "min" } },
  },
];

const TEXTE_BUSCH_SCHEDULE_CARD = {
  de: {
    name: "Busch Zeitplan",
    description: "Zeitplan-Helfer im Dashboard bearbeiten — ziehen, tippen, kopieren.",
    labels: {
      entity: "Zeitplan",
      title: "Titel",
      icon: "Symbol",
      first_day: "Woche beginnt am",
      step: "Raster beim Ziehen",
    },
    helpers: {
      entity: "Der schedule-Helfer, dessen Blöcke die Karte zeigt und schreibt. Pflichtfeld, ohne ihn bleibt die Karte leer.",
      title: "Überschrift der Karte. Vorgabe: der Name des Helfers.",
      icon: "Ein mdi-Symbol links neben der Überschrift. Vorgabe: das Symbol des Helfers, sonst mdi:calendar-clock.",
      first_day: "Welcher Wochentag in der obersten Zeile steht. Vorgabe: wie in Home Assistant.",
      step: "Minuten, auf die Ziehen und Größenändern einrasten. Vorgabe 15.",
    },
    texte: {
      first_day_auto: "Wie in Home Assistant",
      first_day_monday: "Montag",
      first_day_sunday: "Sonntag",
      laden: "Lade …",
      speichernLaeuft: "Speichere …",
      nichtGefunden: "Zeitplan zu {entity} nicht gefunden. In YAML festgelegte Zeitpläne lassen sich nicht über die Oberfläche ändern.",
      nichtGespeichert: "Zeitplan nicht gespeichert: {grund}",
      entitaetFehlt: "Entität nicht gefunden",
      ein: "Ein",
      aus: "Aus",
      bis: "bis",
      ab: "ab",
      hinweisNurLesen: "In YAML festgelegt — hier nur zum Ansehen.",
      hinweisZiehen: "Ziehen legt einen Block an, Tippen öffnet ihn.",
      von: "Von",
      dialogBis: "Bis",
      mitternacht: "Bis <b>00:00</b> bedeutet Mitternacht am Tagesende.",
      fehlerBeideZeiten: "Bitte beide Zeiten angeben.",
      fehlerReihenfolge: "Die Startzeit muss vor der Endzeit liegen.",
      fehlerUeberschneidung: "Der Zeitraum überschneidet sich mit einem anderen Block.",
      schliessen: "Schließen",
      abbrechen: "Abbrechen",
      speichern: "Speichern",
      loeschen: "Löschen",
      blockLoeschen: "Block löschen",
      kopierenAlle: "Auf alle Tage kopieren",
      kopierenWerktage: "Auf Montag bis Freitag kopieren",
      kopierenWochenende: "Auf Samstag und Sonntag kopieren",
      tagLeeren: "Alle Blöcke dieses Tages löschen",
    },
  },
  en: {
    name: "Busch schedule",
    description: "Edit a schedule helper right on the dashboard — drag, tap, copy.",
    labels: {
      entity: "Schedule",
      title: "Title",
      icon: "Icon",
      first_day: "Week starts on",
      step: "Drag step",
    },
    helpers: {
      entity: "The schedule helper whose blocks this card shows and writes. Required; without it the card stays empty.",
      title: "Heading of the card. Default: the name of the helper.",
      icon: "An mdi icon left of the heading. Default: the icon of the helper, otherwise mdi:calendar-clock.",
      first_day: "Which weekday sits in the top row. Default: as in Home Assistant.",
      step: "Minutes that dragging and resizing snap to. Default 15.",
    },
    texte: {
      first_day_auto: "As in Home Assistant",
      first_day_monday: "Monday",
      first_day_sunday: "Sunday",
      laden: "Loading …",
      speichernLaeuft: "Saving …",
      nichtGefunden: "No schedule found for {entity}. Schedules defined in YAML cannot be changed from the interface.",
      nichtGespeichert: "Schedule not saved: {grund}",
      entitaetFehlt: "Entity not found",
      ein: "On",
      aus: "Off",
      bis: "until",
      ab: "from",
      hinweisNurLesen: "Defined in YAML — read only here.",
      hinweisZiehen: "Drag to add a block, tap to open it.",
      von: "From",
      dialogBis: "To",
      mitternacht: "A <b>00:00</b> end means midnight at the end of the day.",
      fehlerBeideZeiten: "Please enter both times.",
      fehlerReihenfolge: "The start time must be before the end time.",
      fehlerUeberschneidung: "This range overlaps another block.",
      schliessen: "Close",
      abbrechen: "Cancel",
      speichern: "Save",
      loeschen: "Delete",
      blockLoeschen: "Delete block",
      kopierenAlle: "Copy to every day",
      kopierenWerktage: "Copy to Monday through Friday",
      kopierenWochenende: "Copy to Saturday and Sunday",
      tagLeeren: "Delete every block of this day",
    },
  },
};

/** "HH:MM:SS" → Minuten seit Mitternacht. "24:00:00" → 1440. */
function parseScheduleTime(value) {
  const parts = String(value ?? "").split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_PER_DAY, hours * 60 + minutes);
}

/** Minuten → "HH:MM:SS" für die API. 1440 muss "24:00:00" sein. */
function formatScheduleTime(minutes) {
  const total = Math.round(minutes);
  if (total >= MINUTES_PER_DAY) return "24:00:00";
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

/** Minuten → "HH:MM" für die Anzeige. 1440 wird bewusst "24:00". */
function formatClock(minutes) {
  const total = Math.round(minutes);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Minuten → "HH:MM" für <input type="time">. Mitternacht ist dort 00:00. */
function toInputTime(minutes) {
  return formatClock(Math.round(minutes) % MINUTES_PER_DAY);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Freier Bereich um `index` herum. Nachbarn dürfen berührt werden, deshalb
 * sind deren Kanten inklusive Grenzen — genau wie `valid_schedule` es prüft.
 */
function freeRange(blocks, index) {
  const before = blocks[index - 1];
  const after = blocks[index + 1];
  return {
    min: before ? before.end : 0,
    max: after ? after.start : MINUTES_PER_DAY,
  };
}

/** Freie Lücke, die `minute` enthält. Ohne Lücke: null. */
function gapAt(blocks, minute) {
  let min = 0;
  for (const block of blocks) {
    if (block.start > minute) return { min, max: block.start };
    if (minute < block.end) return null; // liegt in einem Block
    min = block.end;
  }
  return min >= MINUTES_PER_DAY ? null : { min, max: MINUTES_PER_DAY };
}

class BuschScheduleCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-schedule-card-editor");
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((id) => id.startsWith("schedule."));
    return { type: "custom:busch-schedule-card", entity: entity || "" };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._model = null; // { monday: [{start, end, data}], ... }
    this._item = null; // Rohdatensatz aus schedule/list
    this._scheduleId = null;
    this._loading = false;
    this._error = null;
    this._drag = null;
    this._onVisibility = () => {
      if (document.visibilityState === "visible") this._load(true);
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("busch-schedule-card: 'entity' fehlt");
    }
    if (!String(config.entity).startsWith("schedule.")) {
      throw new Error("busch-schedule-card: 'entity' muss ein schedule.* sein");
    }
    const step = Number(config.step);
    this._config = {
      first_day: "auto",
      ...config,
      step: Number.isFinite(step) && step >= 1 ? Math.min(60, step) : 15,
    };
    this._scheduleId = null;
    this._item = null;
    this._model = null;
    this._build();
    if (this._hass) this._load(true);
  }

  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!previous || buschSprache(previous) !== buschSprache(hass)) {
      // Beim Aufbau gab es noch keinen `hass` und damit keine Sprache. Die
      // festen Texte im Aufbau werden deshalb hier nachgezogen.
      this._renderTexte();
    }
    if (!previous) {
      this._load(true);
      return;
    }
    // Ein neues State-Objekt heißt: Zustand oder Attribute haben sich geändert.
    // Beim Zeitplan ändert sich dabei praktisch immer `next_event`.
    const before = previous.states?.[this._config.entity];
    const now = hass.states?.[this._config.entity];
    if (before !== now && !this._drag && !this._saving) this._load(false);
    this._renderHeader();
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this._onVisibility);
    if (this._hass && this._config && !this._model) this._load(true);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisibility);
    // Ein Dialog, dessen Karte aus dem Dokument fliegt, darf keinen
    // popstate-Lauscher zurücklassen — der hielte die Karte am Leben und
    // reagierte auf jede spätere Navigation.
    for (const dialog of [this._els?.blockDialog, this._els?.dayDialog]) {
      if (dialog && dialog._buschPop) {
        window.removeEventListener("popstate", dialog._buschPop);
        dialog._buschPop = null;
      }
    }
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: 6, min_columns: 6, min_rows: 5 };
  }

  /** Der Textabschnitt der geltenden Sprache. */
  get _texte() {
    return buschTexte(TEXTE_BUSCH_SCHEDULE_CARD, this._hass).texte;
  }

  get _readonly() {
    const state = this._hass?.states?.[this._config.entity];
    // `editable: false` heißt: in YAML definiert, die Storage-API greift nicht.
    return state?.attributes?.editable === false;
  }

  _orderedDays() {
    let first = this._config.first_day || "auto";
    if (first === "auto") {
      const locale = this._hass?.locale?.first_weekday;
      first = SCHEDULE_DAYS.includes(locale) ? locale : "monday";
    }
    const start = Math.max(0, SCHEDULE_DAYS.indexOf(first));
    return SCHEDULE_DAYS.slice(start).concat(SCHEDULE_DAYS.slice(0, start));
  }

  _dayLabels() {
    const language = this._hass?.locale?.language || navigator.language || "de";
    let short;
    let long;
    try {
      short = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" });
      long = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" });
    } catch {
      short = new Intl.DateTimeFormat("de", { weekday: "short", timeZone: "UTC" });
      long = new Intl.DateTimeFormat("de", { weekday: "long", timeZone: "UTC" });
    }
    const labels = {};
    SCHEDULE_DAYS.forEach((day, index) => {
      // 1. Januar 2024 war ein Montag — daher der Versatz.
      const date = new Date(Date.UTC(2024, 0, 1 + index));
      labels[day] = { short: short.format(date), long: long.format(date) };
    });
    return labels;
  }

  /* ── Laden und Speichern ────────────────────────────────────────────── */

  async _load(showSpinner) {
    if (!this._hass || !this._config) return;
    if (this._loading) return;
    this._loading = true;
    if (showSpinner) this._renderStatus(this._texte.laden);
    try {
      if (!this._scheduleId) {
        this._scheduleId = await this._resolveScheduleId();
      }
      const items = await this._hass.callWS({ type: "schedule/list" });
      const item = items.find((entry) => entry.id === this._scheduleId);
      if (!item) {
        throw new Error(
          buschFuellen(this._texte.nichtGefunden, { entity: this._config.entity })
        );
      }
      this._item = item;
      this._model = {};
      for (const day of SCHEDULE_DAYS) {
        this._model[day] = (item[day] || [])
          .map((range) => ({
            start: parseScheduleTime(range.from),
            end: parseScheduleTime(range.to),
            // `data` ist frei belegbar und gehört dem Nutzer — unverändert
            // durchreichen, sonst löscht ein Klick fremde Angaben.
            data: range.data ? { ...range.data } : undefined,
          }))
          .sort((a, b) => a.start - b.start);
      }
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._loading = false;
      this._renderAll();
    }
  }

  /**
   * Die `schedule_id` ist die `unique_id` der Entität. Über die Registry ist
   * das auch nach einer Umbenennung korrekt; der Namensvergleich darunter ist
   * nur der Notnagel für Nutzer ohne Adminrechte.
   */
  async _resolveScheduleId() {
    const entityId = this._config.entity;
    try {
      const entry = await this._hass.callWS({
        type: "config/entity_registry/get",
        entity_id: entityId,
      });
      if (entry?.unique_id) return entry.unique_id;
    } catch {
      /* Registry nicht lesbar — unten weiter. */
    }
    return entityId.slice("schedule.".length);
  }

  async _save() {
    if (!this._hass || !this._item || !this._scheduleId) return;
    const snapshot = JSON.stringify(this._model);
    this._saving = true;
    this._renderStatus(this._texte.speichernLaeuft);

    const payload = {
      type: "schedule/update",
      schedule_id: this._scheduleId,
      name: this._item.name,
    };
    if (this._item.icon) payload.icon = this._item.icon;
    for (const day of SCHEDULE_DAYS) {
      payload[day] = (this._model[day] || [])
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((block) => {
          const range = {
            from: formatScheduleTime(block.start),
            to: formatScheduleTime(block.end),
          };
          if (block.data && Object.keys(block.data).length) range.data = block.data;
          return range;
        });
    }

    try {
      await this._hass.callWS(payload);
      for (const day of SCHEDULE_DAYS) {
        this._item[day] = payload[day];
      }
      this._error = null;
      this._renderStatus("");
    } catch (err) {
      // Zurück auf den letzten bestätigten Stand — ein halb gespeicherter
      // Zeitplan wäre schlimmer als gar keine Änderung.
      this._model = JSON.parse(snapshot);
      this._error = err?.message || String(err);
      this._notify(buschFuellen(this._texte.nichtGespeichert, { grund: this._error }));
      this._renderAll();
    } finally {
      this._saving = false;
    }
  }

  _notify(message) {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        detail: { message },
        bubbles: true,
        composed: true,
      })
    );
  }

  /* ── Aufbau ─────────────────────────────────────────────────────────── */

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        /* Der Container haengt am Host, nicht an ha-card: ha-card bringt sein
           display:block aus dem eigenen Shadow DOM mit, und an einem inline
           dargestellten Element bliebe container-type wirkungslos. */
        :host {
          display: block;
          container-type: inline-size;
          /* --label-col ist ein reines Innenmass der Karte und wird deshalb
             hier festgelegt.

             Die beiden FARBEN stehen bewusst NICHT hier. Sie sind
             dokumentierte Theme-Haken: der Nutzer setzt sie in seinem Theme,
             und HA schreibt sie ans Wurzelelement. Von dort kommen sie durch
             Vererbung an. Eine Vererbung verliert aber gegen jede Regel, die
             das Element selbst trifft — eine Zeile
             --busch-schedule-color: ... an dieser Stelle wuerde die
             Themeangabe also totlegen. In Chromium nachgemessen: mit der
             :host-Zeile wirkte ein Theme am <html> nicht mehr.

             Stattdessen steht der Vorgabewert an der VERWENDUNGSSTELLE als
             var()-Rueckfall, und der Rueckfall ist eine HA-Variable, keine
             Hex-Farbe. Regel 4 ist damit erfuellt, und der Haken bleibt
             erhalten. Das Pruefskript kennt beide Namen in seiner Liste
             THEME_HAKEN. */
          --label-col: 40px;
        }
        ha-card {
          display: block;
          padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px) var(--ha-space-4, 16px);
        }
        .head {
          display: flex;
          align-items: center;
          gap: var(--ha-space-3, 12px);
          padding-bottom: var(--ha-space-3, 12px);
        }
        .head ha-icon {
          color: var(--state-icon-color, var(--paper-item-icon-color));
          flex: 0 0 auto;
        }
        .head.on ha-icon { color: var(--state-active-color, var(--primary-color)); }
        .head .text { flex: 1 1 auto; min-width: 0; }
        .head .name {
          font-size: var(--ha-card-header-font-size, 20px);
          line-height: 1.2;
          color: var(--ha-card-header-color, var(--primary-text-color));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .head .sub {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .head .status {
          flex: 0 1 auto;
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .ruler {
          display: grid;
          grid-template-columns: var(--label-col, 40px) 1fr;
          align-items: end;
          gap: 0 8px;
          height: 16px;
          margin-bottom: 2px;
        }
        /* overflow: hidden ist Pflicht, weil die Beschriftungen darin
           ABSOLUT sitzen (Regel 1): der Container muss schneiden können, und
           sein Maß darf nicht vom Text abhängen — es kommt aus dem Raster
           (1fr) und der Höhe des Lineals. */
        .ruler .scale { position: relative; height: 100%; overflow: hidden; min-width: 0; }
        .ruler span {
          position: absolute;
          font-size: 10px;
          line-height: 1;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
          transform: translateX(-50%);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .ruler span[data-edge="start"] { transform: none; }
        .ruler span[data-edge="end"] { transform: translateX(-100%); }
        /* Bei schmaler Karte nur alle 6 Stunden beschriften. */
        @container (max-width: 460px) {
          .ruler span[data-minor="1"] { display: none; }
        }

        .day {
          display: grid;
          grid-template-columns: var(--label-col, 40px) 1fr;
          align-items: center;
          gap: 0 8px;
          margin-bottom: 4px;
        }
        .day .label {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .day.today .label {
          color: var(--primary-text-color);
          font-weight: var(--ha-font-weight-medium, 500);
        }

        .track {
          position: relative;
          height: 30px;
          border-radius: 6px;
          background-color: var(--busch-schedule-track-color, var(--divider-color));
          background-image: linear-gradient(
            to right,
            var(--card-background-color) 0 1px,
            transparent 1px
          );
          background-size: calc(100% / 8) 100%;
          overflow: hidden;
          cursor: crosshair;
          /* Waagrecht gehört uns, senkrecht bleibt das Scrollen der Seite. */
          touch-action: pan-y;
          user-select: none;
          -webkit-user-select: none;
        }
        @container (max-width: 460px) {
          .track { height: 36px; }
        }
        .track:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .readonly .track { cursor: default; }

        .block {
          position: absolute;
          top: 0;
          bottom: 0;
          background: var(--busch-schedule-color, var(--primary-color));
          border-radius: 5px;
          color: var(--text-primary-color, #fff);
          font-size: 11px;
          line-height: 30px;
          text-align: center;
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          cursor: grab;
          box-sizing: border-box;
          /* Eigener Container je Block: nur so lässt sich die Beschriftung an
             der echten Pixelbreite ausrichten. Ein Prozentwert sagt nichts
             darüber, ob der Text hineinpasst — die Karte kann jede Breite
             haben. */
          container-type: inline-size;
        }
        @container (max-width: 460px) { .block { line-height: 36px; } }
        /* Drei Stufen, gemessen an der echten Blockbreite: gar nichts, nur die
           Startzeit, oder die volle Spanne. Ein 3-Stunden-Block ist auf einer
           normal breiten Karte nur rund 50 px breit — "01:00-04:00" passt dort
           nicht, "01:00" schon. */
        .block .cap-short, .block .cap-full { display: none; }
        @container (min-width: 44px) { .block .cap-short { display: inline; } }
        @container (min-width: 88px) {
          .block .cap-short { display: none; }
          .block .cap-full { display: inline; }
        }
        .block.dragging { cursor: grabbing; opacity: 0.9; }
        .readonly .block { cursor: default; }

        .handle {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 10px;
          cursor: ew-resize;
        }
        .handle.start { left: 0; }
        .handle.end { right: 0; }
        .handle::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 12px;
          border-radius: 1px;
          background: var(--text-primary-color, #fff);
          opacity: 0.55;
        }
        .readonly .handle { display: none; }

        .foot {
          display: flex;
          align-items: center;
          gap: var(--ha-space-2, 8px);
          margin-top: 10px;
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
        }
        .foot .hint { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
        .foot .err { color: var(--error-color, #db4437); }

        /* ── Dialoge ──────────────────────────────────────────────────────
           Anatomie nach docs/ui-regeln.md, Regel 2: Titel, Schließen-X oben
           links, Aktionsknöpfe unten rechts, Breite höchstens 560 px,
           Vollbild unter 450 px Breite oder 500 px Höhe.

           Der Stapelkontext braucht kein z-index: ein natives <dialog> im
           showModal-Zustand steht in der Top-Layer und liegt damit über
           JEDER Leaflet-Ebene, auch über deren 1000er Bedienelementen. */
        dialog {
          border: none;
          border-radius: var(--ha-card-border-radius, 12px);
          padding: 0;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          max-width: min(92vw, 380px);
          width: 100%;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }
        dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
        @media (max-width: 450px), (max-height: 500px) {
          dialog {
            max-width: 100%;
            width: 100%;
            height: 100%;
            max-height: 100%;
            border-radius: 0;
          }
          /* Am Handy stehen die Aktionsknoepfe unten fest (Regel 2). Das
             erledigt der Spaltenfluss allein: .dlg ist so hoch wie der
             Dialog, .body nimmt den ganzen Rest, .actions bleibt darunter.
             KEIN position: sticky — es waere hier wirkungslos (nur .body
             rollt) und Chromium liess bei jedem Groessenwechsel eine zweite,
             veraltete Fassung der Knopfzeile im Bild stehen. Gemessen: im DOM
             genau EIN .actions bei y=1152, im Bild zwei. */
          .dlg { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
          .dlg .body { flex: 1 1 auto; overflow: auto; min-height: 0; }
        }
        /* Wackeln statt Schließen: die HA-Ausnahme für ein Formular mit
           ungespeicherten Änderungen (Regel 2). Nur der Blockdialog ist ein
           Formular; die Tagesansicht ist keins und schließt immer. */
        @keyframes busch-schedule-wackeln {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        dialog.wackelt { animation: busch-schedule-wackeln 0.25s ease-in-out; }
        .dlg { padding: var(--ha-space-4, 16px); }
        .dlg-kopf {
          display: flex;
          align-items: center;
          gap: var(--ha-space-2, 8px);
          margin-bottom: var(--ha-space-4, 16px);
        }
        .dlg h2 {
          flex: 1 1 auto;
          margin: 0;
          font-size: 18px;
          font-weight: var(--ha-font-weight-normal, 400);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .dlg-kopf button {
          flex: 0 0 auto;
          font: inherit;
          border: none;
          background: none;
          color: var(--secondary-text-color);
          width: 40px;
          height: 40px;
          line-height: 1;
          border-radius: 50%;
          cursor: pointer;
        }
        .dlg-kopf button:hover { background: var(--divider-color); }
        .dlg-kopf button.danger { color: var(--error-color, #db4437); }
        .fields { display: flex; gap: var(--ha-space-3, 12px); }
        .fields label {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .fields input {
          font: inherit;
          font-size: var(--ha-font-size-l, 16px); /* unter 16px zoomt iOS beim Fokus hinein */
          padding: var(--ha-space-2, 8px) 10px;
          border-radius: 6px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          color-scheme: light dark;
          min-width: 0;
        }
        .fields input:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: -1px;
        }
        .dlg .note {
          margin-top: var(--ha-space-2, 8px);
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          overflow-wrap: anywhere;
        }
        .dlg .msg {
          margin-top: var(--ha-space-3, 12px);
          font-size: 13px;
          color: var(--error-color, #db4437);
          overflow-wrap: anywhere;
        }
        .dlg .msg:empty { display: none; }
        .actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--ha-space-2, 8px);
          margin: 20px 0 0;
          padding: 0;
        }
        .actions button {
          font: inherit;
          font-size: var(--ha-font-size-m, 14px);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: none;
          background: none;
          color: var(--primary-color);
          padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .actions button:hover { background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
        .actions button.danger { color: var(--error-color, #db4437); }
        .actions button.danger:hover { background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }

        .choices { display: flex; flex-direction: column; }
        .choices button {
          font: inherit;
          font-size: var(--ha-font-size-m, 14px);
          text-align: left;
          border: none;
          background: none;
          color: var(--primary-text-color);
          padding: var(--ha-space-3, 12px) var(--ha-space-2, 8px);
          border-radius: 6px;
          cursor: pointer;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .choices button:hover { background: var(--divider-color); }
        .choices button.danger { color: var(--error-color, #db4437); }
      </style>

      <ha-card>
        <div class="head">
          <ha-icon></ha-icon>
          <div class="text">
            <div class="name"></div>
            <div class="sub"></div>
          </div>
          <div class="status"></div>
        </div>
        <div class="ruler"><div class="spacer"></div><div class="scale"></div></div>
        <div class="days"></div>
        <div class="foot">
          <div class="hint"></div>
        </div>
      </ha-card>

      <dialog class="block-dialog">
        <div class="dlg">
          <div class="dlg-kopf">
            <button class="dlg-x" data-act="cancel"><ha-icon icon="mdi:close"></ha-icon></button>
            <h2></h2>
            <button class="danger dlg-del" data-act="delete"><ha-icon icon="mdi:delete"></ha-icon></button>
          </div>
          <div class="body">
            <div class="fields">
              <label><span class="l-from"></span> <input type="time" class="f-from"></label>
              <label><span class="l-to"></span> <input type="time" class="f-to"></label>
            </div>
            <div class="note"></div>
            <div class="msg"></div>
          </div>
          <menu class="actions">
            <button data-act="cancel"></button>
            <button data-act="ok"></button>
          </menu>
        </div>
      </dialog>

      <dialog class="day-dialog">
        <div class="dlg">
          <div class="dlg-kopf">
            <button class="dlg-x" data-act="cancel"><ha-icon icon="mdi:close"></ha-icon></button>
            <h2></h2>
          </div>
          <div class="body">
            <div class="choices">
              <button data-act="all"></button>
              <button data-act="weekdays"></button>
              <button data-act="weekend"></button>
              <button data-act="clear" class="danger"></button>
            </div>
          </div>
          <menu class="actions">
            <button data-act="cancel"></button>
          </menu>
        </div>
      </dialog>
    `;

    this._els = {
      card: this.shadowRoot.querySelector("ha-card"),
      head: this.shadowRoot.querySelector(".head"),
      icon: this.shadowRoot.querySelector(".head ha-icon"),
      name: this.shadowRoot.querySelector(".head .name"),
      sub: this.shadowRoot.querySelector(".head .sub"),
      status: this.shadowRoot.querySelector(".head .status"),
      scale: this.shadowRoot.querySelector(".ruler .scale"),
      days: this.shadowRoot.querySelector(".days"),
      hint: this.shadowRoot.querySelector(".foot .hint"),
      blockDialog: this.shadowRoot.querySelector(".block-dialog"),
      dayDialog: this.shadowRoot.querySelector(".day-dialog"),
    };

    this._buildRuler();
    this._renderTexte();
    this._wireDialogs();
  }

  /** Alles Feste im Aufbau, das Text ist — aus dem Wörterbuch, in der
   *  Sprache von `hass.locale.language`. Läuft beim Aufbau und noch einmal,
   *  sobald `hass` da ist: beim Aufbau gibt es ihn noch nicht. */
  _renderTexte() {
    if (!this._els) return;
    const t = this._texte;
    const setze = (sel, wert) => {
      const el = this.shadowRoot.querySelector(sel);
      if (el) el.textContent = wert;
    };
    setze(".block-dialog .l-from", t.von);
    setze(".block-dialog .l-to", t.dialogBis);
    setze(".block-dialog .actions button[data-act='cancel']", t.abbrechen);
    setze(".block-dialog .actions button[data-act='ok']", t.speichern);
    setze(".day-dialog .actions button[data-act='cancel']", t.abbrechen);
    setze(".day-dialog .choices button[data-act='all']", t.kopierenAlle);
    setze(".day-dialog .choices button[data-act='weekdays']", t.kopierenWerktage);
    setze(".day-dialog .choices button[data-act='weekend']", t.kopierenWochenende);
    setze(".day-dialog .choices button[data-act='clear']", t.tagLeeren);
    // Der Hinweis unter den Zeitfeldern enthält ein <b>; er ist der einzige
    // Text der Karte mit Auszeichnung und der einzige Grund für innerHTML.
    // Die Quelle ist das eigene Wörterbuch, nie Nutzereingabe.
    const note = this.shadowRoot.querySelector(".block-dialog .note");
    if (note) note.innerHTML = t.mitternacht;
    for (const [sel, titel] of [
      [".block-dialog .dlg-x", t.schliessen],
      [".day-dialog .dlg-x", t.schliessen],
      [".block-dialog .dlg-del", t.blockLoeschen],
    ]) {
      const el = this.shadowRoot.querySelector(sel);
      if (!el) continue;
      el.setAttribute("title", titel);
      el.setAttribute("aria-label", titel);
    }
  }

  _buildRuler() {
    const marks = [];
    for (let hour = 0; hour <= 24; hour += 3) {
      const edge = hour === 0 ? "start" : hour === 24 ? "end" : "";
      const minor = hour % 6 === 0 ? "0" : "1";
      marks.push(
        `<span style="left:${(hour / 24) * 100}%" data-edge="${edge}" data-minor="${minor}">${hour}</span>`
      );
    }
    this._els.scale.innerHTML = marks.join("");
  }

  _wireDialogs() {
    const blockDialog = this._els.blockDialog;
    blockDialog.addEventListener("click", (event) => {
      // Ein Klick NEBEN den Inhalt trifft das <dialog> selbst — das ist der
      // Scrim. Regel 2 verlangt, dass er schließt (beim Formular mit
      // ungespeicherten Änderungen: wackeln statt schließen).
      if (event.target === blockDialog) {
        this._resolveBlockDialog("scrim");
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      this._resolveBlockDialog(button.dataset.act);
    });
    // Escape löst am nativen <dialog> `cancel` aus. Der Vorgabeweg würde den
    // Dialog schließen, ohne den eigenen Verlaufseintrag abzuräumen — deshalb
    // abgefangen und über denselben Weg geführt wie jeder andere Schließer.
    blockDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this._resolveBlockDialog("escape");
    });

    const dayDialog = this._els.dayDialog;
    dayDialog.addEventListener("click", (event) => {
      if (event.target === dayDialog) {
        this._dialogSchliessen(dayDialog);
        this._dayTarget = null;
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      this._dialogSchliessen(dayDialog);
      this._applyDayAction(button.dataset.act);
    });
    dayDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this._dialogSchliessen(dayDialog);
      this._dayTarget = null;
    });
  }

  /* ── Verlauf: Zurück-Taste und Zurück-Geste ──────────────────────────────
   *
   * `docs/ui-regeln.md`, Regel 2: Ein Popup schließt mit der Zurück-Taste,
   * OHNE die Seite zu verlassen. Ein selbstgebautes Überlagerungsfenster tut
   * das nicht von allein — die Zurück-Geste am Handy ist eine
   * Verlaufsnavigation, und ohne eigenen Eintrag verlässt sie das ganze
   * Dashboard. Genau das war der Stand bis hierher.
   *
   * Das Muster ist HAs eigenem Dialog-Manager (`addHistory`) nachgebaut, so
   * wie es in `ha-busch-lightcards` schon steht:
   *
   *   1. Beim Öffnen `history.pushState({ dialog: '<name>' }, '')` — die URL
   *      bleibt unangetastet, sonst wechselte das Dashboard die Ansicht.
   *   2. Ein `popstate`-Listener schließt das Popup, sobald der eigene
   *      Eintrag verschwunden ist.
   *   3. Beim Schließen über Knopf, Scrim oder Escape: liegt der eigene
   *      Eintrag oben, `history.back()`; sonst wird am Verlauf nichts
   *      geändert. So bleibt kein verwaister Eintrag stehen.
   *   4. Der Listener wird beim Schließen wieder entfernt.
   * ────────────────────────────────────────────────────────────────────── */

  /** Kennung des eigenen Verlaufseintrags eines der beiden Dialoge. */
  _dialogName(dialog) {
    return dialog === this._els.dayDialog
      ? "busch-schedule-card:tag"
      : "busch-schedule-card:block";
  }

  _liegtObenauf(dialog) {
    const zustand = typeof history !== "undefined" ? history.state : null;
    return Boolean(zustand && zustand.dialog === this._dialogName(dialog));
  }

  _dialogOeffnen(dialog) {
    if (dialog.open) return;
    dialog.showModal();
    if (typeof history === "undefined") return;
    try {
      history.pushState({ dialog: this._dialogName(dialog) }, "");
    } catch (fehler) {
      // Privater Modus und Ratenbegrenzung können das ablehnen. Escape,
      // Scrim und Schließ-Knopf wirken weiter; nur die Zurück-Geste fehlt.
      return;
    }
    const aufPop = () => {
      window.removeEventListener("popstate", aufPop);
      if (dialog._buschPop === aufPop) dialog._buschPop = null;
      if (dialog.open) dialog.close();
      if (dialog === this._els.blockDialog) this._dialogTarget = null;
      else this._dayTarget = null;
    };
    dialog._buschPop = aufPop;
    window.addEventListener("popstate", aufPop);
  }

  /** Schließt den Dialog und räumt genau den eigenen Verlaufseintrag ab. */
  _dialogSchliessen(dialog) {
    const aufPop = dialog._buschPop;
    if (aufPop && this._liegtObenauf(dialog)) {
      // `history.back()` löst `popstate` aus; der Listener schließt und
      // räumt sich selbst ab. Ein Notnagel für den Fall, dass `popstate`
      // ausbleibt — sonst bliebe der Dialog offen stehen.
      history.back();
      setTimeout(() => {
        if (dialog.open) dialog.close();
      }, 300);
      return;
    }
    if (aufPop) {
      window.removeEventListener("popstate", aufPop);
      dialog._buschPop = null;
    }
    if (dialog.open) dialog.close();
  }

  /** Kurzes Wackeln statt Schließen — die HA-Ausnahme für ein Formular mit
   *  ungespeicherten Änderungen (Regel 2). */
  _wackeln(dialog) {
    dialog.classList.remove("wackelt");
    // Neuzeichnen erzwingen, sonst startet die Animation beim zweiten Mal nicht.
    void dialog.offsetWidth;
    dialog.classList.add("wackelt");
    setTimeout(() => dialog.classList.remove("wackelt"), 300);
  }

  /* ── Zeichnen ───────────────────────────────────────────────────────── */

  _renderAll() {
    this._renderHeader();
    this._renderDays();
    this._renderStatus("");
  }

  _renderStatus(text) {
    if (!this._els) return;
    this._els.status.textContent = text;
    const hint = this._els.hint;
    if (this._error) {
      hint.textContent = this._error;
      hint.classList.add("err");
    } else {
      hint.classList.remove("err");
      hint.textContent = this._readonly
        ? this._texte.hinweisNurLesen
        : this._texte.hinweisZiehen;
    }
  }

  _renderHeader() {
    if (!this._els || !this._hass || !this._config) return;
    const state = this._hass.states[this._config.entity];
    const isOn = state?.state === "on";
    this._els.head.classList.toggle("on", isOn);
    this._els.icon.setAttribute(
      "icon",
      state?.attributes?.icon || this._config.icon || "mdi:calendar-clock"
    );
    this._els.name.textContent =
      this._config.title || state?.attributes?.friendly_name || this._config.entity;

    if (!state) {
      this._els.sub.textContent = this._texte.entitaetFehlt;
      return;
    }
    const parts = [isOn ? this._texte.ein : this._texte.aus];
    const next = state.attributes?.next_event;
    if (next) {
      const date = new Date(next);
      if (!Number.isNaN(date.getTime())) {
        const time = this._hass.formatEntityAttributeValue
          ? this._hass.formatEntityAttributeValue(state, "next_event")
          : date.toLocaleString(this._hass.locale?.language || "de");
        parts.push(`${isOn ? this._texte.bis : this._texte.ab} ${time}`);
      }
    }
    this._els.sub.textContent = parts.join(" · ");
  }

  _renderDays() {
    if (!this._els) return;
    const container = this._els.days;
    if (!this._model) {
      container.innerHTML = "";
      return;
    }

    this._els.card.classList.toggle("readonly", this._readonly);
    const labels = this._dayLabels();
    const todayIndex = (new Date().getDay() + 6) % 7; // JS: Sonntag = 0
    const today = SCHEDULE_DAYS[todayIndex];

    container.innerHTML = this._orderedDays()
      .map((day) => {
        const blocks = this._model[day] || [];
        const bars = blocks
          .map((block, index) => {
            const left = (block.start / MINUTES_PER_DAY) * 100;
            const width = ((block.end - block.start) / MINUTES_PER_DAY) * 100;
            const text = `${formatClock(block.start)}–${formatClock(block.end)}`;
            // Ob die Beschriftung passt, entscheidet die Container-Query oben.
            return `<div class="block" data-day="${day}" data-index="${index}"
                       style="left:${left}%;width:${width}%"
                       tabindex="0" role="button" title="${text}">
                      <span class="handle start"></span><span class="cap-short">${formatClock(block.start)}</span><span class="cap-full">${text}</span><span class="handle end"></span>
                    </div>`;
          })
          .join("");
        return `
          <div class="day${day === today ? " today" : ""}" data-day="${day}">
            <div class="label" title="${labels[day].long}">${labels[day].short}</div>
            <div class="track" data-day="${day}" tabindex="0" role="group"
                 aria-label="${labels[day].long}">${bars}</div>
          </div>`;
      })
      .join("");

    if (this._readonly) return;
    for (const track of container.querySelectorAll(".track")) {
      track.addEventListener("pointerdown", (event) => this._onPointerDown(event));
    }
    for (const label of container.querySelectorAll(".label")) {
      label.addEventListener("click", () =>
        this._openDayDialog(label.parentElement.dataset.day)
      );
      label.style.cursor = "pointer";
    }
    for (const block of container.querySelectorAll(".block")) {
      block.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._openBlockDialog(block.dataset.day, Number(block.dataset.index));
        }
      });
    }
  }

  /* ── Ziehen, Größe ändern, Anlegen ──────────────────────────────────── */

  _minuteAt(clientX, rect) {
    const ratio = (clientX - rect.left) / rect.width;
    return clamp(ratio * MINUTES_PER_DAY, 0, MINUTES_PER_DAY);
  }

  _snap(minute) {
    const step = this._config.step || 15;
    return clamp(Math.round(minute / step) * step, 0, MINUTES_PER_DAY);
  }

  _onPointerDown(event) {
    if (this._readonly || !this._model) return;
    if (event.button !== undefined && event.button !== 0) return;

    const track = event.currentTarget;
    const day = track.dataset.day;
    const blocks = this._model[day];
    const rect = track.getBoundingClientRect();
    const minute = this._minuteAt(event.clientX, rect);

    const blockEl = event.target.closest(".block");
    let drag;

    if (blockEl) {
      const index = Number(blockEl.dataset.index);
      const handle = event.target.closest(".handle");
      const mode = handle ? (handle.classList.contains("start") ? "start" : "end") : "move";
      drag = {
        mode,
        day,
        index,
        rect,
        track,
        element: blockEl,
        origin: minute,
        startedAt: { ...blocks[index] },
        moved: false,
      };
    } else {
      const gap = gapAt(blocks, minute);
      if (!gap) return;
      const anchor = clamp(this._snap(minute), gap.min, gap.max);
      drag = {
        mode: "create",
        day,
        index: -1,
        rect,
        track,
        element: null,
        origin: minute,
        anchor,
        gap,
        moved: false,
      };
    }

    this._drag = drag;
    track.setPointerCapture(event.pointerId);
    const onMove = (moveEvent) => this._onPointerMove(moveEvent);
    const onUp = (upEvent) => {
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
      try {
        track.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* Zeiger war schon frei. */
      }
      this._onPointerUp(upEvent);
    };
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;
    const minute = this._minuteAt(event.clientX, drag.rect);
    const pixels = Math.abs(minute - drag.origin) * (drag.rect.width / MINUTES_PER_DAY);
    if (!drag.moved && pixels < 4) return;
    drag.moved = true;
    event.preventDefault();

    const blocks = this._model[drag.day];

    if (drag.mode === "create") {
      if (!drag.element) {
        const element = document.createElement("div");
        element.className = "block dragging";
        drag.track.appendChild(element);
        drag.element = element;
      }
      const other = clamp(this._snap(minute), drag.gap.min, drag.gap.max);
      const start = Math.min(drag.anchor, other);
      const end = Math.max(drag.anchor, other);
      drag.preview = { start, end };
      this._paint(drag.element, start, end);
      return;
    }

    const { min, max } = freeRange(blocks, drag.index);
    const base = drag.startedAt;
    const step = this._config.step || 15;
    let start = base.start;
    let end = base.end;

    if (drag.mode === "move") {
      const length = base.end - base.start;
      const delta = this._snap(minute) - this._snap(drag.origin);
      start = clamp(base.start + delta, min, max - length);
      end = start + length;
    } else if (drag.mode === "start") {
      start = clamp(this._snap(minute), min, base.end - step);
      end = base.end;
    } else {
      start = base.start;
      end = clamp(this._snap(minute), base.start + step, max);
    }

    drag.preview = { start, end };
    drag.element.classList.add("dragging");
    this._paint(drag.element, start, end);
  }

  _paint(element, start, end) {
    element.style.left = `${(start / MINUTES_PER_DAY) * 100}%`;
    element.style.width = `${((end - start) / MINUTES_PER_DAY) * 100}%`;
  }

  _onPointerUp() {
    const drag = this._drag;
    this._drag = null;
    if (!drag) return;

    const blocks = this._model[drag.day];

    // Kein Zug: ein Tippen. Auf einem Block öffnet das den Dialog, auf freier
    // Fläche entsteht ein Block in Standardlänge.
    if (!drag.moved) {
      if (drag.mode === "create") {
        const step = this._config.step || 15;
        const length = Math.max(step, 60);
        const gap = drag.gap;
        let start = clamp(drag.anchor, gap.min, Math.max(gap.min, gap.max - length));
        let end = Math.min(start + length, gap.max);
        if (end - start < step) {
          start = gap.min;
          end = gap.max;
        }
        if (end - start < step) return;
        blocks.push({ start, end });
        blocks.sort((a, b) => a.start - b.start);
        this._renderDays();
        this._save();
      } else {
        this._openBlockDialog(drag.day, drag.index);
      }
      return;
    }

    if (drag.mode === "create") {
      const preview = drag.preview;
      drag.element?.remove();
      const step = this._config.step || 15;
      if (!preview || preview.end - preview.start < step) {
        this._renderDays();
        return;
      }
      blocks.push({ start: preview.start, end: preview.end });
    } else if (drag.preview) {
      blocks[drag.index] = {
        ...blocks[drag.index],
        start: drag.preview.start,
        end: drag.preview.end,
      };
    }

    blocks.sort((a, b) => a.start - b.start);
    this._renderDays();
    this._save();
  }

  /* ── Dialoge ────────────────────────────────────────────────────────── */

  _openBlockDialog(day, index) {
    const block = this._model?.[day]?.[index];
    if (!block) return;
    const labels = this._dayLabels();
    const dialog = this._els.blockDialog;
    // Das native Zeitfeld formatiert nach Sprache. Ohne diesen Hinweis richtet
    // es sich nach dem Browser und zeigt womöglich AM/PM, während der Rest der
    // Karte 24 Stunden anzeigt.
    dialog.lang = this._hass?.locale?.language || "de";
    dialog.querySelector("h2").textContent = labels[day].long;
    dialog.querySelector(".f-from").value = toInputTime(block.start);
    dialog.querySelector(".f-to").value = toInputTime(block.end);
    dialog.querySelector(".msg").textContent = "";
    // Ausgangsstand für die HA-Ausnahme „Formular mit ungespeicherten
    // Änderungen schließt nicht auf Escape oder Scrim".
    this._dialogStand = this._blockStand();
    this._dialogTarget = { day, index };
    this._dialogOeffnen(dialog);
  }

  /** Was gerade in den beiden Zeitfeldern steht — für den Vergleich mit dem
   *  Stand beim Öffnen. */
  _blockStand() {
    const dialog = this._els.blockDialog;
    return [
      dialog.querySelector(".f-from").value,
      dialog.querySelector(".f-to").value,
    ].join("|");
  }

  /** Hat der Nutzer im Blockdialog etwas geändert, ohne zu speichern? */
  _blockGeaendert() {
    return this._dialogStand !== undefined && this._blockStand() !== this._dialogStand;
  }

  _resolveBlockDialog(action) {
    const dialog = this._els.blockDialog;
    const target = this._dialogTarget;
    if (!target) {
      this._dialogSchliessen(dialog);
      return;
    }

    // Escape und Scrim: die einzige Ausnahme der Spec. Ein Formular mit
    // ungespeicherten Änderungen wackelt, statt sie wegzuwerfen. Der
    // Abbrechen-Knopf und die Zurück-Taste schließen weiterhin — sie sind
    // eine ausdrückliche Ansage, kein Danebentippen.
    if (action === "escape" || action === "scrim") {
      if (this._blockGeaendert()) {
        this._wackeln(dialog);
        return;
      }
      action = "cancel";
    }

    if (action === "cancel") {
      this._dialogSchliessen(dialog);
      this._dialogTarget = null;
      return;
    }

    const blocks = this._model[target.day];

    if (action === "delete") {
      blocks.splice(target.index, 1);
      this._dialogSchliessen(dialog);
      this._dialogTarget = null;
      this._renderDays();
      this._save();
      return;
    }

    const fromValue = dialog.querySelector(".f-from").value;
    const toValue = dialog.querySelector(".f-to").value;
    const message = dialog.querySelector(".msg");
    if (!fromValue || !toValue) {
      message.textContent = this._texte.fehlerBeideZeiten;
      return;
    }

    const start = parseScheduleTime(fromValue);
    // 00:00 als Ende kann nur das Tagesende meinen — from < to ist Pflicht.
    const parsedTo = parseScheduleTime(toValue);
    const end = parsedTo === 0 ? MINUTES_PER_DAY : parsedTo;

    if (start >= end) {
      message.textContent = this._texte.fehlerReihenfolge;
      return;
    }
    const others = blocks.filter((_, index) => index !== target.index);
    if (others.some((block) => start < block.end && end > block.start)) {
      message.textContent = this._texte.fehlerUeberschneidung;
      return;
    }

    blocks[target.index] = { ...blocks[target.index], start, end };
    blocks.sort((a, b) => a.start - b.start);
    this._dialogSchliessen(dialog);
    this._dialogTarget = null;
    this._renderDays();
    this._save();
  }

  _openDayDialog(day) {
    if (this._readonly || !this._model) return;
    const labels = this._dayLabels();
    const dialog = this._els.dayDialog;
    dialog.querySelector("h2").textContent = labels[day].long;
    this._dayTarget = day;
    this._dialogOeffnen(dialog);
  }

  _applyDayAction(action) {
    const day = this._dayTarget;
    this._dayTarget = null;
    if (!day || action === "cancel" || !this._model) return;

    const source = this._model[day] || [];
    const copy = () =>
      source.map((block) => ({ ...block, data: block.data ? { ...block.data } : undefined }));

    if (action === "clear") {
      this._model[day] = [];
    } else {
      let targets = [];
      if (action === "all") targets = SCHEDULE_DAYS;
      else if (action === "weekdays") targets = SCHEDULE_DAYS.slice(0, 5);
      else if (action === "weekend") targets = SCHEDULE_DAYS.slice(5);
      for (const target of targets) {
        if (target !== day) this._model[target] = copy();
      }
    }

    this._renderDays();
    this._save();
  }
}

class BuschScheduleCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { first_day: "auto", step: 15, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      const texte = buschTexte(TEXTE_BUSCH_SCHEDULE_CARD, this._hass);
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_SCHEDULE_CARD, texte);
      this._form.computeLabel = (schema) => texte.labels[schema.name] || schema.name;
      this._form.computeHelper = (schema) => texte.helpers[schema.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: { ...this._config, ...event.detail.value } },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.data = this._config;
  }
}

/* ==========================================================================
 * busch-calendar-card — Terminliste je Kalendermonat
 *
 * Alle Namen auf oberster Ebene beginnen mit `cal`. Diese Datei hat einen
 * flachen Gueltigkeitsbereich: ein zweites `clamp` oder `formatClock` wuerde
 * die Zeitplan-Karte still kaputtmachen.
 * ========================================================================== */

/**
 * Erster und letzter Moment des Zielmonats, in lokaler Zeit.
 * `new Date(jahr, monat + 1, 0)` ist der letzte Tag des Monats davor — das
 * erledigt Monatslaengen und Schaltjahre ohne eigene Tabelle.
 */
function calMonatsGrenzen(basis, versatz) {
  const jahr = basis.getFullYear();
  const monat = basis.getMonth() + (versatz || 0);
  return {
    start: new Date(jahr, monat, 1, 0, 0, 0, 0),
    ende: new Date(jahr, monat + 1, 0, 23, 59, 59, 999),
  };
}

function calMonatsName(datum, locale) {
  return datum.toLocaleDateString(locale || "de-DE", {
    month: "long",
    year: "numeric",
  });
}

function calIstGanztags(termin) {
  return Boolean(termin && termin.start && termin.start.date && !termin.start.dateTime);
}

/**
 * Ein reines Datum wird von Hand zerlegt. `new Date("2026-08-04")` liest die
 * Zeichenkette als UTC-Mitternacht — westlich von Greenwich ergaebe das den
 * 3. August. Der Konstruktor mit Zahlen nimmt lokale Zeit.
 */
function calDatumAusText(text) {
  const teile = String(text).split("-").map(Number);
  return new Date(teile[0], teile[1] - 1, teile[2], 0, 0, 0, 0);
}

function calStartDatum(termin) {
  return calIstGanztags(termin)
    ? calDatumAusText(termin.start.date)
    : new Date(termin.start.dateTime);
}

/**
 * Bei ganztaegigen Terminen ist `end.date` AUSSCHLIESSEND: ein eintaegiger
 * Termin am 4. hat das Ende am 5. Hier wird auf den letzten betroffenen Tag
 * zurueckgerechnet.
 *
 * Fehlt `end` ganz oder traegt es weder `date` noch `dateTime`, faellt der
 * Termin auf seinen eigenen Start zurueck und bekommt damit die Dauer null.
 * Der Rueckfall ist bewusst so gewaehlt und nicht als Auslassen: einen still
 * geschluckten Termin vermisst im Betrieb niemand, eine fehlende Zeitspanne
 * sieht man dagegen sofort. Und ein einzelner kaputter Eintrag darf die
 * uebrige Monatsliste nicht mitreissen — `termin.end.dateTime` warf hier
 * vorher einen TypeError.
 */
function calEndDatum(termin) {
  const ende = termin && termin.end;
  const roher = calIstGanztags(termin)
    ? ende && ende.date
    : ende && ende.dateTime;
  if (!roher) return calStartDatum(termin);
  // Ein vorhandenes, aber unlesbares Datum ("morgen frueh") ist dasselbe wie
  // ein fehlendes: `new Date(...)` liefert dann ein Invalid Date, und jeder
  // Vergleich damit ist false — der Termin faellt still aus der Tagesschleife.
  const roh = calIstGanztags(termin) ? calDatumAusText(roher) : new Date(roher);
  const von = calStartDatum(termin);
  if (Number.isNaN(roh.getTime())) return von;
  const bis = calIstGanztags(termin)
    ? new Date(roh.getFullYear(), roh.getMonth(), roh.getDate() - 1, 23, 59, 59, 999)
    : roh;
  // Ein Ende VOR dem Start ist so unbrauchbar wie ein fehlendes und bekommt
  // deshalb dieselbe Rueckfallregel. Zwei gemessene Faelle laufen hier
  // zusammen:
  //
  //   Ein ganztaegiger Termin mit `end.date` GLEICH `start.date` — die
  //   Rueckrechnung des ausschliessenden Endes landet einen Tag VOR dem
  //   Start. Der Termin fiel aus der Liste, stand aber als „1 ganztaegig"
  //   in der Fusszeile: eine Summe fuer etwas, das auf dem Schirm fehlt.
  //
  //   Ein rueckwaerts laufender Termin — die negative Dauer VERKLEINERTE die
  //   Monatssumme (gemessen: minus vier Stunden am selben Tag, minus
  //   zweiundfuenfzig ueber mehrere Tage), und ueber mehrere Tage verschwand
  //   er zusaetzlich aus der Liste.
  //
  // Mit dem Rueckfall bleibt er sichtbar und hat die Dauer null. Sichtbar und
  // erkennbar falsch ist besser als unsichtbar und heimlich verrechnet.
  if (bis < von) return von;
  return bis;
}

function calTagesSchluessel(datum) {
  const m = String(datum.getMonth() + 1).padStart(2, "0");
  const t = String(datum.getDate()).padStart(2, "0");
  return `${datum.getFullYear()}-${m}-${t}`;
}

/**
 * Ein Eintrag je Tag des Monats, auch fuer Tage ohne Termin.
 * Die Tage werden ueber ihre Nummer erzeugt, nicht durch Hochzaehlen eines
 * Date-Objekts: das bliebe an der Sommerzeitgrenze haengen.
 */
function calGruppiereNachTag(termine, start, ende) {
  const tage = [];
  const nachSchluessel = new Map();
  for (let n = 1; n <= ende.getDate(); n += 1) {
    const datum = new Date(start.getFullYear(), start.getMonth(), n);
    const eintrag = {
      schluessel: calTagesSchluessel(datum),
      datum,
      tagNummer: n,
      wochentag: datum.getDay(),
      istWochenende: datum.getDay() === 0 || datum.getDay() === 6,
      termine: [],
    };
    tage.push(eintrag);
    nachSchluessel.set(eintrag.schluessel, eintrag);
  }

  for (const termin of termine || []) {
    if (!termin || !termin.start) continue;
    const von = calStartDatum(termin);
    // Die einzige Stelle, an der Ueberspringen richtig ist: ohne lesbaren Start
    // gibt es keinen Tag, an dem der Termin stehen koennte. Er wird nicht
    // versteckt, es fehlt schlicht der Ort. Ausdruecklich statt als Nebenwirkung
    // eines NaN-Vergleichs, damit die Absicht im Code steht — und die
    // Monatsliste laeuft weiter, statt am naechsten Termin zu haengen.
    if (Number.isNaN(von.getTime())) continue;
    const bis = calEndDatum(termin);
    // Jeden betroffenen Tag anfassen, damit mehrtaegige Termine ueberall stehen.
    let lauf = new Date(von.getFullYear(), von.getMonth(), von.getDate());
    const letzter = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate());
    let sicherung = 0;
    while (lauf <= letzter && sicherung < 400) {
      const treffer = nachSchluessel.get(calTagesSchluessel(lauf));
      if (treffer) treffer.termine.push(termin);
      lauf = new Date(lauf.getFullYear(), lauf.getMonth(), lauf.getDate() + 1);
      sicherung += 1;
    }
  }

  for (const tag of tage) {
    tag.termine.sort((a, b) => {
      const ga = calIstGanztags(a);
      const gb = calIstGanztags(b);
      if (ga !== gb) return ga ? -1 : 1;
      return calStartDatum(a) - calStartDatum(b);
    });
  }

  return tage;
}

const calPalette = ["#3f8fd4", "#e08a3c", "#5aa469", "#b5559b", "#c95c5c", "#7d7fd4"];

/**
 * Summe ueber die ORIGINALLISTE aus dem Abruf, nicht ueber die gruppierten
 * Tage: dort steht ein dreitaegiger Urlaub an drei Tagen und wuerde dreifach
 * zaehlen. In der flachen Liste steht er genau einmal.
 *
 * KEINE Entdopplung ueber `uid`. Home Assistant gibt JEDER Instanz einer
 * wiederkehrenden Serie DIESELBE uid — ein woechentlicher Fruehdienst kommt
 * fuenfmal mit derselben Kennung. Wer sie entdoppelt, wirft vier Dienste weg:
 * fuenf Zeilen in der Liste und „8 h / 1 Tag" darunter, ein Widerspruch auf
 * demselben Bildschirm. Noetig war die Entdopplung ohnehin nie — das
 * Mehrfachvorkommen, gegen das sie gedacht war, entsteht erst in
 * `calGruppiereNachTag` und kann in dieser flachen Liste gar nicht auftreten.
 *
 * `start` und `ende` sind die Grenzen des GEZEIGTEN Monats. Gezaehlt wird nur,
 * was dazwischen liegt — sonst schlaegt ein Urlaub vom 25.07. bis 05.08. im
 * August-Fuss mit 272 Stunden und zwoelf Tagen zu Buche statt mit rund 112
 * und fuenf. Ohne Grenzen wird nicht geschnitten; die Karte gibt sie immer mit.
 */
function calSummeStunden(termine, start, ende) {
  const grenzeVon = start ? start.getTime() : -Infinity;
  // Der Monat wird als halboffenes Fenster gerechnet: `ende` ist
  // 23:59:59.999 — der letzte DARSTELLBARE Moment, nicht das Ende des Tages.
  // Fuer die Dauer liegt die obere Grenze deshalb eine Millisekunde spaeter,
  // sonst fehlte einem durchlaufenden Termin genau diese Millisekunde und ein
  // voller Monat ergaebe 743,9 statt 744 Stunden.
  const grenzeBis = ende ? ende.getTime() + 1 : Infinity;
  const tage = new Set();
  let ms = 0;
  let ganztags = 0;
  for (const termin of termine || []) {
    if (!termin || !termin.start) continue;

    const von = calStartDatum(termin);
    // Ohne lesbaren Start ist `bis - von` NaN, und ein einziger kaputter
    // Termin macht die Summe des ganzen Monats zu NaN. Eine unbrauchbare
    // Summe sieht falsch aus statt unvollstaendig — deshalb hier dasselbe
    // Ueberspringen wie in `calGruppiereNachTag`. Es ist der einzige Fall, in
    // dem ein Termin ganz herausfaellt: es gibt keinen Tag, an dem er stehen
    // koennte, und ein Ersatzdatum waere erfunden. Sichtbar gemacht wird der
    // Verlust in der Hinweiszeile, deren Zahl `calZaehleNichtGezeigt` an der
    // Tagesschleife abliest. Ein kaputtes oder rueckwaerts laufendes ENDE
    // faellt dagegen in `calEndDatum` auf den Start zurueck, bleibt sichtbar
    // und zaehlt mit Dauer null.
    if (Number.isNaN(von.getTime())) continue;
    const bis = calEndDatum(termin);

    const vonMs = Math.max(von.getTime(), grenzeVon);
    const bisMs = Math.min(bis.getTime(), grenzeBis);
    // Kein Anteil im gezeigten Monat — der Termin gehoert in einen anderen Fuss.
    if (bisMs < vonMs) continue;

    // Fuer die TAGE zaehlt der letzte darstellbare Moment: Mitternacht gehoert
    // schon zum Folgemonat und darf dort keinen Tag mehr aufmachen.
    const letzter = new Date(Math.min(bis.getTime(), grenzeBis - 1));
    const letzterTag = new Date(letzter.getFullYear(), letzter.getMonth(), letzter.getDate());
    const erster = new Date(vonMs);
    let lauf = new Date(erster.getFullYear(), erster.getMonth(), erster.getDate());
    let sicherung = 0;
    while (lauf <= letzterTag && sicherung < 400) {
      tage.add(calTagesSchluessel(lauf));
      lauf = new Date(lauf.getFullYear(), lauf.getMonth(), lauf.getDate() + 1);
      sicherung += 1;
    }

    if (calIstGanztags(termin)) ganztags += 1;
    else ms += bisMs - vonMs;
  }
  return { stunden: ms / 3600000, ganztags, tageMitTermin: tage.size };
}

function calEscape(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function calFormatUhrzeit(datum, locale) {
  return datum.toLocaleTimeString(locale || "de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calFormatStunden(zahl, locale) {
  return zahl.toLocaleString(locale || "de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function calWochentagKurz(datum, locale) {
  return datum.toLocaleDateString(locale || "de-DE", { weekday: "short" });
}

function calTerminHtml(termin, optionen) {
  // `farben` ist optional: ein von Hand gebautes Optionsobjekt (Pruefungen,
  // spaetere Nachweise) soll die Liste nicht sprengen. Fuer `texte` gilt
  // dasselbe — ohne Angabe gilt die deutsche Fassung des Woerterbuchs.
  const texte = optionen.texte || TEXTE_BUSCH_CALENDAR_CARD.de.texte;
  const farbe = (optionen.farben || {})[termin._entity] || calPalette[0];
  const punkt = optionen.mehrereKalender
    ? `<span class="cal-punkt" style="background:${calEscape(farbe)}"></span>`
    : "";
  const zeit = calIstGanztags(termin)
    ? texte.ganztags
    : `${calFormatUhrzeit(calStartDatum(termin), optionen.locale)} – ` +
      `${calFormatUhrzeit(calEndDatum(termin), optionen.locale)}`;
  // Beschreibung und Ort stehen zusaetzlich im `title` und erscheinen beim
  // Ueberfahren — auch dann, wenn der Termin-Dialog nicht erreichbar ist.
  const hinweis = [termin.description, termin.location].filter(Boolean).join(" · ");
  // `data-idx` ist der Platz des Termins in `_alleTermine`, `data-rid` seine
  // Wiederholung. Beide braucht der Klick, um von der Zeile zurueck auf den
  // vollstaendigen Termin zu kommen — die Kennung allein reicht bei einer
  // Serie nicht, dort tragen alle Vorkommen dieselbe `uid`.
  const idx = Number.isInteger(termin._idx) ? String(termin._idx) : "";
  return (
    `<div class="cal-termin" data-uid="${calEscape(termin.uid || "")}" ` +
    `data-entity="${calEscape(termin._entity || "")}" ` +
    `data-idx="${calEscape(idx)}" ` +
    `data-rid="${calEscape(termin.recurrence_id || "")}" ` +
    `title="${calEscape(hinweis)}">` +
    `${punkt}<span class="cal-zeit">${calEscape(zeit)}</span>` +
    `<span class="cal-titel">${calEscape(termin.summary || texte.ohneTitel)}</span>` +
    `</div>`
  );
}

function calListeHtml(tage, optionen) {
  // `optionen.heute` ist einspeisbar, damit die Hervorhebung pruefbar wird —
  // vor allem der Fall, dass sie im Vormonat gerade NICHT erscheinen darf.
  // Ohne Angabe bleibt es bei der Uhr; fuer die Karte aendert sich nichts.
  const heuteSchluessel = calTagesSchluessel(optionen.heute || new Date());
  const zeilen = [];
  for (const tag of tage) {
    if (!optionen.zeigeLeereTage && tag.termine.length === 0) continue;
    const klassen = ["cal-tag"];
    if (tag.istWochenende) klassen.push("cal-wochenende");
    if (tag.schluessel === heuteSchluessel) klassen.push("cal-heute");
    if (tag.termine.length === 0) klassen.push("cal-leer");
    const inhalt = tag.termine.length
      ? tag.termine.map((t) => calTerminHtml(t, optionen)).join("")
      : `<div class="cal-termin cal-nichts"></div>`;
    zeilen.push(
      `<div class="${klassen.join(" ")}">` +
        `<div class="cal-datum">` +
        `<span class="cal-wt">${calEscape(calWochentagKurz(tag.datum, optionen.locale))}</span>` +
        `<span class="cal-nr">${tag.tagNummer}.</span>` +
        `</div>` +
        `<div class="cal-inhalt">${inhalt}</div>` +
        `</div>`
    );
  }
  return zeilen.join("");
}

const CAL_STANDARD = {
  month_offset: 0,
  navigation: true,
  show_empty_days: true,
  show_total: false,
  title: "",
  open_event_on_tap: true,
  edit_on_tap: true,
};

function calNormalisiereKonfig(config) {
  const roh = Array.isArray(config && config.entities) ? config.entities : [];
  const entities = roh.map((eintrag, i) => {
    const objekt = typeof eintrag === "string" ? { entity: eintrag } : { ...eintrag };
    // KEIN `label`: Bis v0.7.0 wurde es normalisiert und nirgends gezeichnet.
    // Es gab keinen Ort dafuer — eine Legende hat die Karte nicht, und bei
    // einem einzigen Kalender wird nicht einmal der Farbpunkt gezeichnet.
    // Eine Option, die nur normalisiert wird, verspricht eine Wirkung, die
    // es nicht gibt. Deshalb entfernt statt nachgebaut.
    return {
      entity: objekt.entity,
      color: objekt.color || calPalette[i % calPalette.length],
    };
  }).filter((e) => Boolean(e.entity));
  return { ...CAL_STANDARD, ...config, entities };
}

/**
 * Wie viele der gelieferten Termine NICHT in der Liste stehen: geliefert minus
 * tatsaechlich platziert, abgelesen an der Tagesschleife selbst.
 *
 * Vorher bildete diese Funktion die Auslassbedingung von
 * `calGruppiereNachTag` ein ZWEITES Mal nach und zaehlte nur den unlesbaren
 * Start. Alles, was die Tagesschleife aus einem anderen Grund fallen laesst —
 * ein Termin ganz ausserhalb des gezeigten Monats etwa —, erschien in keiner
 * Hinweiszeile. Zwei Nachbildungen derselben Bedingung laufen frueher oder
 * spaeter auseinander; eine Differenz kann das nicht.
 *
 * `tage` ist das Ergebnis von `calGruppiereNachTag`. Ein mehrtaegiger Termin
 * liegt dort als DASSELBE Objekt in mehreren Tageslisten — das Set zaehlt ihn
 * deshalb einmal. Das setzt voraus, dass die gelieferte Liste keine zwei
 * Verweise auf dasselbe Objekt enthaelt; `_lade()` legt fuer jeden Termin eine
 * eigene flache Kopie an.
 */
function calZaehleNichtGezeigt(termine, tage) {
  const platziert = new Set();
  for (const tag of tage || []) {
    for (const termin of tag.termine) platziert.add(termin);
  }
  return Math.max(0, (termine || []).length - platziert.size);
}

/**
 * Der Text der Hinweiszeile. Steht ausserhalb der Klasse, weil `_render()` ein
 * Dokument braucht und unter Node nicht pruefbar waere — die Aussage selbst
 * soll aber belegbar sein, nicht nur der Weg dorthin.
 * Ohne Fehler und ohne uebersprungene Termine ist das Ergebnis leer; die
 * Zeile entfaellt dann ganz.
 */
function calHinweisText(fehler, nichtGezeigt, texte) {
  const t = texte || TEXTE_BUSCH_CALENDAR_CARD.de.texte;
  const teile = [];
  if (fehler && fehler.length) {
    teile.push(buschFuellen(t.nichtErreichbar, { liste: fehler.join(", ") }));
  }
  if (nichtGezeigt > 0) {
    // Der Wortlaut nennt den GEMEINSAMEN Grund, nicht mehr nur einen von
    // mehreren: die Zahl kommt aus der Differenz und deckt jeden Termin ab,
    // fuer den die Tagesschleife keinen Platz im gezeigten Monat hatte.
    teile.push(
      nichtGezeigt === 1
        ? t.einerOhneTag
        : buschFuellen(t.mehrereOhneTag, { n: nichtGezeigt })
    );
  }
  return teile.join(" · ");
}

const CAL_STIL = `
  .cal-kopf { display:flex; align-items:center; justify-content:space-between;
    gap:var(--ha-space-2, 8px);
    padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) var(--ha-space-2, 8px); }
  .cal-monat { font-size:1.1em; font-weight:var(--ha-font-weight-bold, 600);
    color:var(--primary-text-color); min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Zum \`user-select: none\` an dieser Stelle und an \`.cal-termin\`:
     Beschwerde des Nutzers — „wieso wird der betreff dann immer markiert lass
     das". Beide Flaechen sind KLICKFLAECHEN; wer darauf klickt, will oeffnen
     bzw. blaettern und nicht markieren. Ein zweiter Klick machte den Text
     stattdessen blau.

     NUR die Klickflaechen, nicht die ganze Karte: Monatsname, Kartentitel,
     Datumsspalte und Fusszeile bleiben markierbar — dort klickt niemand
     versehentlich, und wer sich „25,7 h" herauskopieren will, soll das
     koennen.

     \`-webkit-user-select\` bleibt Pflicht: die Home-Assistant-App auf iOS ist
     WebKit, und dort gilt bis heute nur die praefigierte Form. \`-moz-\` und
     \`-ms-\` stehen bewusst NICHT da — Firefox versteht die schlichte Form seit
     69, und der alte Edge spielt hier keine Rolle. */
  .cal-pfeil { background:none; border:none; cursor:pointer; padding:6px 10px;
    color:var(--secondary-text-color); font-size:1.2em; line-height:1; border-radius:6px;
    -webkit-user-select:none; user-select:none; }
  .cal-pfeil:hover { background:var(--divider-color); color:var(--primary-text-color); }
  /* Der Kartentitel ist einzeilig und wird GEKUERZT, nicht umgebrochen
     (Regel 1, letzter Punkt). */
  .cal-titel-zeile { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) 0;
    font-weight:var(--ha-font-weight-bold, 600); color:var(--primary-text-color);
    min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cal-liste { padding:0 var(--ha-space-2, 8px) var(--ha-space-2, 8px); }
  .cal-tag { display:flex; gap:12px; padding:6px 8px; border-radius:8px;
    border-bottom:1px solid var(--divider-color); }
  .cal-tag:last-child { border-bottom:none; }
  .cal-wochenende { background:var(--secondary-background-color); }
  .cal-heute { outline:2px solid var(--primary-color); outline-offset:-2px; }
  .cal-datum { display:flex; gap:6px; flex:0 0 auto; min-width:64px;
    align-items:baseline;
    color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
  .cal-wt, .cal-nr { overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    min-width:0; }
  .cal-nr { font-weight:var(--ha-font-weight-bold, 600); color:var(--primary-text-color); }
  .cal-inhalt { flex:1; min-width:0; }
  .cal-termin { display:flex; gap:8px; align-items:baseline; padding:2px 0;
    cursor:pointer; -webkit-user-select:none; user-select:none; }
  /* Die leeren Tage tragen \`cursor: default\` und sind nicht klickbar — die
     Regel darueber gilt trotzdem auch fuer sie, und zwar bewusst: ihr Inhalt
     ist \`<div class="cal-termin cal-nichts"></div>\`, also LEER. Es gibt dort
     nichts zu markieren, die Regel kann dort folglich nichts wegnehmen. Eine
     Ausnahme (\`user-select: text\`) waere eine zweite Stelle, die dasselbe
     regelt, ohne etwas zu bewirken — und die eines Tages auseinanderlaeuft. */
  .cal-leer .cal-termin { cursor:default; min-height:1.2em; }
  .cal-punkt { width:8px; height:8px; border-radius:50%; flex:none;
    align-self:center; }
  /* Die Zeitspalte SCHRUMPFT NICHT (flex:0 0 auto) — der Titel daneben tut es
     und wird gekuerzt. Ohne min-width:0 am Titel waeche der Flexkasten ueber
     seinen Elternteil hinaus, statt zu kuerzen (Regel 1). */
  .cal-zeit { color:var(--secondary-text-color); font-variant-numeric:tabular-nums;
    flex:0 0 auto; min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cal-titel { color:var(--primary-text-color); flex:1 1 auto; min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Linksbuendig mit festem Abstand, NICHT ueber die Breite verteilt.
     Gemessen: Mit \`space-between\` sassen bei zwei Werten "3 Tage" und
     "25,7 h" in den gegenueberliegenden Ecken, 436 px Leerraum dazwischen —
     und das ist der Regelfall, weil "1 ganztaegig" nur erscheint, wenn es im
     Monat einen ganztaegigen Termin gab. Die Zeile sprang also, je nachdem ob
     Urlaub drin war. Mit \`gap\` steht sie ruhig und liest sich als eine
     Angabe, ohne dass ein Trennzeichen noetig waere. */
  .cal-fuss { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:24px;
    padding:10px var(--ha-space-4, 16px);
    border-top:1px solid var(--divider-color); color:var(--secondary-text-color); }
  .cal-fuss span { min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; }
  .cal-hinweis { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
    color:var(--error-color, #db4437); overflow-wrap:anywhere; }
  .cal-leermeldung { padding:var(--ha-space-4, 16px);
    color:var(--secondary-text-color); overflow-wrap:anywhere; }
`;

/* ────────────────────────────────────────────────────────────────────────────
 * Der Termin-Dialog von Home Assistant
 *
 * Bis v0.8.0 oeffnete ein Klick auf eine Terminzeile nur den Info-Dialog der
 * Kalender-ENTITAET, weil es keinen bekannten Weg zum Dialog des einzelnen
 * Termins gab. Es gibt einen, und er ist am ausgelieferten Frontend belegt
 * (Home Assistant 2026.8.3).
 *
 * Wie HA selbst den Dialog oeffnet
 * (`src/panels/calendar/show-dialog-calendar-event-detail.ts`):
 *
 *     fireEvent(element, "show-dialog", {
 *       dialogTag: "dialog-calendar-event-detail",
 *       dialogImport: () => import("./dialog-calendar-event-detail"),
 *       dialogParams,
 *     });
 *
 * Das Ereignis koennen wir selbst feuern — `dialogImport` aber nicht bauen:
 * es ist eine Closure ueber einen bundle-internen Import, an den eine fremde
 * Karte nicht herankommt. `window.loadCardHelpers()` gibt ihn nicht her.
 *
 * DER AUSWEG: HA sein eigenes Kalenderelement bauen lassen, dessen
 * Klickbehandlung auf einer NICHT EINGEHAENGTEN Sonde aufrufen und den Import
 * aus dem dabei gefeuerten Ereignis abgreifen. Die Sonde haengt in keinem
 * Dokument — ihr Ereignis erreicht niemanden ausser unserem eigenen Lauscher,
 * es oeffnet also nichts und stoert nichts.
 *
 * Belegt am ausgelieferten Bundle: `_handleEventClick(e){…}` steht dort
 * unverkuerzt, ebenso `i.eventClick=e=>this._handleEventClick(e)` und die
 * Zeichenketten `ha-full-calendar` und `dialog-calendar-event-detail`.
 *
 * WAS DARAN NICHT BEWIESEN IST: dass der Weg zur Laufzeit greift. Unter Node
 * gibt es HAs Frontend nicht, und eine Attrappe, die `_handleEventClick`
 * nachbaut, wuerde nur belegen, dass die Attrappe funktioniert. Deshalb ist
 * jeder einzelne Schritt abgefangen und faellt auf den Entitaets-Dialog
 * zurueck. Ein toter Klick darf dabei NIE herauskommen.
 * ────────────────────────────────────────────────────────────────────────── */

const CAL_DIALOG_TAG = "dialog-calendar-event-detail";
/**
 * HAs EDITOR — der mit den Eingabefeldern, nicht der mit den Knoepfen.
 * Vertrag am ausgelieferten Buendel: `{ calendarId?, selectedDate?, entry?,
 * canDelete?, updated }`. Pflicht ist genau EIN Feld: `updated`. Es wird nach
 * jedem Erfolg unbedingt abgewartet (`await this._params.updated()`); fehlt
 * es, wirft der Dialog nach dem Speichern.
 *
 * `canEdit` gibt es hier NICHT: der Editor prueft die Aenderungsberechtigung
 * nirgends. Das muss die Karte selbst tun — siehe `calStufeWaehlen`.
 */
const CAL_EDITOR_DIALOG_TAG = "dialog-calendar-event-editor";

/** Die drei Stufen, von oben nach unten. Jede faellt auf die naechste. */
const CAL_STUFE_EDITOR = "editor";
const CAL_STUFE_ANSICHT = "ansicht";
const CAL_STUFE_ENTITAET = "entitaet";
const CAL_STUFEN = [CAL_STUFE_EDITOR, CAL_STUFE_ANSICHT, CAL_STUFE_ENTITAET];

/** Bitmaske von `supported_features` der Kalender-Entitaet:
 *  1 = anlegen (braucht die Karte nicht), 2 = loeschen, 4 = aendern. */
const CAL_MERKMAL_LOESCHEN = 2;
const CAL_MERKMAL_AENDERN = 4;

/** Wie lange auf die Definition von `ha-full-calendar` gewartet wird. */
const CAL_SONDE_ZEITGRENZE = 5000;

/** Beide abgegriffenen Ladefunktionen, sobald sie einmal da sind. */
let calDialogImporte = { ansicht: null, editor: null };
/**
 * Der EINE Versuch, sie zu holen — als Zusage gemerkt, nicht als Ergebnis.
 * Damit laufen zwei schnelle Klicks nicht in zwei Sonden, und ein
 * gescheiterter Versuch wird nicht bei jedem weiteren Klick wiederholt:
 * gescheitert ist gescheitert, und der Rueckfall ist dann der Dauerzustand.
 */
let calDialogVersuch = null;

/** Wartet auf `customElements.whenDefined`, aber nicht ewig. */
function calWarteAufElement(name) {
  return Promise.race([
    customElements.whenDefined(name),
    new Promise((_, ablehnen) =>
      setTimeout(() => ablehnen(new Error(`${name} wurde nicht definiert`)), CAL_SONDE_ZEITGRENZE)
    ),
  ]);
}

/**
 * Holt Home Assistants eigene Ladefunktionen fuer BEIDE Termin-Dialoge —
 * einmal. Ergebnis ist stets ein Objekt `{ ansicht, editor }`, dessen Felder
 * die Funktion oder `null` sind; sie wirft nie.
 *
 * Warum eine einzige Sonde fuer beide: Ansichts- und Editor-Ladefunktion
 * liegen im SELBEN Teilstueck des Frontends. Nacheinander
 * `_handleEventClick(...)` und `_createEvent()` auf derselben Instanz
 * aufzurufen holt beide; unterschieden wird am `dialogTag`.
 *
 * Und warum ueberhaupt: Ein einmal geoeffneter Ansichtsdialog registriert den
 * Editor NICHT mit — sein Ladeauftrag zieht das Editor-Modul nicht nach. Ohne
 * abgegriffene Ladefunktion bringt ein Ereignis mit dem Editor-Namen gar
 * nichts.
 */
function calHoleDialogImporte(hass, entityId) {
  if (calDialogVersuch) return calDialogVersuch;
  calDialogVersuch = (async () => {
    const leer = { ansicht: null, editor: null };
    try {
      if (typeof window === "undefined" || typeof window.loadCardHelpers !== "function") return leer;
      const helfer = await window.loadCardHelpers();
      if (!helfer || typeof helfer.createCardElement !== "function") return leer;

      // Der EINZIGE Zweck: HA laedt beim Bauen der eingebauten Kalenderkarte
      // das Buendel nach, in dem `ha-full-calendar` definiert wird. Die Karte
      // selbst wird weggeworfen, sie haengt nirgends. Scheitert das Bauen,
      // gehen wir trotzdem weiter — das Element kann laengst definiert sein.
      try {
        await helfer.createCardElement({ type: "calendar", entities: [entityId] });
      } catch (fehler) {
        /* Weiter: vielleicht ist `ha-full-calendar` schon da. */
      }

      if (typeof customElements === "undefined" || typeof customElements.whenDefined !== "function") {
        return leer;
      }
      await calWarteAufElement("ha-full-calendar");

      const sonde = document.createElement("ha-full-calendar");
      if (!sonde || typeof sonde._handleEventClick !== "function") return leer;
      sonde.hass = hass;

      const abgegriffen = { ansicht: null, editor: null };
      sonde.addEventListener("show-dialog", (ereignis) => {
        const einzel = ereignis && ereignis.detail;
        if (!einzel || typeof einzel.dialogImport !== "function") return;
        if (einzel.dialogTag === CAL_DIALOG_TAG) abgegriffen.ansicht = einzel.dialogImport;
        if (einzel.dialogTag === CAL_EDITOR_DIALOG_TAG) abgegriffen.editor = einzel.dialogImport;
      });

      // Beide Aufrufe EINZELN abgefangen: wirft der eine, soll der andere
      // trotzdem noch liefern. Vorher haette ein Fehlschlag beide gekostet.
      try {
        // Eine leere `eventData` reicht: HA baut daraus die Dialogparameter,
        // die wir ohnehin verwerfen — geholt wird allein `dialogImport`.
        sonde._handleEventClick({ event: { extendedProps: { calendar: entityId, eventData: {} } } });
      } catch (fehler) {
        /* Ansicht bleibt aus; vielleicht kommt wenigstens der Editor. */
      }

      try {
        // DIE FALLE, und sie ist scharf: `_createEvent` liest bei
        // `_activeView === "dayGridMonth"` — dem Standardwert — die Eigenschaft
        // `this.calendar.view`. Auf einer NICHT EINGEHAENGTEN Sonde gibt es
        // `this.calendar` nicht; die Sonde wuerde also werfen, BEVOR sie feuert,
        // und wir bekaemen nichts. `"listWeek"` trifft keinen der drei Zweige.
        //
        // Hergeleitet aus dem ausgelieferten Buendel, NICHT gemessen — unter
        // Node gibt es HAs Frontend nicht. Die Zeile kostet nichts und ist die
        // einzige Absicherung gegen einen Fehlschlag, den niemand sieht.
        sonde._activeView = "listWeek";
        if (typeof sonde._createEvent === "function") sonde._createEvent();
      } catch (fehler) {
        /* Editor bleibt aus; die Ansicht steht dann als Stufe 2 bereit. */
      }

      calDialogImporte = abgegriffen;
      return calDialogImporte;
    } catch (fehler) {
      console.warn(
        "busch-calendar-card: Home Assistants Termin-Dialoge liessen sich nicht "
        + "erreichen — der Klick oeffnet weiter den Kalender-Dialog. Grund: "
        + (fehler && fehler.message ? fehler.message : fehler)
      );
      return { ansicht: null, editor: null };
    }
  })();
  return calDialogVersuch;
}

/**
 * Die Rohform aus `calendars/…` in die flache Form, die HA intern benutzt
 * (`src/data/calendar.ts`). `uid` und `recurrence_id` sind dabei das
 * Entscheidende: ohne sie sind Aendern und Loeschen im Dialog kaputt. Sie
 * werden deshalb DURCHGEREICHT, nicht auf `""` normalisiert — ein leerer
 * String waere eine Kennung, die es nicht gibt.
 *
 * Ohne lesbaren Start gibt es keine Form, sondern `null`: derselbe Massstab,
 * den auch die Tagesschleife anlegt.
 */
function calNormalisiereTermin(termin) {
  if (!termin || typeof termin !== "object") return null;
  const start = termin.start || {};
  const ende = termin.end || {};
  const dtstart = start.dateTime || start.date || "";
  if (!dtstart) return null;
  return {
    summary: termin.summary || "",
    dtstart,
    dtend: ende.dateTime || ende.date || "",
    description: termin.description || "",
    location: termin.location || "",
    uid: termin.uid || undefined,
    recurrence_id: termin.recurrence_id || undefined,
    rrule: termin.rrule || undefined,
  };
}

/**
 * Was der Dialog darf, steht in der ENTITAET, nicht in unserer Annahme.
 * `calendar.arbeitszeiten` hat in der Anlage des Nutzers `7` — alles erlaubt.
 * Eine unbekannte oder fehlende Maske heisst „nichts erlaubt": ein zu
 * grosszuegiges Raten zeigte einen Speichern-Knopf, der beim Druck scheitert.
 */
function calBerechtigungen(zustand) {
  const roh = zustand && zustand.attributes ? zustand.attributes.supported_features : 0;
  const merkmale = Number(roh);
  const maske = Number.isFinite(merkmale) ? merkmale : 0;
  return {
    canEdit: Boolean(maske & CAL_MERKMAL_AENDERN),
    canDelete: Boolean(maske & CAL_MERKMAL_LOESCHEN),
  };
}

/**
 * Vom angeklickten `dataset` zurueck zum geladenen Termin.
 *
 * `data-idx` ist der schnelle Weg, `data-uid` und `data-entity` sind die
 * GEGENPROBE: passt der Termin am Index nicht zur Zeile, ist die Liste
 * zwischenzeitlich neu geladen worden, und der Index zeigt woanders hin. Dann
 * wird gesucht statt gegriffen — sonst oeffnete der Klick den falschen Termin,
 * und zwar lautlos.
 */
function calTerminAusZeile(termine, datensatz) {
  const liste = Array.isArray(termine) ? termine : [];
  if (!datensatz) return null;
  const uid = datensatz.uid || "";
  const entity = datensatz.entity || "";
  const passt = (t) => Boolean(t) && (t.uid || "") === uid && (t._entity || "") === entity;

  // NICHT `Number(datensatz.idx)` allein: `Number("")` ist 0, und ein leeres
  // `data-idx` — das die Zeile bekommt, wenn kein Index gesetzt ist — zeigte
  // damit auf den ERSTEN Termin. Bei einer Serie, deren Vorkommen alle
  // dieselbe `uid` tragen, haette die Gegenprobe das nicht gefangen: sie passt
  // ja. Gemessen an genau dieser Stelle.
  const roh = datensatz.idx;
  const i = roh === "" || roh === undefined || roh === null ? NaN : Number(roh);
  if (Number.isInteger(i) && i >= 0 && i < liste.length && passt(liste[i])) return liste[i];

  const treffer = liste.filter(passt);
  if (treffer.length === 0) return null;
  if (treffer.length === 1) return treffer[0];
  // Mehrere Vorkommen derselben Kennung: eine Serie. Die Wiederholung
  // entscheidet — und wenn auch die nicht trennt, das erste Vorkommen.
  const rid = datensatz.rid || "";
  return treffer.find((t) => (t.recurrence_id || "") === rid) || treffer[0];
}

/**
 * Die Parameter, die `dialog-calendar-event-detail` erwartet.
 * `updated` haengt die Karte selbst an — es ist das einzige Feld, das eine
 * Bindung an die laufende Instanz braucht.
 *
 * Ohne `uid` gibt es KEINE Parameter: der Dialog liesse sich zwar oeffnen,
 * aber Aendern und Loeschen liefen ins Leere. Dann ist der Entitaets-Dialog
 * die ehrlichere Antwort.
 */
function calDialogParameter(entityId, termin, farbe, zustand) {
  const eintrag = calNormalisiereTermin(termin);
  if (!eintrag || !eintrag.uid) return null;
  const rechte = calBerechtigungen(zustand);
  return {
    calendarId: entityId,
    entry: eintrag,
    color: farbe,
    canEdit: rechte.canEdit,
    canDelete: rechte.canDelete,
  };
}

/**
 * Die Parameter fuer `dialog-calendar-event-editor`.
 *
 * Absichtlich OHNE `canEdit`: der Editor kennt das Feld nicht. Es dort
 * hineinzuschreiben waere ein Versprechen, das niemand einloest. Und
 * absichtlich OHNE die Serien- und Rechtepruefung — die steht an genau EINER
 * Stelle, in `calStufeWaehlen`. Dieselbe Bedingung zweimal nachzubilden lief
 * in diesem Repo schon einmal auseinander.
 *
 * `updated` haengt die Karte an; es ist das einzige Pflichtfeld des Vertrags
 * und das einzige, das eine Bindung an die laufende Instanz braucht.
 */
function calEditorParameter(entityId, termin, zustand) {
  const eintrag = calNormalisiereTermin(termin);
  if (!eintrag || !eintrag.uid) return null;
  return {
    calendarId: entityId,
    entry: eintrag,
    canDelete: calBerechtigungen(zustand).canDelete,
  };
}

/**
 * DER SERIENSCHUTZ.
 *
 * Fehlt bei einem wiederkehrenden Termin die Instanzkennung `recurrence_id`,
 * aendert der Editor STILLSCHWEIGEND die ganze Serie: er sendet dann einen
 * leeren String, und der bedeutet „alle Vorkommen". Der Nutzer bekommt keine
 * Rueckfrage, weil die Rueckfrage genau an dieser Kennung haengt.
 *
 * Ob Home Assistant fuer gewoehnliche Instanzen einer Serie ueberhaupt eine
 * eigene Kennung liefert, ist UNBELEGT — offener Punkt seit der letzten Runde.
 * Solange das so ist, wird der Editor fuer diesen Fall nicht geoeffnet,
 * sondern der Ansichtsdialog: der hat einen Bearbeiten-Knopf und stellt die
 * Rueckfrage korrekt.
 *
 * Ein stillschweigend geaenderter Serientermin ist ein Datenverlust, den
 * niemand bemerkt, bis es zu spaet ist. Deshalb faellt die Entscheidung hier
 * zugunsten der langsameren, aber ehrlichen Stufe.
 */
function calAendertGanzeSerie(eintrag) {
  if (!eintrag) return false;
  return Boolean(eintrag.rrule) && !eintrag.recurrence_id;
}

/**
 * Welche Stufe ein Klick oeffnet — die ganze Entscheidung an einer Stelle,
 * ohne DOM und damit pruefbar.
 *
 * `lage` = `{ editOnTap, hatEditorImport, hatAnsichtImport, rechte, eintrag }`.
 *
 * Der Editor prueft die Aenderungsberechtigung NICHT selbst; ist Bit 4 der
 * Merkmale nicht gesetzt, zeigte er Eingabefelder fuer einen Kalender, der die
 * Aenderung hinterher ablehnt. Deshalb prueft die Karte.
 */
function calStufeWaehlen(lage) {
  const l = lage || {};
  const eintrag = l.eintrag || null;
  const rechte = l.rechte || {};
  // Beide Dialoge brauchen `uid`: ohne sie liefen Speichern und Loeschen ins
  // Leere. Dann ist der Entitaets-Dialog die ehrlichere Antwort.
  if (!eintrag || !eintrag.uid) return CAL_STUFE_ENTITAET;
  const editorMoeglich =
    l.editOnTap !== false &&
    Boolean(l.hatEditorImport) &&
    Boolean(rechte.canEdit) &&
    !calAendertGanzeSerie(eintrag);
  if (editorMoeglich) return CAL_STUFE_EDITOR;
  if (l.hatAnsichtImport) return CAL_STUFE_ANSICHT;
  return CAL_STUFE_ENTITAET;
}

/**
 * Die Stufe und alles, was darunter liegt — die Reihenfolge, in der die Karte
 * es versucht, wenn eine Stufe zur Laufzeit wirft. Endet IMMER am
 * Entitaets-Dialog: ein toter Klick darf nie herauskommen.
 */
function calStufenFolge(stufe) {
  const i = CAL_STUFEN.indexOf(stufe);
  return i < 0 ? [CAL_STUFE_ENTITAET] : CAL_STUFEN.slice(i);
}

class BuschCalendarCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-calendar-card-editor");
  }

  static getStubConfig(hass) {
    const ersterKalender = hass
      ? Object.keys(hass.states).find((id) => id.startsWith("calendar."))
      : undefined;
    return {
      type: "custom:busch-calendar-card",
      entities: ersterKalender ? [ersterKalender] : [],
      month_offset: 0,
    };
  }

  setConfig(config) {
    this._config = calNormalisiereKonfig(config);
    // Der Blaetterzustand lebt nur im Speicher. Ein Klick auf einen Pfeil
    // schreibt NICHTS in die Konfiguration zurueck — sonst aenderte ein Blick
    // in den Vormonat das Dashboard fuer alle.
    this._versatzLaufend = this._config.month_offset;
    this._tage = null;
    this._fehler = [];
    this._nichtGezeigt = 0;
    this._render();
    // Schuetzt gegen die dauerhaft haengende Ladeanzeige: Ein zweiter Aufruf
    // aus dem Editor (Ueberschrift, Monatsversatz, Schalter) setzt `_tage`
    // wieder auf null, und `_ladeWennVeraendert()` loest NICHT nach — sein
    // Stempel haengt allein an der Entitaetsliste und deren Aenderungszeit,
    // und die ist unveraendert. Ohne diese Zeile bliebe die Karte auf
    // „Wird geladen …" stehen. Kreisen kann es nicht: `_lade()` ruft
    // `setConfig` nirgends auf.
    if (this._hass) this._lade();
  }

  set hass(hass) {
    const ersterAufruf = !this._hass;
    this._hass = hass;
    if (ersterAufruf) this._lade();
    else this._ladeWennVeraendert();
  }

  getCardSize() {
    return this._config && this._config.show_empty_days ? 12 : 6;
  }

  /** Spalten in Vielfachen von 3 (Regel 3). Eine Monatsliste braucht Hoehe,
   *  aber keine volle Breite — halbe Breite ist das Mindestmass. */
  getGridOptions() {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  /** Der Textabschnitt der geltenden Sprache. */
  get _texte() {
    return buschTexte(TEXTE_BUSCH_CALENDAR_CARD, this._hass).texte;
  }

  _ladeWennVeraendert() {
    if (!this._config || !this._hass) return;
    const stempel = this._config.entities
      .map((e) => {
        const zustand = this._hass.states[e.entity];
        return zustand ? `${e.entity}:${zustand.last_changed}` : `${e.entity}:fehlt`;
      })
      .join("|");
    if (stempel !== this._letzterStempel) {
      this._letzterStempel = stempel;
      this._lade();
    }
  }

  async _lade() {
    if (!this._hass || !this._config) return;
    const { start, ende } = calMonatsGrenzen(new Date(), this._versatzLaufend);
    // Ein monoton steigender Zaehler, KEINE Marke aus Monat und Kalenderanzahl.
    // Wer vor und gleich wieder zurueck blaettert, holt zweimal dasselbe
    // Fenster: eine inhaltliche Marke waere dann doppelt, und eine verspaetete
    // alte Antwort haette die frische kommentarlos ueberschrieben. Mit dem
    // Zaehler gewinnt immer die zuletzt gestartete Anfrage, egal welchen Monat
    // sie holt. Er wird NIE zurueckgesetzt, auch nicht in `setConfig` — sonst
    // traefe eine noch laufende alte Ladung wieder ihre eigene Nummer.
    this._ladeZaehler = (this._ladeZaehler || 0) + 1;
    const meineLadung = this._ladeZaehler;

    if (this._config.entities.length === 0) {
      this._tage = [];
      this._alleTermine = [];
      this._fehler = [];
      this._nichtGezeigt = 0;
      this._render();
      return;
    }

    const anfragen = this._config.entities.map((e) =>
      this._hass.callApi(
        "GET",
        `calendars/${e.entity}?start=${encodeURIComponent(start.toISOString())}` +
          `&end=${encodeURIComponent(ende.toISOString())}`
      )
    );
    const ergebnisse = await Promise.allSettled(anfragen);
    // Eine neuere Ladung ist gestartet — diese Antwort ist ueberholt.
    if (this._ladeZaehler !== meineLadung) return;

    const alle = [];
    const fehler = [];
    ergebnisse.forEach((r, i) => {
      const eintrag = this._config.entities[i];
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        for (const termin of r.value) {
          // Flache Kopie, kein Feld am Original: ein mehrtaegiger Termin liegt
          // als DASSELBE Objekt in mehreren Tageslisten — wer daran schreibt,
          // trifft alle seine Tage.
          // `_idx` ist der Platz in genau dieser Liste; die Terminzeile traegt
          // ihn als `data-idx`, damit der Klick den Termin wiederfindet.
          alle.push({ ...termin, _entity: eintrag.entity, _idx: alle.length });
        }
      } else {
        fehler.push(eintrag.entity);
      }
    });

    this._alleTermine = alle;
    this._tage = calGruppiereNachTag(alle, start, ende);
    this._fehler = fehler;
    this._nichtGezeigt = calZaehleNichtGezeigt(alle, this._tage);
    this._render();
  }

  _blaettern(schritt) {
    this._versatzLaufend += schritt;
    // `_tage` wird BEWUSST nicht geleert: die alte Liste bleibt stehen, bis
    // die neue da ist. Sonst blitzt zwischen zwei Monaten „Wird geladen …" auf.
    this._lade();
    this._render();
  }

  /**
   * Ein Klick auf eine Terminzeile oeffnet Home Assistants eigenen
   * Termin-EDITOR — den mit den Eingabefeldern. Wie die Karte an dessen
   * Ladefunktion kommt, steht ausfuehrlich bei `calHoleDialogImporte`.
   *
   * DREI STUFEN, jede faellt auf die naechste:
   *
   *   1. Editor (`dialog-calendar-event-editor`) — direkt in die Felder.
   *   2. Ansicht (`dialog-calendar-event-detail`) — der Stand von v0.8.1,
   *      mit Knoepfen zum Bearbeiten und Loeschen darin.
   *   3. Entitaet (`hass-more-info`) — der Stand bis v0.8.0.
   *
   * WELCHE Stufe entschieden wird, steht in `calStufeWaehlen`. Hier steht nur,
   * was danach passiert — und dass jede Stufe EINZELN abgefangen ist: wirft
   * das Oeffnen, wird die naechste versucht. Ein Klick, der gar nichts tut,
   * waere das Schlechteste von allem; der Nutzer saehe nicht, ob die Karte
   * kaputt ist oder er danebengetippt hat.
   *
   * Diese Methode wirft nie und lehnt nie ab; die aufrufende Klickbehandlung
   * wartet nicht auf sie.
   */
  async _oeffneTermin(datensatz) {
    const entity = (datensatz && datensatz.entity) || "";
    if (!this._config.open_event_on_tap || !entity) return;

    let stufen = [CAL_STUFE_ENTITAET];
    let parameter = null;
    let editorParameter = null;
    let importe = { ansicht: null, editor: null };
    try {
      const termin = calTerminAusZeile(this._alleTermine, datensatz);
      const eintrag = this._config.entities.find((e) => e.entity === entity);
      const zustand = this._hass && this._hass.states ? this._hass.states[entity] : null;
      parameter = calDialogParameter(
        entity,
        termin,
        eintrag ? eintrag.color : calPalette[0],
        zustand
      );
      // Die Rohform, NICHT `parameter.entry`: das ist bereits normalisiert,
      // und `calEditorParameter` normalisiert selbst. Zweimal normalisieren
      // ergaebe `null`, weil die flache Form kein `start`-Objekt mehr hat.
      editorParameter = calEditorParameter(entity, termin, zustand);
      if (parameter) {
        importe = await calHoleDialogImporte(this._hass, entity);
        stufen = calStufenFolge(
          calStufeWaehlen({
            editOnTap: this._config.edit_on_tap !== false,
            hatEditorImport: Boolean(importe.editor),
            hatAnsichtImport: Boolean(importe.ansicht),
            rechte: { canEdit: parameter.canEdit, canDelete: parameter.canDelete },
            eintrag: parameter.entry,
          })
        );
      }
    } catch (fehler) {
      console.warn(
        "busch-calendar-card: Stufe liess sich nicht bestimmen, es bleibt beim "
        + "Kalender-Dialog. Grund: " + (fehler && fehler.message ? fehler.message : fehler)
      );
    }

    for (const stufe of stufen) {
      try {
        if (stufe === CAL_STUFE_EDITOR && editorParameter && importe.editor) {
          this._zeigeDialog(CAL_EDITOR_DIALOG_TAG, importe.editor, {
            ...editorParameter,
            // `updated` ist das EINZIGE Pflichtfeld des Vertrags: HA wartet es
            // nach jedem Erfolg unbedingt ab. Fehlt es, wirft der Dialog nach
            // dem Speichern.
            updated: () => this._lade(),
          });
          return;
        }
        if (stufe === CAL_STUFE_ANSICHT && parameter && importe.ansicht) {
          this._zeigeDialog(CAL_DIALOG_TAG, importe.ansicht, {
            ...parameter,
            updated: () => this._lade(),
          });
          return;
        }
        if (stufe === CAL_STUFE_ENTITAET) {
          this._oeffneEntitaet(entity);
          return;
        }
      } catch (fehler) {
        console.warn(
          `busch-calendar-card: Stufe „${stufe}" liess sich nicht oeffnen, `
          + "es geht eine Stufe tiefer. Grund: "
          + (fehler && fehler.message ? fehler.message : fehler)
        );
      }
    }
  }

  /**
   * Ein `show-dialog` an HAs Dialogverwaltung.
   *
   * `addHistory: true` ist der dokumentierte Weg, die Zurueck-Taste an einen
   * HA-Dialog zu binden: `src/dialogs/make-dialog-manager.ts` fuehrt das Feld
   * in `ShowDialogParams` und legt bei `true` beim Oeffnen
   * `history.pushState({ dialog: dialogTag }, '')` an und ruft beim Schliessen
   * `history.back()`. Genau das verlangt Regel 2 aus `docs/ui-regeln.md`.
   *
   * Es WEGZULASSEN waere die Annahme, HAs Vorgabe sei `true`. Ist sie es,
   * aendert die Zeile nichts; ist sie es nicht, verliesse die Zurueck-Taste
   * das Dashboard. Deshalb steht es hier ausdruecklich.
   */
  _zeigeDialog(tag, laden, parameter) {
    this.dispatchEvent(
      new CustomEvent("show-dialog", {
        detail: {
          dialogTag: tag,
          dialogImport: laden,
          dialogParams: parameter,
          addHistory: true,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Der Rueckfall: HAs Info-Dialog der Kalender-Entitaet. */
  _oeffneEntitaet(entity) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this._config) return;
    const t = this._texte;
    const locale = (this._hass && this._hass.locale && this._hass.locale.language) || "de-DE";
    const { start, ende } = calMonatsGrenzen(new Date(), this._versatzLaufend);

    if (!this._karte) {
      this._karte = document.createElement("ha-card");
      const stil = document.createElement("style");
      stil.textContent = CAL_STIL;
      this._karte.appendChild(stil);
      this._koerper = document.createElement("div");
      this._karte.appendChild(this._koerper);
      this.appendChild(this._karte);

      this._koerper.addEventListener("click", (ereignis) => {
        const pfeil = ereignis.target.closest(".cal-pfeil");
        if (pfeil) {
          this._blaettern(Number(pfeil.dataset.schritt));
          return;
        }
        const zeile = ereignis.target.closest(".cal-termin");
        if (zeile && zeile.dataset.uid) {
          // Ohne `await`: die Klickbehandlung ist synchron, und
          // `_oeffneTermin` lehnt nie ab.
          this._oeffneTermin(zeile.dataset);
        }
      });
    }

    const farben = {};
    for (const e of this._config.entities) farben[e.entity] = e.color;

    const kopf =
      (this._config.title
        ? `<div class="cal-titel-zeile">${calEscape(this._config.title)}</div>`
        : "") +
      `<div class="cal-kopf">` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="-1" aria-label="${calEscape(t.vorigerMonat)}" title="${calEscape(t.vorigerMonat)}">‹</button>`
        : `<span></span>`) +
      `<span class="cal-monat">${calEscape(calMonatsName(start, locale))}</span>` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="1" aria-label="${calEscape(t.naechsterMonat)}" title="${calEscape(t.naechsterMonat)}">›</button>`
        : `<span></span>`) +
      `</div>`;

    let rumpf;
    if (this._config.entities.length === 0) {
      rumpf = `<div class="cal-leermeldung">${calEscape(t.keinKalender)}</div>`;
    } else if (this._tage === null) {
      rumpf = `<div class="cal-leermeldung">${calEscape(t.laden)}</div>`;
    } else {
      const liste = calListeHtml(this._tage, {
        zeigeLeereTage: this._config.show_empty_days,
        locale,
        farben,
        texte: t,
        mehrereKalender: this._config.entities.length > 1,
      });
      rumpf = liste
        ? `<div class="cal-liste">${liste}</div>`
        : `<div class="cal-leermeldung">${calEscape(t.keineTermine)}</div>`;
    }

    let fuss = "";
    if (this._config.show_total && this._tage) {
      // MIT den Monatsgrenzen: eine Summe, die schneiden kann, aber
      // ungeschnitten aufgerufen wird, ist so falsch wie eine, die es nicht kann.
      const s = calSummeStunden(this._alleTermine || [], start, ende);
      const teile = [
        buschFuellen(t.tage, { n: s.tageMitTermin }),
        buschFuellen(t.stunden, { n: calFormatStunden(s.stunden, locale) }),
      ];
      if (s.ganztags) teile.push(buschFuellen(t.summeGanztags, { n: s.ganztags }));
      // Ein Span JE WERT, linksbuendig mit festem `gap` im Stil. KEIN Trenner
      // dazwischen: auf dem Bildschirm trennt sie der Raum.
      //
      // Wer den Fuss misst, liest die Spans EINZELN (`.cal-fuss span`).
      // `textContent` des Kastens klebt sie zu „6 Tage25,7 h1 ganztägig"
      // zusammen — das ist ein Messproblem, kein Darstellungsproblem. Es wurde
      // in v0.7.1 kurzzeitig andersherum geloest (ein Span mit Mittelpunkten),
      // und damit war `space-between` toter Code und die Zeile klebte links.
      // Die Messung passt sich der Darstellung an, nicht umgekehrt.
      fuss = `<div class="cal-fuss">${teile.map((t) => `<span>${calEscape(t)}</span>`).join("")}</div>`;
    }

    const hinweisText = calHinweisText(this._fehler || [], this._nichtGezeigt || 0, t);
    const hinweis = hinweisText
      ? `<div class="cal-hinweis">${calEscape(hinweisText)}</div>`
      : "";

    this._koerper.innerHTML = kopf + rumpf + fuss + hinweis;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Editor der Kalenderkarte.
 *
 * Jede Option aus Abschnitt 5 der Spec steht im Schema — keine existiert nur
 * in YAML. Die Farben je Kalender stehen bewusst NICHT im `ha-form`-Schema:
 * sie haengen an den Eintraegen von `entities`, und der Entitaetsselektor
 * kennt nur flache Zeichenketten. Sie bekommen deshalb ein eigenes Feld
 * darunter, das erst ab dem zweiten Kalender erscheint (ein Punkt, der immer
 * dieselbe Farbe hat, traegt keine Information).
 * ────────────────────────────────────────────────────────────────────────── */

const SCHEMA_BUSCH_CALENDAR_CARD = [
  { name: "title", selector: { text: {} } },
  {
    name: "entities",
    selector: { entity: { domain: "calendar", multiple: true } },
  },
  {
    name: "month_offset",
    selector: { number: { min: -24, max: 24, step: 1, mode: "box" } },
  },
  {
    type: "grid",
    schema: [
      { name: "navigation", selector: { boolean: {} } },
      { name: "show_empty_days", selector: { boolean: {} } },
      { name: "show_total", selector: { boolean: {} } },
      { name: "open_event_on_tap", selector: { boolean: {} } },
      { name: "edit_on_tap", selector: { boolean: {} } },
    ],
  },
];

const TEXTE_BUSCH_CALENDAR_CARD = {
  de: {
    name: "Busch Kalender",
    description: "Termine als Monatsliste, mit Monatsversatz und Blättern.",
    labels: {
      title: "Überschrift",
      entities: "Kalender",
      month_offset: "Monatsversatz",
      navigation: "Pfeile zum Blättern",
      show_empty_days: "Leere Tage zeigen",
      show_total: "Summe in der Fußzeile",
      open_event_on_tap: "Klick öffnet den Termin",
      edit_on_tap: "Klick öffnet den Editor",
    },
    helpers: {
      title: "Zeile über dem Monatsnamen. Leer lässt sie ganz weg. Vorgabe: leer.",
      entities: "Die Kalender, deren Termine die Karte zeigt. Ab dem zweiten erscheint darunter je ein Farbfeld. Vorgabe: keiner.",
      month_offset: "0 zeigt den laufenden Monat, -1 den Vormonat, 1 den nächsten. Vorgabe 0.",
      navigation: "Setzt links und rechts vom Monatsnamen je einen Pfeil. Geblättert wird nur in dieser Ansicht, das Dashboard bleibt unverändert. Vorgabe an.",
      show_empty_days: "An steht jeder Tag des Monats in der Liste, auch ohne Termin. Vorgabe an.",
      show_total: "Zeigt unter der Liste Tage mit Terminen, Stunden und ganztägige Termine des gezeigten Monats. Vorgabe aus.",
      open_event_on_tap: "An öffnet ein Klick auf eine Terminzeile den Termin-Dialog von Home Assistant. Vorgabe an.",
      edit_on_tap: "An öffnet der Klick gleich den Editor mit den Eingabefeldern, aus die Ansicht mit den Knöpfen. Bei einem Serientermin ohne eigene Kennung bleibt es immer bei der Ansicht. Vorgabe an.",
    },
    texte: {
      ganztags: "ganztägig",
      ohneTitel: "(ohne Titel)",
      keinKalender: "Kein Kalender gewählt. Im Karteneditor einen auswählen.",
      laden: "Wird geladen …",
      keineTermine: "Keine Termine in diesem Monat.",
      nichtErreichbar: "Nicht erreichbar: {liste}",
      einerOhneTag: "1 Termin ohne Tag im gezeigten Monat, nicht angezeigt.",
      mehrereOhneTag: "{n} Termine ohne Tag im gezeigten Monat, nicht angezeigt.",
      tage: "{n} Tage",
      stunden: "{n} h",
      summeGanztags: "{n} ganztägig",
      vorigerMonat: "Voriger Monat",
      naechsterMonat: "Nächster Monat",
      farben: "Farben",
    },
  },
  en: {
    name: "Busch calendar",
    description: "Events as a month list, with a month offset and paging.",
    labels: {
      title: "Heading",
      entities: "Calendars",
      month_offset: "Month offset",
      navigation: "Paging arrows",
      show_empty_days: "Show empty days",
      show_total: "Total in the footer",
      open_event_on_tap: "Tap opens the event",
      edit_on_tap: "Tap opens the editor",
    },
    helpers: {
      title: "A line above the month name. Empty leaves it out entirely. Default: empty.",
      entities: "The calendars whose events this card shows. From the second one on, a colour field appears below. Default: none.",
      month_offset: "0 shows the current month, -1 the previous one, 1 the next. Default 0.",
      navigation: "Puts an arrow on each side of the month name. Paging affects this view only, the dashboard stays unchanged. Default on.",
      show_empty_days: "On, every day of the month is listed, even without an event. Default on.",
      show_total: "Shows days with events, hours and all-day events of the shown month below the list. Default off.",
      open_event_on_tap: "On, a tap on an event row opens Home Assistant's event dialog. Default on.",
      edit_on_tap: "On, the tap goes straight to the editor with the input fields, off to the view with the buttons. For a recurring event without its own id it always stays on the view. Default on.",
    },
    texte: {
      ganztags: "all day",
      ohneTitel: "(untitled)",
      keinKalender: "No calendar chosen. Pick one in the card editor.",
      laden: "Loading …",
      keineTermine: "No events this month.",
      nichtErreichbar: "Unreachable: {liste}",
      einerOhneTag: "1 event has no day in the month shown and is not listed.",
      mehrereOhneTag: "{n} events have no day in the month shown and are not listed.",
      tage: "{n} days",
      stunden: "{n} h",
      summeGanztags: "{n} all day",
      vorigerMonat: "Previous month",
      naechsterMonat: "Next month",
      farben: "Colours",
    },
  },
};

class BuschCalendarCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...CAL_STANDARD, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /** Der Entitaetsselektor liefert Zeichenketten. Eigene Farben, die schon
   *  gesetzt waren, muessen dabei erhalten bleiben. */
  _verschmelzeEntities(neueListe) {
    const alt = new Map();
    for (const e of this._config.entities || []) {
      if (typeof e === "object" && e.entity) alt.set(e.entity, e);
    }
    return (neueListe || []).map((id) => (alt.has(id) ? alt.get(id) : id));
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      const texte = buschTexte(TEXTE_BUSCH_CALENDAR_CARD, this._hass);
      this._texte = texte.texte;
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_CALENDAR_CARD, texte);
      this._form.computeLabel = (schema) => texte.labels[schema.name] || schema.name;
      this._form.computeHelper = (schema) => texte.helpers[schema.name] || "";
      this._form.addEventListener("value-changed", (ereignis) => {
        ereignis.stopPropagation();
        const werte = { ...ereignis.detail.value };
        werte.entities = this._verschmelzeEntities(werte.entities);
        this._config = { ...this._config, ...werte };
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
        this._renderFarben();
      });
      this.appendChild(this._form);

      this._farbFeld = document.createElement("div");
      this._farbFeld.style.padding = "8px 0 0";
      this.appendChild(this._farbFeld);
    }

    this._form.hass = this._hass;
    // ha-form erwartet flache Zeichenketten im Entitaetsselektor.
    this._form.data = {
      ...this._config,
      entities: (this._config.entities || []).map((e) =>
        typeof e === "string" ? e : e.entity
      ),
    };
    this._renderFarben();
  }

  _renderFarben() {
    const normal = calNormalisiereKonfig(this._config);
    if (normal.entities.length < 2) {
      this._farbFeld.innerHTML = "";
      return;
    }
    const farbenTitel = (this._texte || TEXTE_BUSCH_CALENDAR_CARD.de.texte).farben;
    this._farbFeld.innerHTML =
      `<div style="font-weight:600;margin:8px 0 4px">${calEscape(farbenTitel)}</div>` +
      normal.entities
        .map((e) => {
          const name =
            (this._hass.states[e.entity] &&
              this._hass.states[e.entity].attributes.friendly_name) ||
            e.entity;
          return (
            `<label style="display:flex;align-items:center;gap:10px;padding:4px 0">` +
            `<input type="color" data-entity="${calEscape(e.entity)}" value="${calEscape(e.color)}">` +
            `<span>${calEscape(name)}</span></label>`
          );
        })
        .join("");

    for (const feld of this._farbFeld.querySelectorAll("input[type=color]")) {
      feld.addEventListener("change", (ereignis) => {
        const id = ereignis.target.dataset.entity;
        const liste = calNormalisiereKonfig(this._config).entities.map((e) => ({
          entity: e.entity,
          color: e.entity === id ? ereignis.target.value : e.color,
        }));
        this._config = { ...this._config, entities: liste };
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
      });
    }
  }
}

customElements.define("busch-schedule-card", BuschScheduleCard);
customElements.define("busch-schedule-card-editor", BuschScheduleCardEditor);

/* Der Kartenwaehler liest `name` und `description` beim LADEN der Datei —
 * da gibt es noch keinen `hass`. Die Sprache kommt hier deshalb aus
 * `navigator.language`; `buschTexte` ohne zweites Argument macht genau das
 * (docs/ui-regeln.md, Regel 3). */
const waehlerZeitplan = buschTexte(TEXTE_BUSCH_SCHEDULE_CARD);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "busch-schedule-card",
  name: waehlerZeitplan.name,
  description: waehlerZeitplan.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});


/* ═══════════════════════════════════════════════════════════════════════════
 * BEGIN VENDOR — Leaflet 1.9.4 (BSD-2-Clause), unverändert eingebettet.
 *
 * Nur die Bibliothek, ohne CSS und Marker-Bilder: Diese Datei zeichnet keine
 * eigene Karte. Sie haengt lediglich eine Rasterebene an eine Karte, die Home
 * Assistant schon aufgebaut hat — dessen Leaflet-CSS ist dann bereits geladen.
 *
 * Warum ueberhaupt eingebettet: Zeichnet Home Assistant seine Grundkarte als
 * Vektorkarte, gibt es keine Rasterebene, deren URL man tauschen koennte. Dann
 * braucht es eine eigene — und dafuer eine `L.TileLayer`-Klasse. Die ist aus
 * dem Kartenobjekt heraus nicht erreichbar: Leaflet-Klassen verweisen nicht
 * aufeinander, und HAs Leaflet liegt in einem Modul ohne globalen Namen.
 *
 * ERST BEI BEDARF geladen, ueber `leafletLaden()` weiter unten — und nur,
 * wenn nicht schon ein Leaflet auf der Seite liegt. Details dort.
 * ═══════════════════════════════════════════════════════════════════════════ */

function leafletLaden() {
  // ERST BEI BEDARF, nicht beim Laden der Datei. Zwei Gruende:
  //
  // 1. Leaflets UMD greift sofort auf `window.requestAnimationFrame`,
  //    `navigator.userAgent` und das echte DOM zu. Die Testsandbox in
  //    `tests/laden.js` stellt davon nur einen Bruchteil — beim Laden auf
  //    oberster Ebene brach dort jeder Test ab.
  // 2. Die 147 kB werden nur ausgewertet, wenn wirklich eine Vektor-Grundkarte
  //    ersetzt werden muss. Wer nur den Zeitplan oder den Kalender benutzt,
  //    zahlt nichts dafuer.
  //
  // Liegt bereits ein Leaflet auf der Seite (etwa aus `ha-localtrack-cards`),
  // wird dessen Instanz mitbenutzt: zwei Kopien derselben Bibliothek an einem
  // Kartenobjekt sind unnoetig und eine Fehlerquelle.
  if (typeof window === "undefined") return null;
  if (window.L) return window.L;
  if (leafletLaden._versucht) return null;
  leafletLaden._versucht = true;
  try {
/* @preserve
 * Leaflet 1.9.4, a JS library for interactive maps. https://leafletjs.com
 * (c) 2010-2023 Vladimir Agafonkin, (c) 2010-2011 CloudMade
 */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).leaflet={})}(this,function(t){"use strict";function l(t){for(var e,i,n=1,o=arguments.length;n<o;n++)for(e in i=arguments[n])t[e]=i[e];return t}var R=Object.create||function(t){return N.prototype=t,new N};function N(){}function a(t,e){var i,n=Array.prototype.slice;return t.bind?t.bind.apply(t,n.call(arguments,1)):(i=n.call(arguments,2),function(){return t.apply(e,i.length?i.concat(n.call(arguments)):arguments)})}var D=0;function h(t){return"_leaflet_id"in t||(t._leaflet_id=++D),t._leaflet_id}function j(t,e,i){var n,o,s=function(){n=!1,o&&(r.apply(i,o),o=!1)},r=function(){n?o=arguments:(t.apply(i,arguments),setTimeout(s,e),n=!0)};return r}function H(t,e,i){var n=e[1],e=e[0],o=n-e;return t===n&&i?t:((t-e)%o+o)%o+e}function u(){return!1}function i(t,e){return!1===e?t:(e=Math.pow(10,void 0===e?6:e),Math.round(t*e)/e)}function W(t){return t.trim?t.trim():t.replace(/^\s+|\s+$/g,"")}function F(t){return W(t).split(/\s+/)}function c(t,e){for(var i in Object.prototype.hasOwnProperty.call(t,"options")||(t.options=t.options?R(t.options):{}),e)t.options[i]=e[i];return t.options}function U(t,e,i){var n,o=[];for(n in t)o.push(encodeURIComponent(i?n.toUpperCase():n)+"="+encodeURIComponent(t[n]));return(e&&-1!==e.indexOf("?")?"&":"?")+o.join("&")}var V=/\{ *([\w_ -]+) *\}/g;function q(t,i){return t.replace(V,function(t,e){e=i[e];if(void 0===e)throw new Error("No value provided for variable "+t);return e="function"==typeof e?e(i):e})}var d=Array.isArray||function(t){return"[object Array]"===Object.prototype.toString.call(t)};function G(t,e){for(var i=0;i<t.length;i++)if(t[i]===e)return i;return-1}var K="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";function Y(t){return window["webkit"+t]||window["moz"+t]||window["ms"+t]}var X=0;function J(t){var e=+new Date,i=Math.max(0,16-(e-X));return X=e+i,window.setTimeout(t,i)}var $=window.requestAnimationFrame||Y("RequestAnimationFrame")||J,Q=window.cancelAnimationFrame||Y("CancelAnimationFrame")||Y("CancelRequestAnimationFrame")||function(t){window.clearTimeout(t)};function x(t,e,i){if(!i||$!==J)return $.call(window,a(t,e));t.call(e)}function r(t){t&&Q.call(window,t)}var tt={__proto__:null,extend:l,create:R,bind:a,get lastId(){return D},stamp:h,throttle:j,wrapNum:H,falseFn:u,formatNum:i,trim:W,splitWords:F,setOptions:c,getParamString:U,template:q,isArray:d,indexOf:G,emptyImageUrl:K,requestFn:$,cancelFn:Q,requestAnimFrame:x,cancelAnimFrame:r};function et(){}et.extend=function(t){function e(){c(this),this.initialize&&this.initialize.apply(this,arguments),this.callInitHooks()}var i,n=e.__super__=this.prototype,o=R(n);for(i in(o.constructor=e).prototype=o,this)Object.prototype.hasOwnProperty.call(this,i)&&"prototype"!==i&&"__super__"!==i&&(e[i]=this[i]);if(t.statics&&l(e,t.statics),t.includes){var s=t.includes;if("undefined"!=typeof L&&L&&L.Mixin){s=d(s)?s:[s];for(var r=0;r<s.length;r++)s[r]===L.Mixin.Events&&console.warn("Deprecated include of L.Mixin.Events: this property will be removed in future releases, please inherit from L.Evented instead.",(new Error).stack)}l.apply(null,[o].concat(t.includes))}return l(o,t),delete o.statics,delete o.includes,o.options&&(o.options=n.options?R(n.options):{},l(o.options,t.options)),o._initHooks=[],o.callInitHooks=function(){if(!this._initHooksCalled){n.callInitHooks&&n.callInitHooks.call(this),this._initHooksCalled=!0;for(var t=0,e=o._initHooks.length;t<e;t++)o._initHooks[t].call(this)}},e},et.include=function(t){var e=this.prototype.options;return l(this.prototype,t),t.options&&(this.prototype.options=e,this.mergeOptions(t.options)),this},et.mergeOptions=function(t){return l(this.prototype.options,t),this},et.addInitHook=function(t){var e=Array.prototype.slice.call(arguments,1),i="function"==typeof t?t:function(){this[t].apply(this,e)};return this.prototype._initHooks=this.prototype._initHooks||[],this.prototype._initHooks.push(i),this};var e={on:function(t,e,i){if("object"==typeof t)for(var n in t)this._on(n,t[n],e);else for(var o=0,s=(t=F(t)).length;o<s;o++)this._on(t[o],e,i);return this},off:function(t,e,i){if(arguments.length)if("object"==typeof t)for(var n in t)this._off(n,t[n],e);else{t=F(t);for(var o=1===arguments.length,s=0,r=t.length;s<r;s++)o?this._off(t[s]):this._off(t[s],e,i)}else delete this._events;return this},_on:function(t,e,i,n){"function"!=typeof e?console.warn("wrong listener type: "+typeof e):!1===this._listens(t,e,i)&&(e={fn:e,ctx:i=i===this?void 0:i},n&&(e.once=!0),this._events=this._events||{},this._events[t]=this._events[t]||[],this._events[t].push(e))},_off:function(t,e,i){var n,o,s;if(this._events&&(n=this._events[t]))if(1===arguments.length){if(this._firingCount)for(o=0,s=n.length;o<s;o++)n[o].fn=u;delete this._events[t]}else"function"!=typeof e?console.warn("wrong listener type: "+typeof e):!1!==(e=this._listens(t,e,i))&&(i=n[e],this._firingCount&&(i.fn=u,this._events[t]=n=n.slice()),n.splice(e,1))},fire:function(t,e,i){if(this.listens(t,i)){var n=l({},e,{type:t,target:this,sourceTarget:e&&e.sourceTarget||this});if(this._events){var o=this._events[t];if(o){this._firingCount=this._firingCount+1||1;for(var s=0,r=o.length;s<r;s++){var a=o[s],h=a.fn;a.once&&this.off(t,h,a.ctx),h.call(a.ctx||this,n)}this._firingCount--}}i&&this._propagateEvent(n)}return this},listens:function(t,e,i,n){"string"!=typeof t&&console.warn('"string" type argument expected');var o=e,s=("function"!=typeof e&&(n=!!e,i=o=void 0),this._events&&this._events[t]);if(s&&s.length&&!1!==this._listens(t,o,i))return!0;if(n)for(var r in this._eventParents)if(this._eventParents[r].listens(t,e,i,n))return!0;return!1},_listens:function(t,e,i){if(this._events){var n=this._events[t]||[];if(!e)return!!n.length;i===this&&(i=void 0);for(var o=0,s=n.length;o<s;o++)if(n[o].fn===e&&n[o].ctx===i)return o}return!1},once:function(t,e,i){if("object"==typeof t)for(var n in t)this._on(n,t[n],e,!0);else for(var o=0,s=(t=F(t)).length;o<s;o++)this._on(t[o],e,i,!0);return this},addEventParent:function(t){return this._eventParents=this._eventParents||{},this._eventParents[h(t)]=t,this},removeEventParent:function(t){return this._eventParents&&delete this._eventParents[h(t)],this},_propagateEvent:function(t){for(var e in this._eventParents)this._eventParents[e].fire(t.type,l({layer:t.target,propagatedFrom:t.target},t),!0)}},it=(e.addEventListener=e.on,e.removeEventListener=e.clearAllEventListeners=e.off,e.addOneTimeEventListener=e.once,e.fireEvent=e.fire,e.hasEventListeners=e.listens,et.extend(e));function p(t,e,i){this.x=i?Math.round(t):t,this.y=i?Math.round(e):e}var nt=Math.trunc||function(t){return 0<t?Math.floor(t):Math.ceil(t)};function m(t,e,i){return t instanceof p?t:d(t)?new p(t[0],t[1]):null==t?t:"object"==typeof t&&"x"in t&&"y"in t?new p(t.x,t.y):new p(t,e,i)}function f(t,e){if(t)for(var i=e?[t,e]:t,n=0,o=i.length;n<o;n++)this.extend(i[n])}function _(t,e){return!t||t instanceof f?t:new f(t,e)}function s(t,e){if(t)for(var i=e?[t,e]:t,n=0,o=i.length;n<o;n++)this.extend(i[n])}function g(t,e){return t instanceof s?t:new s(t,e)}function v(t,e,i){if(isNaN(t)||isNaN(e))throw new Error("Invalid LatLng object: ("+t+", "+e+")");this.lat=+t,this.lng=+e,void 0!==i&&(this.alt=+i)}function w(t,e,i){return t instanceof v?t:d(t)&&"object"!=typeof t[0]?3===t.length?new v(t[0],t[1],t[2]):2===t.length?new v(t[0],t[1]):null:null==t?t:"object"==typeof t&&"lat"in t?new v(t.lat,"lng"in t?t.lng:t.lon,t.alt):void 0===e?null:new v(t,e,i)}p.prototype={clone:function(){return new p(this.x,this.y)},add:function(t){return this.clone()._add(m(t))},_add:function(t){return this.x+=t.x,this.y+=t.y,this},subtract:function(t){return this.clone()._subtract(m(t))},_subtract:function(t){return this.x-=t.x,this.y-=t.y,this},divideBy:function(t){return this.clone()._divideBy(t)},_divideBy:function(t){return this.x/=t,this.y/=t,this},multiplyBy:function(t){return this.clone()._multiplyBy(t)},_multiplyBy:function(t){return this.x*=t,this.y*=t,this},scaleBy:function(t){return new p(this.x*t.x,this.y*t.y)},unscaleBy:function(t){return new p(this.x/t.x,this.y/t.y)},round:function(){return this.clone()._round()},_round:function(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this},floor:function(){return this.clone()._floor()},_floor:function(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this},ceil:function(){return this.clone()._ceil()},_ceil:function(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this},trunc:function(){return this.clone()._trunc()},_trunc:function(){return this.x=nt(this.x),this.y=nt(this.y),this},distanceTo:function(t){var e=(t=m(t)).x-this.x,t=t.y-this.y;return Math.sqrt(e*e+t*t)},equals:function(t){return(t=m(t)).x===this.x&&t.y===this.y},contains:function(t){return t=m(t),Math.abs(t.x)<=Math.abs(this.x)&&Math.abs(t.y)<=Math.abs(this.y)},toString:function(){return"Point("+i(this.x)+", "+i(this.y)+")"}},f.prototype={extend:function(t){var e,i;if(t){if(t instanceof p||"number"==typeof t[0]||"x"in t)e=i=m(t);else if(e=(t=_(t)).min,i=t.max,!e||!i)return this;this.min||this.max?(this.min.x=Math.min(e.x,this.min.x),this.max.x=Math.max(i.x,this.max.x),this.min.y=Math.min(e.y,this.min.y),this.max.y=Math.max(i.y,this.max.y)):(this.min=e.clone(),this.max=i.clone())}return this},getCenter:function(t){return m((this.min.x+this.max.x)/2,(this.min.y+this.max.y)/2,t)},getBottomLeft:function(){return m(this.min.x,this.max.y)},getTopRight:function(){return m(this.max.x,this.min.y)},getTopLeft:function(){return this.min},getBottomRight:function(){return this.max},getSize:function(){return this.max.subtract(this.min)},contains:function(t){var e,i;return(t=("number"==typeof t[0]||t instanceof p?m:_)(t))instanceof f?(e=t.min,i=t.max):e=i=t,e.x>=this.min.x&&i.x<=this.max.x&&e.y>=this.min.y&&i.y<=this.max.y},intersects:function(t){t=_(t);var e=this.min,i=this.max,n=t.min,t=t.max,o=t.x>=e.x&&n.x<=i.x,t=t.y>=e.y&&n.y<=i.y;return o&&t},overlaps:function(t){t=_(t);var e=this.min,i=this.max,n=t.min,t=t.max,o=t.x>e.x&&n.x<i.x,t=t.y>e.y&&n.y<i.y;return o&&t},isValid:function(){return!(!this.min||!this.max)},pad:function(t){var e=this.min,i=this.max,n=Math.abs(e.x-i.x)*t,t=Math.abs(e.y-i.y)*t;return _(m(e.x-n,e.y-t),m(i.x+n,i.y+t))},equals:function(t){return!!t&&(t=_(t),this.min.equals(t.getTopLeft())&&this.max.equals(t.getBottomRight()))}},s.prototype={extend:function(t){var e,i,n=this._southWest,o=this._northEast;if(t instanceof v)i=e=t;else{if(!(t instanceof s))return t?this.extend(w(t)||g(t)):this;if(e=t._southWest,i=t._northEast,!e||!i)return this}return n||o?(n.lat=Math.min(e.lat,n.lat),n.lng=Math.min(e.lng,n.lng),o.lat=Math.max(i.lat,o.lat),o.lng=Math.max(i.lng,o.lng)):(this._southWest=new v(e.lat,e.lng),this._northEast=new v(i.lat,i.lng)),this},pad:function(t){var e=this._southWest,i=this._northEast,n=Math.abs(e.lat-i.lat)*t,t=Math.abs(e.lng-i.lng)*t;return new s(new v(e.lat-n,e.lng-t),new v(i.lat+n,i.lng+t))},getCenter:function(){return new v((this._southWest.lat+this._northEast.lat)/2,(this._southWest.lng+this._northEast.lng)/2)},getSouthWest:function(){return this._southWest},getNorthEast:function(){return this._northEast},getNorthWest:function(){return new v(this.getNorth(),this.getWest())},getSouthEast:function(){return new v(this.getSouth(),this.getEast())},getWest:function(){return this._southWest.lng},getSouth:function(){return this._southWest.lat},getEast:function(){return this._northEast.lng},getNorth:function(){return this._northEast.lat},contains:function(t){t=("number"==typeof t[0]||t instanceof v||"lat"in t?w:g)(t);var e,i,n=this._southWest,o=this._northEast;return t instanceof s?(e=t.getSouthWest(),i=t.getNorthEast()):e=i=t,e.lat>=n.lat&&i.lat<=o.lat&&e.lng>=n.lng&&i.lng<=o.lng},intersects:function(t){t=g(t);var e=this._southWest,i=this._northEast,n=t.getSouthWest(),t=t.getNorthEast(),o=t.lat>=e.lat&&n.lat<=i.lat,t=t.lng>=e.lng&&n.lng<=i.lng;return o&&t},overlaps:function(t){t=g(t);var e=this._southWest,i=this._northEast,n=t.getSouthWest(),t=t.getNorthEast(),o=t.lat>e.lat&&n.lat<i.lat,t=t.lng>e.lng&&n.lng<i.lng;return o&&t},toBBoxString:function(){return[this.getWest(),this.getSouth(),this.getEast(),this.getNorth()].join(",")},equals:function(t,e){return!!t&&(t=g(t),this._southWest.equals(t.getSouthWest(),e)&&this._northEast.equals(t.getNorthEast(),e))},isValid:function(){return!(!this._southWest||!this._northEast)}};var ot={latLngToPoint:function(t,e){t=this.projection.project(t),e=this.scale(e);return this.transformation._transform(t,e)},pointToLatLng:function(t,e){e=this.scale(e),t=this.transformation.untransform(t,e);return this.projection.unproject(t)},project:function(t){return this.projection.project(t)},unproject:function(t){return this.projection.unproject(t)},scale:function(t){return 256*Math.pow(2,t)},zoom:function(t){return Math.log(t/256)/Math.LN2},getProjectedBounds:function(t){var e;return this.infinite?null:(e=this.projection.bounds,t=this.scale(t),new f(this.transformation.transform(e.min,t),this.transformation.transform(e.max,t)))},infinite:!(v.prototype={equals:function(t,e){return!!t&&(t=w(t),Math.max(Math.abs(this.lat-t.lat),Math.abs(this.lng-t.lng))<=(void 0===e?1e-9:e))},toString:function(t){return"LatLng("+i(this.lat,t)+", "+i(this.lng,t)+")"},distanceTo:function(t){return st.distance(this,w(t))},wrap:function(){return st.wrapLatLng(this)},toBounds:function(t){var t=180*t/40075017,e=t/Math.cos(Math.PI/180*this.lat);return g([this.lat-t,this.lng-e],[this.lat+t,this.lng+e])},clone:function(){return new v(this.lat,this.lng,this.alt)}}),wrapLatLng:function(t){var e=this.wrapLng?H(t.lng,this.wrapLng,!0):t.lng;return new v(this.wrapLat?H(t.lat,this.wrapLat,!0):t.lat,e,t.alt)},wrapLatLngBounds:function(t){var e=t.getCenter(),i=this.wrapLatLng(e),n=e.lat-i.lat,e=e.lng-i.lng;return 0==n&&0==e?t:(i=t.getSouthWest(),t=t.getNorthEast(),new s(new v(i.lat-n,i.lng-e),new v(t.lat-n,t.lng-e)))}},st=l({},ot,{wrapLng:[-180,180],R:6371e3,distance:function(t,e){var i=Math.PI/180,n=t.lat*i,o=e.lat*i,s=Math.sin((e.lat-t.lat)*i/2),e=Math.sin((e.lng-t.lng)*i/2),t=s*s+Math.cos(n)*Math.cos(o)*e*e,i=2*Math.atan2(Math.sqrt(t),Math.sqrt(1-t));return this.R*i}}),rt=6378137,rt={R:rt,MAX_LATITUDE:85.0511287798,project:function(t){var e=Math.PI/180,i=this.MAX_LATITUDE,i=Math.max(Math.min(i,t.lat),-i),i=Math.sin(i*e);return new p(this.R*t.lng*e,this.R*Math.log((1+i)/(1-i))/2)},unproject:function(t){var e=180/Math.PI;return new v((2*Math.atan(Math.exp(t.y/this.R))-Math.PI/2)*e,t.x*e/this.R)},bounds:new f([-(rt=rt*Math.PI),-rt],[rt,rt])};function at(t,e,i,n){d(t)?(this._a=t[0],this._b=t[1],this._c=t[2],this._d=t[3]):(this._a=t,this._b=e,this._c=i,this._d=n)}function ht(t,e,i,n){return new at(t,e,i,n)}at.prototype={transform:function(t,e){return this._transform(t.clone(),e)},_transform:function(t,e){return t.x=(e=e||1)*(this._a*t.x+this._b),t.y=e*(this._c*t.y+this._d),t},untransform:function(t,e){return new p((t.x/(e=e||1)-this._b)/this._a,(t.y/e-this._d)/this._c)}};var lt=l({},st,{code:"EPSG:3857",projection:rt,transformation:ht(lt=.5/(Math.PI*rt.R),.5,-lt,.5)}),ut=l({},lt,{code:"EPSG:900913"});function ct(t){return document.createElementNS("http://www.w3.org/2000/svg",t)}function dt(t,e){for(var i,n,o,s,r="",a=0,h=t.length;a<h;a++){for(i=0,n=(o=t[a]).length;i<n;i++)r+=(i?"L":"M")+(s=o[i]).x+" "+s.y;r+=e?b.svg?"z":"x":""}return r||"M0 0"}var _t=document.documentElement.style,pt="ActiveXObject"in window,mt=pt&&!document.addEventListener,n="msLaunchUri"in navigator&&!("documentMode"in document),ft=y("webkit"),gt=y("android"),vt=y("android 2")||y("android 3"),yt=parseInt(/WebKit\/([0-9]+)|$/.exec(navigator.userAgent)[1],10),yt=gt&&y("Google")&&yt<537&&!("AudioNode"in window),xt=!!window.opera,wt=!n&&y("chrome"),bt=y("gecko")&&!ft&&!xt&&!pt,Pt=!wt&&y("safari"),Lt=y("phantom"),o="OTransition"in _t,Tt=0===navigator.platform.indexOf("Win"),Mt=pt&&"transition"in _t,zt="WebKitCSSMatrix"in window&&"m11"in new window.WebKitCSSMatrix&&!vt,_t="MozPerspective"in _t,Ct=!window.L_DISABLE_3D&&(Mt||zt||_t)&&!o&&!Lt,Zt="undefined"!=typeof orientation||y("mobile"),St=Zt&&ft,Et=Zt&&zt,kt=!window.PointerEvent&&window.MSPointerEvent,Ot=!(!window.PointerEvent&&!kt),At="ontouchstart"in window||!!window.TouchEvent,Bt=!window.L_NO_TOUCH&&(At||Ot),It=Zt&&xt,Rt=Zt&&bt,Nt=1<(window.devicePixelRatio||window.screen.deviceXDPI/window.screen.logicalXDPI),Dt=function(){var t=!1;try{var e=Object.defineProperty({},"passive",{get:function(){t=!0}});window.addEventListener("testPassiveEventSupport",u,e),window.removeEventListener("testPassiveEventSupport",u,e)}catch(t){}return t}(),jt=!!document.createElement("canvas").getContext,Ht=!(!document.createElementNS||!ct("svg").createSVGRect),Wt=!!Ht&&((Wt=document.createElement("div")).innerHTML="<svg/>","http://www.w3.org/2000/svg"===(Wt.firstChild&&Wt.firstChild.namespaceURI));function y(t){return 0<=navigator.userAgent.toLowerCase().indexOf(t)}var b={ie:pt,ielt9:mt,edge:n,webkit:ft,android:gt,android23:vt,androidStock:yt,opera:xt,chrome:wt,gecko:bt,safari:Pt,phantom:Lt,opera12:o,win:Tt,ie3d:Mt,webkit3d:zt,gecko3d:_t,any3d:Ct,mobile:Zt,mobileWebkit:St,mobileWebkit3d:Et,msPointer:kt,pointer:Ot,touch:Bt,touchNative:At,mobileOpera:It,mobileGecko:Rt,retina:Nt,passiveEvents:Dt,canvas:jt,svg:Ht,vml:!Ht&&function(){try{var t=document.createElement("div"),e=(t.innerHTML='<v:shape adj="1"/>',t.firstChild);return e.style.behavior="url(#default#VML)",e&&"object"==typeof e.adj}catch(t){return!1}}(),inlineSvg:Wt,mac:0===navigator.platform.indexOf("Mac"),linux:0===navigator.platform.indexOf("Linux")},Ft=b.msPointer?"MSPointerDown":"pointerdown",Ut=b.msPointer?"MSPointerMove":"pointermove",Vt=b.msPointer?"MSPointerUp":"pointerup",qt=b.msPointer?"MSPointerCancel":"pointercancel",Gt={touchstart:Ft,touchmove:Ut,touchend:Vt,touchcancel:qt},Kt={touchstart:function(t,e){e.MSPOINTER_TYPE_TOUCH&&e.pointerType===e.MSPOINTER_TYPE_TOUCH&&O(e);ee(t,e)},touchmove:ee,touchend:ee,touchcancel:ee},Yt={},Xt=!1;function Jt(t,e,i){return"touchstart"!==e||Xt||(document.addEventListener(Ft,$t,!0),document.addEventListener(Ut,Qt,!0),document.addEventListener(Vt,te,!0),document.addEventListener(qt,te,!0),Xt=!0),Kt[e]?(i=Kt[e].bind(this,i),t.addEventListener(Gt[e],i,!1),i):(console.warn("wrong event specified:",e),u)}function $t(t){Yt[t.pointerId]=t}function Qt(t){Yt[t.pointerId]&&(Yt[t.pointerId]=t)}function te(t){delete Yt[t.pointerId]}function ee(t,e){if(e.pointerType!==(e.MSPOINTER_TYPE_MOUSE||"mouse")){for(var i in e.touches=[],Yt)e.touches.push(Yt[i]);e.changedTouches=[e],t(e)}}var ie=200;function ne(t,i){t.addEventListener("dblclick",i);var n,o=0;function e(t){var e;1!==t.detail?n=t.detail:"mouse"===t.pointerType||t.sourceCapabilities&&!t.sourceCapabilities.firesTouchEvents||((e=Ne(t)).some(function(t){return t instanceof HTMLLabelElement&&t.attributes.for})&&!e.some(function(t){return t instanceof HTMLInputElement||t instanceof HTMLSelectElement})||((e=Date.now())-o<=ie?2===++n&&i(function(t){var e,i,n={};for(i in t)e=t[i],n[i]=e&&e.bind?e.bind(t):e;return(t=n).type="dblclick",n.detail=2,n.isTrusted=!1,n._simulated=!0,n}(t)):n=1,o=e))}return t.addEventListener("click",e),{dblclick:i,simDblclick:e}}var oe,se,re,ae,he,le,ue=we(["transform","webkitTransform","OTransform","MozTransform","msTransform"]),ce=we(["webkitTransition","transition","OTransition","MozTransition","msTransition"]),de="webkitTransition"===ce||"OTransition"===ce?ce+"End":"transitionend";function _e(t){return"string"==typeof t?document.getElementById(t):t}function pe(t,e){var i=t.style[e]||t.currentStyle&&t.currentStyle[e];return"auto"===(i=i&&"auto"!==i||!document.defaultView?i:(t=document.defaultView.getComputedStyle(t,null))?t[e]:null)?null:i}function P(t,e,i){t=document.createElement(t);return t.className=e||"",i&&i.appendChild(t),t}function T(t){var e=t.parentNode;e&&e.removeChild(t)}function me(t){for(;t.firstChild;)t.removeChild(t.firstChild)}function fe(t){var e=t.parentNode;e&&e.lastChild!==t&&e.appendChild(t)}function ge(t){var e=t.parentNode;e&&e.firstChild!==t&&e.insertBefore(t,e.firstChild)}function ve(t,e){return void 0!==t.classList?t.classList.contains(e):0<(t=xe(t)).length&&new RegExp("(^|\\s)"+e+"(\\s|$)").test(t)}function M(t,e){var i;if(void 0!==t.classList)for(var n=F(e),o=0,s=n.length;o<s;o++)t.classList.add(n[o]);else ve(t,e)||ye(t,((i=xe(t))?i+" ":"")+e)}function z(t,e){void 0!==t.classList?t.classList.remove(e):ye(t,W((" "+xe(t)+" ").replace(" "+e+" "," ")))}function ye(t,e){void 0===t.className.baseVal?t.className=e:t.className.baseVal=e}function xe(t){return void 0===(t=t.correspondingElement?t.correspondingElement:t).className.baseVal?t.className:t.className.baseVal}function C(t,e){if("opacity"in t.style)t.style.opacity=e;else if("filter"in t.style){var i=!1,n="DXImageTransform.Microsoft.Alpha";try{i=t.filters.item(n)}catch(t){if(1===e)return}e=Math.round(100*e),i?(i.Enabled=100!==e,i.Opacity=e):t.style.filter+=" progid:"+n+"(opacity="+e+")"}}function we(t){for(var e=document.documentElement.style,i=0;i<t.length;i++)if(t[i]in e)return t[i];return!1}function be(t,e,i){e=e||new p(0,0);t.style[ue]=(b.ie3d?"translate("+e.x+"px,"+e.y+"px)":"translate3d("+e.x+"px,"+e.y+"px,0)")+(i?" scale("+i+")":"")}function Z(t,e){t._leaflet_pos=e,b.any3d?be(t,e):(t.style.left=e.x+"px",t.style.top=e.y+"px")}function Pe(t){return t._leaflet_pos||new p(0,0)}function Le(){S(window,"dragstart",O)}function Te(){k(window,"dragstart",O)}function Me(t){for(;-1===t.tabIndex;)t=t.parentNode;t.style&&(ze(),le=(he=t).style.outlineStyle,t.style.outlineStyle="none",S(window,"keydown",ze))}function ze(){he&&(he.style.outlineStyle=le,le=he=void 0,k(window,"keydown",ze))}function Ce(t){for(;!((t=t.parentNode).offsetWidth&&t.offsetHeight||t===document.body););return t}function Ze(t){var e=t.getBoundingClientRect();return{x:e.width/t.offsetWidth||1,y:e.height/t.offsetHeight||1,boundingClientRect:e}}ae="onselectstart"in document?(re=function(){S(window,"selectstart",O)},function(){k(window,"selectstart",O)}):(se=we(["userSelect","WebkitUserSelect","OUserSelect","MozUserSelect","msUserSelect"]),re=function(){var t;se&&(t=document.documentElement.style,oe=t[se],t[se]="none")},function(){se&&(document.documentElement.style[se]=oe,oe=void 0)});pt={__proto__:null,TRANSFORM:ue,TRANSITION:ce,TRANSITION_END:de,get:_e,getStyle:pe,create:P,remove:T,empty:me,toFront:fe,toBack:ge,hasClass:ve,addClass:M,removeClass:z,setClass:ye,getClass:xe,setOpacity:C,testProp:we,setTransform:be,setPosition:Z,getPosition:Pe,get disableTextSelection(){return re},get enableTextSelection(){return ae},disableImageDrag:Le,enableImageDrag:Te,preventOutline:Me,restoreOutline:ze,getSizedParentNode:Ce,getScale:Ze};function S(t,e,i,n){if(e&&"object"==typeof e)for(var o in e)ke(t,o,e[o],i);else for(var s=0,r=(e=F(e)).length;s<r;s++)ke(t,e[s],i,n);return this}var E="_leaflet_events";function k(t,e,i,n){if(1===arguments.length)Se(t),delete t[E];else if(e&&"object"==typeof e)for(var o in e)Oe(t,o,e[o],i);else if(e=F(e),2===arguments.length)Se(t,function(t){return-1!==G(e,t)});else for(var s=0,r=e.length;s<r;s++)Oe(t,e[s],i,n);return this}function Se(t,e){for(var i in t[E]){var n=i.split(/\d/)[0];e&&!e(n)||Oe(t,n,null,null,i)}}var Ee={mouseenter:"mouseover",mouseleave:"mouseout",wheel:!("onwheel"in window)&&"mousewheel"};function ke(e,t,i,n){var o,s,r=t+h(i)+(n?"_"+h(n):"");e[E]&&e[E][r]||(s=o=function(t){return i.call(n||e,t||window.event)},!b.touchNative&&b.pointer&&0===t.indexOf("touch")?o=Jt(e,t,o):b.touch&&"dblclick"===t?o=ne(e,o):"addEventListener"in e?"touchstart"===t||"touchmove"===t||"wheel"===t||"mousewheel"===t?e.addEventListener(Ee[t]||t,o,!!b.passiveEvents&&{passive:!1}):"mouseenter"===t||"mouseleave"===t?e.addEventListener(Ee[t],o=function(t){t=t||window.event,We(e,t)&&s(t)},!1):e.addEventListener(t,s,!1):e.attachEvent("on"+t,o),e[E]=e[E]||{},e[E][r]=o)}function Oe(t,e,i,n,o){o=o||e+h(i)+(n?"_"+h(n):"");var s,r,i=t[E]&&t[E][o];i&&(!b.touchNative&&b.pointer&&0===e.indexOf("touch")?(n=t,r=i,Gt[s=e]?n.removeEventListener(Gt[s],r,!1):console.warn("wrong event specified:",s)):b.touch&&"dblclick"===e?(n=i,(r=t).removeEventListener("dblclick",n.dblclick),r.removeEventListener("click",n.simDblclick)):"removeEventListener"in t?t.removeEventListener(Ee[e]||e,i,!1):t.detachEvent("on"+e,i),t[E][o]=null)}function Ae(t){return t.stopPropagation?t.stopPropagation():t.originalEvent?t.originalEvent._stopped=!0:t.cancelBubble=!0,this}function Be(t){return ke(t,"wheel",Ae),this}function Ie(t){return S(t,"mousedown touchstart dblclick contextmenu",Ae),t._leaflet_disable_click=!0,this}function O(t){return t.preventDefault?t.preventDefault():t.returnValue=!1,this}function Re(t){return O(t),Ae(t),this}function Ne(t){if(t.composedPath)return t.composedPath();for(var e=[],i=t.target;i;)e.push(i),i=i.parentNode;return e}function De(t,e){var i,n;return e?(n=(i=Ze(e)).boundingClientRect,new p((t.clientX-n.left)/i.x-e.clientLeft,(t.clientY-n.top)/i.y-e.clientTop)):new p(t.clientX,t.clientY)}var je=b.linux&&b.chrome?window.devicePixelRatio:b.mac?3*window.devicePixelRatio:0<window.devicePixelRatio?2*window.devicePixelRatio:1;function He(t){return b.edge?t.wheelDeltaY/2:t.deltaY&&0===t.deltaMode?-t.deltaY/je:t.deltaY&&1===t.deltaMode?20*-t.deltaY:t.deltaY&&2===t.deltaMode?60*-t.deltaY:t.deltaX||t.deltaZ?0:t.wheelDelta?(t.wheelDeltaY||t.wheelDelta)/2:t.detail&&Math.abs(t.detail)<32765?20*-t.detail:t.detail?t.detail/-32765*60:0}function We(t,e){var i=e.relatedTarget;if(!i)return!0;try{for(;i&&i!==t;)i=i.parentNode}catch(t){return!1}return i!==t}var mt={__proto__:null,on:S,off:k,stopPropagation:Ae,disableScrollPropagation:Be,disableClickPropagation:Ie,preventDefault:O,stop:Re,getPropagationPath:Ne,getMousePosition:De,getWheelDelta:He,isExternalTarget:We,addListener:S,removeListener:k},Fe=it.extend({run:function(t,e,i,n){this.stop(),this._el=t,this._inProgress=!0,this._duration=i||.25,this._easeOutPower=1/Math.max(n||.5,.2),this._startPos=Pe(t),this._offset=e.subtract(this._startPos),this._startTime=+new Date,this.fire("start"),this._animate()},stop:function(){this._inProgress&&(this._step(!0),this._complete())},_animate:function(){this._animId=x(this._animate,this),this._step()},_step:function(t){var e=+new Date-this._startTime,i=1e3*this._duration;e<i?this._runFrame(this._easeOut(e/i),t):(this._runFrame(1),this._complete())},_runFrame:function(t,e){t=this._startPos.add(this._offset.multiplyBy(t));e&&t._round(),Z(this._el,t),this.fire("step")},_complete:function(){r(this._animId),this._inProgress=!1,this.fire("end")},_easeOut:function(t){return 1-Math.pow(1-t,this._easeOutPower)}}),A=it.extend({options:{crs:lt,center:void 0,zoom:void 0,minZoom:void 0,maxZoom:void 0,layers:[],maxBounds:void 0,renderer:void 0,zoomAnimation:!0,zoomAnimationThreshold:4,fadeAnimation:!0,markerZoomAnimation:!0,transform3DLimit:8388608,zoomSnap:1,zoomDelta:1,trackResize:!0},initialize:function(t,e){e=c(this,e),this._handlers=[],this._layers={},this._zoomBoundLayers={},this._sizeChanged=!0,this._initContainer(t),this._initLayout(),this._onResize=a(this._onResize,this),this._initEvents(),e.maxBounds&&this.setMaxBounds(e.maxBounds),void 0!==e.zoom&&(this._zoom=this._limitZoom(e.zoom)),e.center&&void 0!==e.zoom&&this.setView(w(e.center),e.zoom,{reset:!0}),this.callInitHooks(),this._zoomAnimated=ce&&b.any3d&&!b.mobileOpera&&this.options.zoomAnimation,this._zoomAnimated&&(this._createAnimProxy(),S(this._proxy,de,this._catchTransitionEnd,this)),this._addLayers(this.options.layers)},setView:function(t,e,i){if((e=void 0===e?this._zoom:this._limitZoom(e),t=this._limitCenter(w(t),e,this.options.maxBounds),i=i||{},this._stop(),this._loaded&&!i.reset&&!0!==i)&&(void 0!==i.animate&&(i.zoom=l({animate:i.animate},i.zoom),i.pan=l({animate:i.animate,duration:i.duration},i.pan)),this._zoom!==e?this._tryAnimatedZoom&&this._tryAnimatedZoom(t,e,i.zoom):this._tryAnimatedPan(t,i.pan)))return clearTimeout(this._sizeTimer),this;return this._resetView(t,e,i.pan&&i.pan.noMoveStart),this},setZoom:function(t,e){return this._loaded?this.setView(this.getCenter(),t,{zoom:e}):(this._zoom=t,this)},zoomIn:function(t,e){return t=t||(b.any3d?this.options.zoomDelta:1),this.setZoom(this._zoom+t,e)},zoomOut:function(t,e){return t=t||(b.any3d?this.options.zoomDelta:1),this.setZoom(this._zoom-t,e)},setZoomAround:function(t,e,i){var n=this.getZoomScale(e),o=this.getSize().divideBy(2),t=(t instanceof p?t:this.latLngToContainerPoint(t)).subtract(o).multiplyBy(1-1/n),n=this.containerPointToLatLng(o.add(t));return this.setView(n,e,{zoom:i})},_getBoundsCenterZoom:function(t,e){e=e||{},t=t.getBounds?t.getBounds():g(t);var i=m(e.paddingTopLeft||e.padding||[0,0]),n=m(e.paddingBottomRight||e.padding||[0,0]),o=this.getBoundsZoom(t,!1,i.add(n));return(o="number"==typeof e.maxZoom?Math.min(e.maxZoom,o):o)===1/0?{center:t.getCenter(),zoom:o}:(e=n.subtract(i).divideBy(2),n=this.project(t.getSouthWest(),o),i=this.project(t.getNorthEast(),o),{center:this.unproject(n.add(i).divideBy(2).add(e),o),zoom:o})},fitBounds:function(t,e){if((t=g(t)).isValid())return t=this._getBoundsCenterZoom(t,e),this.setView(t.center,t.zoom,e);throw new Error("Bounds are not valid.")},fitWorld:function(t){return this.fitBounds([[-90,-180],[90,180]],t)},panTo:function(t,e){return this.setView(t,this._zoom,{pan:e})},panBy:function(t,e){var i;return e=e||{},(t=m(t).round()).x||t.y?(!0===e.animate||this.getSize().contains(t)?(this._panAnim||(this._panAnim=new Fe,this._panAnim.on({step:this._onPanTransitionStep,end:this._onPanTransitionEnd},this)),e.noMoveStart||this.fire("movestart"),!1!==e.animate?(M(this._mapPane,"leaflet-pan-anim"),i=this._getMapPanePos().subtract(t).round(),this._panAnim.run(this._mapPane,i,e.duration||.25,e.easeLinearity)):(this._rawPanBy(t),this.fire("move").fire("moveend"))):this._resetView(this.unproject(this.project(this.getCenter()).add(t)),this.getZoom()),this):this.fire("moveend")},flyTo:function(n,o,t){if(!1===(t=t||{}).animate||!b.any3d)return this.setView(n,o,t);this._stop();var s=this.project(this.getCenter()),r=this.project(n),e=this.getSize(),a=this._zoom,h=(n=w(n),o=void 0===o?a:o,Math.max(e.x,e.y)),i=h*this.getZoomScale(a,o),l=r.distanceTo(s)||1,u=1.42,c=u*u;function d(t){t=(i*i-h*h+(t?-1:1)*c*c*l*l)/(2*(t?i:h)*c*l),t=Math.sqrt(t*t+1)-t;return t<1e-9?-18:Math.log(t)}function _(t){return(Math.exp(t)-Math.exp(-t))/2}function p(t){return(Math.exp(t)+Math.exp(-t))/2}var m=d(0);function f(t){return h*(p(m)*(_(t=m+u*t)/p(t))-_(m))/c}var g=Date.now(),v=(d(1)-m)/u,y=t.duration?1e3*t.duration:1e3*v*.8;return this._moveStart(!0,t.noMoveStart),function t(){var e=(Date.now()-g)/y,i=(1-Math.pow(1-e,1.5))*v;e<=1?(this._flyToFrame=x(t,this),this._move(this.unproject(s.add(r.subtract(s).multiplyBy(f(i)/l)),a),this.getScaleZoom(h/(e=i,h*(p(m)/p(m+u*e))),a),{flyTo:!0})):this._move(n,o)._moveEnd(!0)}.call(this),this},flyToBounds:function(t,e){t=this._getBoundsCenterZoom(t,e);return this.flyTo(t.center,t.zoom,e)},setMaxBounds:function(t){return t=g(t),this.listens("moveend",this._panInsideMaxBounds)&&this.off("moveend",this._panInsideMaxBounds),t.isValid()?(this.options.maxBounds=t,this._loaded&&this._panInsideMaxBounds(),this.on("moveend",this._panInsideMaxBounds)):(this.options.maxBounds=null,this)},setMinZoom:function(t){var e=this.options.minZoom;return this.options.minZoom=t,this._loaded&&e!==t&&(this.fire("zoomlevelschange"),this.getZoom()<this.options.minZoom)?this.setZoom(t):this},setMaxZoom:function(t){var e=this.options.maxZoom;return this.options.maxZoom=t,this._loaded&&e!==t&&(this.fire("zoomlevelschange"),this.getZoom()>this.options.maxZoom)?this.setZoom(t):this},panInsideBounds:function(t,e){this._enforcingBounds=!0;var i=this.getCenter(),t=this._limitCenter(i,this._zoom,g(t));return i.equals(t)||this.panTo(t,e),this._enforcingBounds=!1,this},panInside:function(t,e){var i=m((e=e||{}).paddingTopLeft||e.padding||[0,0]),n=m(e.paddingBottomRight||e.padding||[0,0]),o=this.project(this.getCenter()),t=this.project(t),s=this.getPixelBounds(),i=_([s.min.add(i),s.max.subtract(n)]),s=i.getSize();return i.contains(t)||(this._enforcingBounds=!0,n=t.subtract(i.getCenter()),i=i.extend(t).getSize().subtract(s),o.x+=n.x<0?-i.x:i.x,o.y+=n.y<0?-i.y:i.y,this.panTo(this.unproject(o),e),this._enforcingBounds=!1),this},invalidateSize:function(t){if(!this._loaded)return this;t=l({animate:!1,pan:!0},!0===t?{animate:!0}:t);var e=this.getSize(),i=(this._sizeChanged=!0,this._lastCenter=null,this.getSize()),n=e.divideBy(2).round(),o=i.divideBy(2).round(),n=n.subtract(o);return n.x||n.y?(t.animate&&t.pan?this.panBy(n):(t.pan&&this._rawPanBy(n),this.fire("move"),t.debounceMoveend?(clearTimeout(this._sizeTimer),this._sizeTimer=setTimeout(a(this.fire,this,"moveend"),200)):this.fire("moveend")),this.fire("resize",{oldSize:e,newSize:i})):this},stop:function(){return this.setZoom(this._limitZoom(this._zoom)),this.options.zoomSnap||this.fire("viewreset"),this._stop()},locate:function(t){var e,i;return t=this._locateOptions=l({timeout:1e4,watch:!1},t),"geolocation"in navigator?(e=a(this._handleGeolocationResponse,this),i=a(this._handleGeolocationError,this),t.watch?this._locationWatchId=navigator.geolocation.watchPosition(e,i,t):navigator.geolocation.getCurrentPosition(e,i,t)):this._handleGeolocationError({code:0,message:"Geolocation not supported."}),this},stopLocate:function(){return navigator.geolocation&&navigator.geolocation.clearWatch&&navigator.geolocation.clearWatch(this._locationWatchId),this._locateOptions&&(this._locateOptions.setView=!1),this},_handleGeolocationError:function(t){var e;this._container._leaflet_id&&(e=t.code,t=t.message||(1===e?"permission denied":2===e?"position unavailable":"timeout"),this._locateOptions.setView&&!this._loaded&&this.fitWorld(),this.fire("locationerror",{code:e,message:"Geolocation error: "+t+"."}))},_handleGeolocationResponse:function(t){if(this._container._leaflet_id){var e,i,n=new v(t.coords.latitude,t.coords.longitude),o=n.toBounds(2*t.coords.accuracy),s=this._locateOptions,r=(s.setView&&(e=this.getBoundsZoom(o),this.setView(n,s.maxZoom?Math.min(e,s.maxZoom):e)),{latlng:n,bounds:o,timestamp:t.timestamp});for(i in t.coords)"number"==typeof t.coords[i]&&(r[i]=t.coords[i]);this.fire("locationfound",r)}},addHandler:function(t,e){return e&&(e=this[t]=new e(this),this._handlers.push(e),this.options[t]&&e.enable()),this},remove:function(){if(this._initEvents(!0),this.options.maxBounds&&this.off("moveend",this._panInsideMaxBounds),this._containerId!==this._container._leaflet_id)throw new Error("Map container is being reused by another instance");try{delete this._container._leaflet_id,delete this._containerId}catch(t){this._container._leaflet_id=void 0,this._containerId=void 0}for(var t in void 0!==this._locationWatchId&&this.stopLocate(),this._stop(),T(this._mapPane),this._clearControlPos&&this._clearControlPos(),this._resizeRequest&&(r(this._resizeRequest),this._resizeRequest=null),this._clearHandlers(),this._loaded&&this.fire("unload"),this._layers)this._layers[t].remove();for(t in this._panes)T(this._panes[t]);return this._layers=[],this._panes=[],delete this._mapPane,delete this._renderer,this},createPane:function(t,e){e=P("div","leaflet-pane"+(t?" leaflet-"+t.replace("Pane","")+"-pane":""),e||this._mapPane);return t&&(this._panes[t]=e),e},getCenter:function(){return this._checkIfLoaded(),this._lastCenter&&!this._moved()?this._lastCenter.clone():this.layerPointToLatLng(this._getCenterLayerPoint())},getZoom:function(){return this._zoom},getBounds:function(){var t=this.getPixelBounds();return new s(this.unproject(t.getBottomLeft()),this.unproject(t.getTopRight()))},getMinZoom:function(){return void 0===this.options.minZoom?this._layersMinZoom||0:this.options.minZoom},getMaxZoom:function(){return void 0===this.options.maxZoom?void 0===this._layersMaxZoom?1/0:this._layersMaxZoom:this.options.maxZoom},getBoundsZoom:function(t,e,i){t=g(t),i=m(i||[0,0]);var n=this.getZoom()||0,o=this.getMinZoom(),s=this.getMaxZoom(),r=t.getNorthWest(),t=t.getSouthEast(),i=this.getSize().subtract(i),t=_(this.project(t,n),this.project(r,n)).getSize(),r=b.any3d?this.options.zoomSnap:1,a=i.x/t.x,i=i.y/t.y,t=e?Math.max(a,i):Math.min(a,i),n=this.getScaleZoom(t,n);return r&&(n=Math.round(n/(r/100))*(r/100),n=e?Math.ceil(n/r)*r:Math.floor(n/r)*r),Math.max(o,Math.min(s,n))},getSize:function(){return this._size&&!this._sizeChanged||(this._size=new p(this._container.clientWidth||0,this._container.clientHeight||0),this._sizeChanged=!1),this._size.clone()},getPixelBounds:function(t,e){t=this._getTopLeftPoint(t,e);return new f(t,t.add(this.getSize()))},getPixelOrigin:function(){return this._checkIfLoaded(),this._pixelOrigin},getPixelWorldBounds:function(t){return this.options.crs.getProjectedBounds(void 0===t?this.getZoom():t)},getPane:function(t){return"string"==typeof t?this._panes[t]:t},getPanes:function(){return this._panes},getContainer:function(){return this._container},getZoomScale:function(t,e){var i=this.options.crs;return e=void 0===e?this._zoom:e,i.scale(t)/i.scale(e)},getScaleZoom:function(t,e){var i=this.options.crs,t=(e=void 0===e?this._zoom:e,i.zoom(t*i.scale(e)));return isNaN(t)?1/0:t},project:function(t,e){return e=void 0===e?this._zoom:e,this.options.crs.latLngToPoint(w(t),e)},unproject:function(t,e){return e=void 0===e?this._zoom:e,this.options.crs.pointToLatLng(m(t),e)},layerPointToLatLng:function(t){t=m(t).add(this.getPixelOrigin());return this.unproject(t)},latLngToLayerPoint:function(t){return this.project(w(t))._round()._subtract(this.getPixelOrigin())},wrapLatLng:function(t){return this.options.crs.wrapLatLng(w(t))},wrapLatLngBounds:function(t){return this.options.crs.wrapLatLngBounds(g(t))},distance:function(t,e){return this.options.crs.distance(w(t),w(e))},containerPointToLayerPoint:function(t){return m(t).subtract(this._getMapPanePos())},layerPointToContainerPoint:function(t){return m(t).add(this._getMapPanePos())},containerPointToLatLng:function(t){t=this.containerPointToLayerPoint(m(t));return this.layerPointToLatLng(t)},latLngToContainerPoint:function(t){return this.layerPointToContainerPoint(this.latLngToLayerPoint(w(t)))},mouseEventToContainerPoint:function(t){return De(t,this._container)},mouseEventToLayerPoint:function(t){return this.containerPointToLayerPoint(this.mouseEventToContainerPoint(t))},mouseEventToLatLng:function(t){return this.layerPointToLatLng(this.mouseEventToLayerPoint(t))},_initContainer:function(t){t=this._container=_e(t);if(!t)throw new Error("Map container not found.");if(t._leaflet_id)throw new Error("Map container is already initialized.");S(t,"scroll",this._onScroll,this),this._containerId=h(t)},_initLayout:function(){var t=this._container,e=(this._fadeAnimated=this.options.fadeAnimation&&b.any3d,M(t,"leaflet-container"+(b.touch?" leaflet-touch":"")+(b.retina?" leaflet-retina":"")+(b.ielt9?" leaflet-oldie":"")+(b.safari?" leaflet-safari":"")+(this._fadeAnimated?" leaflet-fade-anim":"")),pe(t,"position"));"absolute"!==e&&"relative"!==e&&"fixed"!==e&&"sticky"!==e&&(t.style.position="relative"),this._initPanes(),this._initControlPos&&this._initControlPos()},_initPanes:function(){var t=this._panes={};this._paneRenderers={},this._mapPane=this.createPane("mapPane",this._container),Z(this._mapPane,new p(0,0)),this.createPane("tilePane"),this.createPane("overlayPane"),this.createPane("shadowPane"),this.createPane("markerPane"),this.createPane("tooltipPane"),this.createPane("popupPane"),this.options.markerZoomAnimation||(M(t.markerPane,"leaflet-zoom-hide"),M(t.shadowPane,"leaflet-zoom-hide"))},_resetView:function(t,e,i){Z(this._mapPane,new p(0,0));var n=!this._loaded,o=(this._loaded=!0,e=this._limitZoom(e),this.fire("viewprereset"),this._zoom!==e);this._moveStart(o,i)._move(t,e)._moveEnd(o),this.fire("viewreset"),n&&this.fire("load")},_moveStart:function(t,e){return t&&this.fire("zoomstart"),e||this.fire("movestart"),this},_move:function(t,e,i,n){void 0===e&&(e=this._zoom);var o=this._zoom!==e;return this._zoom=e,this._lastCenter=t,this._pixelOrigin=this._getNewPixelOrigin(t),n?i&&i.pinch&&this.fire("zoom",i):((o||i&&i.pinch)&&this.fire("zoom",i),this.fire("move",i)),this},_moveEnd:function(t){return t&&this.fire("zoomend"),this.fire("moveend")},_stop:function(){return r(this._flyToFrame),this._panAnim&&this._panAnim.stop(),this},_rawPanBy:function(t){Z(this._mapPane,this._getMapPanePos().subtract(t))},_getZoomSpan:function(){return this.getMaxZoom()-this.getMinZoom()},_panInsideMaxBounds:function(){this._enforcingBounds||this.panInsideBounds(this.options.maxBounds)},_checkIfLoaded:function(){if(!this._loaded)throw new Error("Set map center and zoom first.")},_initEvents:function(t){this._targets={};var e=t?k:S;e((this._targets[h(this._container)]=this)._container,"click dblclick mousedown mouseup mouseover mouseout mousemove contextmenu keypress keydown keyup",this._handleDOMEvent,this),this.options.trackResize&&e(window,"resize",this._onResize,this),b.any3d&&this.options.transform3DLimit&&(t?this.off:this.on).call(this,"moveend",this._onMoveEnd)},_onResize:function(){r(this._resizeRequest),this._resizeRequest=x(function(){this.invalidateSize({debounceMoveend:!0})},this)},_onScroll:function(){this._container.scrollTop=0,this._container.scrollLeft=0},_onMoveEnd:function(){var t=this._getMapPanePos();Math.max(Math.abs(t.x),Math.abs(t.y))>=this.options.transform3DLimit&&this._resetView(this.getCenter(),this.getZoom())},_findEventTargets:function(t,e){for(var i,n=[],o="mouseout"===e||"mouseover"===e,s=t.target||t.srcElement,r=!1;s;){if((i=this._targets[h(s)])&&("click"===e||"preclick"===e)&&this._draggableMoved(i)){r=!0;break}if(i&&i.listens(e,!0)){if(o&&!We(s,t))break;if(n.push(i),o)break}if(s===this._container)break;s=s.parentNode}return n=n.length||r||o||!this.listens(e,!0)?n:[this]},_isClickDisabled:function(t){for(;t&&t!==this._container;){if(t._leaflet_disable_click)return!0;t=t.parentNode}},_handleDOMEvent:function(t){var e,i=t.target||t.srcElement;!this._loaded||i._leaflet_disable_events||"click"===t.type&&this._isClickDisabled(i)||("mousedown"===(e=t.type)&&Me(i),this._fireDOMEvent(t,e))},_mouseEvents:["click","dblclick","mouseover","mouseout","contextmenu"],_fireDOMEvent:function(t,e,i){"click"===t.type&&((a=l({},t)).type="preclick",this._fireDOMEvent(a,a.type,i));var n=this._findEventTargets(t,e);if(i){for(var o=[],s=0;s<i.length;s++)i[s].listens(e,!0)&&o.push(i[s]);n=o.concat(n)}if(n.length){"contextmenu"===e&&O(t);var r,a=n[0],h={originalEvent:t};for("keypress"!==t.type&&"keydown"!==t.type&&"keyup"!==t.type&&(r=a.getLatLng&&(!a._radius||a._radius<=10),h.containerPoint=r?this.latLngToContainerPoint(a.getLatLng()):this.mouseEventToContainerPoint(t),h.layerPoint=this.containerPointToLayerPoint(h.containerPoint),h.latlng=r?a.getLatLng():this.layerPointToLatLng(h.layerPoint)),s=0;s<n.length;s++)if(n[s].fire(e,h,!0),h.originalEvent._stopped||!1===n[s].options.bubblingMouseEvents&&-1!==G(this._mouseEvents,e))return}},_draggableMoved:function(t){return(t=t.dragging&&t.dragging.enabled()?t:this).dragging&&t.dragging.moved()||this.boxZoom&&this.boxZoom.moved()},_clearHandlers:function(){for(var t=0,e=this._handlers.length;t<e;t++)this._handlers[t].disable()},whenReady:function(t,e){return this._loaded?t.call(e||this,{target:this}):this.on("load",t,e),this},_getMapPanePos:function(){return Pe(this._mapPane)||new p(0,0)},_moved:function(){var t=this._getMapPanePos();return t&&!t.equals([0,0])},_getTopLeftPoint:function(t,e){return(t&&void 0!==e?this._getNewPixelOrigin(t,e):this.getPixelOrigin()).subtract(this._getMapPanePos())},_getNewPixelOrigin:function(t,e){var i=this.getSize()._divideBy(2);return this.project(t,e)._subtract(i)._add(this._getMapPanePos())._round()},_latLngToNewLayerPoint:function(t,e,i){i=this._getNewPixelOrigin(i,e);return this.project(t,e)._subtract(i)},_latLngBoundsToNewLayerBounds:function(t,e,i){i=this._getNewPixelOrigin(i,e);return _([this.project(t.getSouthWest(),e)._subtract(i),this.project(t.getNorthWest(),e)._subtract(i),this.project(t.getSouthEast(),e)._subtract(i),this.project(t.getNorthEast(),e)._subtract(i)])},_getCenterLayerPoint:function(){return this.containerPointToLayerPoint(this.getSize()._divideBy(2))},_getCenterOffset:function(t){return this.latLngToLayerPoint(t).subtract(this._getCenterLayerPoint())},_limitCenter:function(t,e,i){var n,o;return!i||(n=this.project(t,e),o=this.getSize().divideBy(2),o=new f(n.subtract(o),n.add(o)),o=this._getBoundsOffset(o,i,e),Math.abs(o.x)<=1&&Math.abs(o.y)<=1)?t:this.unproject(n.add(o),e)},_limitOffset:function(t,e){var i;return e?(i=new f((i=this.getPixelBounds()).min.add(t),i.max.add(t)),t.add(this._getBoundsOffset(i,e))):t},_getBoundsOffset:function(t,e,i){e=_(this.project(e.getNorthEast(),i),this.project(e.getSouthWest(),i)),i=e.min.subtract(t.min),e=e.max.subtract(t.max);return new p(this._rebound(i.x,-e.x),this._rebound(i.y,-e.y))},_rebound:function(t,e){return 0<t+e?Math.round(t-e)/2:Math.max(0,Math.ceil(t))-Math.max(0,Math.floor(e))},_limitZoom:function(t){var e=this.getMinZoom(),i=this.getMaxZoom(),n=b.any3d?this.options.zoomSnap:1;return n&&(t=Math.round(t/n)*n),Math.max(e,Math.min(i,t))},_onPanTransitionStep:function(){this.fire("move")},_onPanTransitionEnd:function(){z(this._mapPane,"leaflet-pan-anim"),this.fire("moveend")},_tryAnimatedPan:function(t,e){t=this._getCenterOffset(t)._trunc();return!(!0!==(e&&e.animate)&&!this.getSize().contains(t))&&(this.panBy(t,e),!0)},_createAnimProxy:function(){var t=this._proxy=P("div","leaflet-proxy leaflet-zoom-animated");this._panes.mapPane.appendChild(t),this.on("zoomanim",function(t){var e=ue,i=this._proxy.style[e];be(this._proxy,this.project(t.center,t.zoom),this.getZoomScale(t.zoom,1)),i===this._proxy.style[e]&&this._animatingZoom&&this._onZoomTransitionEnd()},this),this.on("load moveend",this._animMoveEnd,this),this._on("unload",this._destroyAnimProxy,this)},_destroyAnimProxy:function(){T(this._proxy),this.off("load moveend",this._animMoveEnd,this),delete this._proxy},_animMoveEnd:function(){var t=this.getCenter(),e=this.getZoom();be(this._proxy,this.project(t,e),this.getZoomScale(e,1))},_catchTransitionEnd:function(t){this._animatingZoom&&0<=t.propertyName.indexOf("transform")&&this._onZoomTransitionEnd()},_nothingToAnimate:function(){return!this._container.getElementsByClassName("leaflet-zoom-animated").length},_tryAnimatedZoom:function(t,e,i){if(!this._animatingZoom){if(i=i||{},!this._zoomAnimated||!1===i.animate||this._nothingToAnimate()||Math.abs(e-this._zoom)>this.options.zoomAnimationThreshold)return!1;var n=this.getZoomScale(e),n=this._getCenterOffset(t)._divideBy(1-1/n);if(!0!==i.animate&&!this.getSize().contains(n))return!1;x(function(){this._moveStart(!0,i.noMoveStart||!1)._animateZoom(t,e,!0)},this)}return!0},_animateZoom:function(t,e,i,n){this._mapPane&&(i&&(this._animatingZoom=!0,this._animateToCenter=t,this._animateToZoom=e,M(this._mapPane,"leaflet-zoom-anim")),this.fire("zoomanim",{center:t,zoom:e,noUpdate:n}),this._tempFireZoomEvent||(this._tempFireZoomEvent=this._zoom!==this._animateToZoom),this._move(this._animateToCenter,this._animateToZoom,void 0,!0),setTimeout(a(this._onZoomTransitionEnd,this),250))},_onZoomTransitionEnd:function(){this._animatingZoom&&(this._mapPane&&z(this._mapPane,"leaflet-zoom-anim"),this._animatingZoom=!1,this._move(this._animateToCenter,this._animateToZoom,void 0,!0),this._tempFireZoomEvent&&this.fire("zoom"),delete this._tempFireZoomEvent,this.fire("move"),this._moveEnd(!0))}});function Ue(t){return new B(t)}var B=et.extend({options:{position:"topright"},initialize:function(t){c(this,t)},getPosition:function(){return this.options.position},setPosition:function(t){var e=this._map;return e&&e.removeControl(this),this.options.position=t,e&&e.addControl(this),this},getContainer:function(){return this._container},addTo:function(t){this.remove(),this._map=t;var e=this._container=this.onAdd(t),i=this.getPosition(),t=t._controlCorners[i];return M(e,"leaflet-control"),-1!==i.indexOf("bottom")?t.insertBefore(e,t.firstChild):t.appendChild(e),this._map.on("unload",this.remove,this),this},remove:function(){return this._map&&(T(this._container),this.onRemove&&this.onRemove(this._map),this._map.off("unload",this.remove,this),this._map=null),this},_refocusOnMap:function(t){this._map&&t&&0<t.screenX&&0<t.screenY&&this._map.getContainer().focus()}}),Ve=(A.include({addControl:function(t){return t.addTo(this),this},removeControl:function(t){return t.remove(),this},_initControlPos:function(){var i=this._controlCorners={},n="leaflet-",o=this._controlContainer=P("div",n+"control-container",this._container);function t(t,e){i[t+e]=P("div",n+t+" "+n+e,o)}t("top","left"),t("top","right"),t("bottom","left"),t("bottom","right")},_clearControlPos:function(){for(var t in this._controlCorners)T(this._controlCorners[t]);T(this._controlContainer),delete this._controlCorners,delete this._controlContainer}}),B.extend({options:{collapsed:!0,position:"topright",autoZIndex:!0,hideSingleBase:!1,sortLayers:!1,sortFunction:function(t,e,i,n){return i<n?-1:n<i?1:0}},initialize:function(t,e,i){for(var n in c(this,i),this._layerControlInputs=[],this._layers=[],this._lastZIndex=0,this._handlingClick=!1,this._preventClick=!1,t)this._addLayer(t[n],n);for(n in e)this._addLayer(e[n],n,!0)},onAdd:function(t){this._initLayout(),this._update(),(this._map=t).on("zoomend",this._checkDisabledLayers,this);for(var e=0;e<this._layers.length;e++)this._layers[e].layer.on("add remove",this._onLayerChange,this);return this._container},addTo:function(t){return B.prototype.addTo.call(this,t),this._expandIfNotCollapsed()},onRemove:function(){this._map.off("zoomend",this._checkDisabledLayers,this);for(var t=0;t<this._layers.length;t++)this._layers[t].layer.off("add remove",this._onLayerChange,this)},addBaseLayer:function(t,e){return this._addLayer(t,e),this._map?this._update():this},addOverlay:function(t,e){return this._addLayer(t,e,!0),this._map?this._update():this},removeLayer:function(t){t.off("add remove",this._onLayerChange,this);t=this._getLayer(h(t));return t&&this._layers.splice(this._layers.indexOf(t),1),this._map?this._update():this},expand:function(){M(this._container,"leaflet-control-layers-expanded"),this._section.style.height=null;var t=this._map.getSize().y-(this._container.offsetTop+50);return t<this._section.clientHeight?(M(this._section,"leaflet-control-layers-scrollbar"),this._section.style.height=t+"px"):z(this._section,"leaflet-control-layers-scrollbar"),this._checkDisabledLayers(),this},collapse:function(){return z(this._container,"leaflet-control-layers-expanded"),this},_initLayout:function(){var t="leaflet-control-layers",e=this._container=P("div",t),i=this.options.collapsed,n=(e.setAttribute("aria-haspopup",!0),Ie(e),Be(e),this._section=P("section",t+"-list")),o=(i&&(this._map.on("click",this.collapse,this),S(e,{mouseenter:this._expandSafely,mouseleave:this.collapse},this)),this._layersLink=P("a",t+"-toggle",e));o.href="#",o.title="Layers",o.setAttribute("role","button"),S(o,{keydown:function(t){13===t.keyCode&&this._expandSafely()},click:function(t){O(t),this._expandSafely()}},this),i||this.expand(),this._baseLayersList=P("div",t+"-base",n),this._separator=P("div",t+"-separator",n),this._overlaysList=P("div",t+"-overlays",n),e.appendChild(n)},_getLayer:function(t){for(var e=0;e<this._layers.length;e++)if(this._layers[e]&&h(this._layers[e].layer)===t)return this._layers[e]},_addLayer:function(t,e,i){this._map&&t.on("add remove",this._onLayerChange,this),this._layers.push({layer:t,name:e,overlay:i}),this.options.sortLayers&&this._layers.sort(a(function(t,e){return this.options.sortFunction(t.layer,e.layer,t.name,e.name)},this)),this.options.autoZIndex&&t.setZIndex&&(this._lastZIndex++,t.setZIndex(this._lastZIndex)),this._expandIfNotCollapsed()},_update:function(){if(this._container){me(this._baseLayersList),me(this._overlaysList),this._layerControlInputs=[];for(var t,e,i,n=0,o=0;o<this._layers.length;o++)i=this._layers[o],this._addItem(i),e=e||i.overlay,t=t||!i.overlay,n+=i.overlay?0:1;this.options.hideSingleBase&&(this._baseLayersList.style.display=(t=t&&1<n)?"":"none"),this._separator.style.display=e&&t?"":"none"}return this},_onLayerChange:function(t){this._handlingClick||this._update();var e=this._getLayer(h(t.target)),t=e.overlay?"add"===t.type?"overlayadd":"overlayremove":"add"===t.type?"baselayerchange":null;t&&this._map.fire(t,e)},_createRadioElement:function(t,e){t='<input type="radio" class="leaflet-control-layers-selector" name="'+t+'"'+(e?' checked="checked"':"")+"/>",e=document.createElement("div");return e.innerHTML=t,e.firstChild},_addItem:function(t){var e,i=document.createElement("label"),n=this._map.hasLayer(t.layer),n=(t.overlay?((e=document.createElement("input")).type="checkbox",e.className="leaflet-control-layers-selector",e.defaultChecked=n):e=this._createRadioElement("leaflet-base-layers_"+h(this),n),this._layerControlInputs.push(e),e.layerId=h(t.layer),S(e,"click",this._onInputClick,this),document.createElement("span")),o=(n.innerHTML=" "+t.name,document.createElement("span"));return i.appendChild(o),o.appendChild(e),o.appendChild(n),(t.overlay?this._overlaysList:this._baseLayersList).appendChild(i),this._checkDisabledLayers(),i},_onInputClick:function(){if(!this._preventClick){var t,e,i=this._layerControlInputs,n=[],o=[];this._handlingClick=!0;for(var s=i.length-1;0<=s;s--)t=i[s],e=this._getLayer(t.layerId).layer,t.checked?n.push(e):t.checked||o.push(e);for(s=0;s<o.length;s++)this._map.hasLayer(o[s])&&this._map.removeLayer(o[s]);for(s=0;s<n.length;s++)this._map.hasLayer(n[s])||this._map.addLayer(n[s]);this._handlingClick=!1,this._refocusOnMap()}},_checkDisabledLayers:function(){for(var t,e,i=this._layerControlInputs,n=this._map.getZoom(),o=i.length-1;0<=o;o--)t=i[o],e=this._getLayer(t.layerId).layer,t.disabled=void 0!==e.options.minZoom&&n<e.options.minZoom||void 0!==e.options.maxZoom&&n>e.options.maxZoom},_expandIfNotCollapsed:function(){return this._map&&!this.options.collapsed&&this.expand(),this},_expandSafely:function(){var t=this._section,e=(this._preventClick=!0,S(t,"click",O),this.expand(),this);setTimeout(function(){k(t,"click",O),e._preventClick=!1})}})),qe=B.extend({options:{position:"topleft",zoomInText:'<span aria-hidden="true">+</span>',zoomInTitle:"Zoom in",zoomOutText:'<span aria-hidden="true">&#x2212;</span>',zoomOutTitle:"Zoom out"},onAdd:function(t){var e="leaflet-control-zoom",i=P("div",e+" leaflet-bar"),n=this.options;return this._zoomInButton=this._createButton(n.zoomInText,n.zoomInTitle,e+"-in",i,this._zoomIn),this._zoomOutButton=this._createButton(n.zoomOutText,n.zoomOutTitle,e+"-out",i,this._zoomOut),this._updateDisabled(),t.on("zoomend zoomlevelschange",this._updateDisabled,this),i},onRemove:function(t){t.off("zoomend zoomlevelschange",this._updateDisabled,this)},disable:function(){return this._disabled=!0,this._updateDisabled(),this},enable:function(){return this._disabled=!1,this._updateDisabled(),this},_zoomIn:function(t){!this._disabled&&this._map._zoom<this._map.getMaxZoom()&&this._map.zoomIn(this._map.options.zoomDelta*(t.shiftKey?3:1))},_zoomOut:function(t){!this._disabled&&this._map._zoom>this._map.getMinZoom()&&this._map.zoomOut(this._map.options.zoomDelta*(t.shiftKey?3:1))},_createButton:function(t,e,i,n,o){i=P("a",i,n);return i.innerHTML=t,i.href="#",i.title=e,i.setAttribute("role","button"),i.setAttribute("aria-label",e),Ie(i),S(i,"click",Re),S(i,"click",o,this),S(i,"click",this._refocusOnMap,this),i},_updateDisabled:function(){var t=this._map,e="leaflet-disabled";z(this._zoomInButton,e),z(this._zoomOutButton,e),this._zoomInButton.setAttribute("aria-disabled","false"),this._zoomOutButton.setAttribute("aria-disabled","false"),!this._disabled&&t._zoom!==t.getMinZoom()||(M(this._zoomOutButton,e),this._zoomOutButton.setAttribute("aria-disabled","true")),!this._disabled&&t._zoom!==t.getMaxZoom()||(M(this._zoomInButton,e),this._zoomInButton.setAttribute("aria-disabled","true"))}}),Ge=(A.mergeOptions({zoomControl:!0}),A.addInitHook(function(){this.options.zoomControl&&(this.zoomControl=new qe,this.addControl(this.zoomControl))}),B.extend({options:{position:"bottomleft",maxWidth:100,metric:!0,imperial:!0},onAdd:function(t){var e="leaflet-control-scale",i=P("div",e),n=this.options;return this._addScales(n,e+"-line",i),t.on(n.updateWhenIdle?"moveend":"move",this._update,this),t.whenReady(this._update,this),i},onRemove:function(t){t.off(this.options.updateWhenIdle?"moveend":"move",this._update,this)},_addScales:function(t,e,i){t.metric&&(this._mScale=P("div",e,i)),t.imperial&&(this._iScale=P("div",e,i))},_update:function(){var t=this._map,e=t.getSize().y/2,t=t.distance(t.containerPointToLatLng([0,e]),t.containerPointToLatLng([this.options.maxWidth,e]));this._updateScales(t)},_updateScales:function(t){this.options.metric&&t&&this._updateMetric(t),this.options.imperial&&t&&this._updateImperial(t)},_updateMetric:function(t){var e=this._getRoundNum(t);this._updateScale(this._mScale,e<1e3?e+" m":e/1e3+" km",e/t)},_updateImperial:function(t){var e,i,t=3.2808399*t;5280<t?(i=this._getRoundNum(e=t/5280),this._updateScale(this._iScale,i+" mi",i/e)):(i=this._getRoundNum(t),this._updateScale(this._iScale,i+" ft",i/t))},_updateScale:function(t,e,i){t.style.width=Math.round(this.options.maxWidth*i)+"px",t.innerHTML=e},_getRoundNum:function(t){var e=Math.pow(10,(Math.floor(t)+"").length-1),t=t/e;return e*(t=10<=t?10:5<=t?5:3<=t?3:2<=t?2:1)}})),Ke=B.extend({options:{position:"bottomright",prefix:'<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">'+(b.inlineSvg?'<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8" class="leaflet-attribution-flag"><path fill="#4C7BE1" d="M0 0h12v4H0z"/><path fill="#FFD500" d="M0 4h12v3H0z"/><path fill="#E0BC00" d="M0 7h12v1H0z"/></svg> ':"")+"Leaflet</a>"},initialize:function(t){c(this,t),this._attributions={}},onAdd:function(t){for(var e in(t.attributionControl=this)._container=P("div","leaflet-control-attribution"),Ie(this._container),t._layers)t._layers[e].getAttribution&&this.addAttribution(t._layers[e].getAttribution());return this._update(),t.on("layeradd",this._addAttribution,this),this._container},onRemove:function(t){t.off("layeradd",this._addAttribution,this)},_addAttribution:function(t){t.layer.getAttribution&&(this.addAttribution(t.layer.getAttribution()),t.layer.once("remove",function(){this.removeAttribution(t.layer.getAttribution())},this))},setPrefix:function(t){return this.options.prefix=t,this._update(),this},addAttribution:function(t){return t&&(this._attributions[t]||(this._attributions[t]=0),this._attributions[t]++,this._update()),this},removeAttribution:function(t){return t&&this._attributions[t]&&(this._attributions[t]--,this._update()),this},_update:function(){if(this._map){var t,e=[];for(t in this._attributions)this._attributions[t]&&e.push(t);var i=[];this.options.prefix&&i.push(this.options.prefix),e.length&&i.push(e.join(", ")),this._container.innerHTML=i.join(' <span aria-hidden="true">|</span> ')}}}),n=(A.mergeOptions({attributionControl:!0}),A.addInitHook(function(){this.options.attributionControl&&(new Ke).addTo(this)}),B.Layers=Ve,B.Zoom=qe,B.Scale=Ge,B.Attribution=Ke,Ue.layers=function(t,e,i){return new Ve(t,e,i)},Ue.zoom=function(t){return new qe(t)},Ue.scale=function(t){return new Ge(t)},Ue.attribution=function(t){return new Ke(t)},et.extend({initialize:function(t){this._map=t},enable:function(){return this._enabled||(this._enabled=!0,this.addHooks()),this},disable:function(){return this._enabled&&(this._enabled=!1,this.removeHooks()),this},enabled:function(){return!!this._enabled}})),ft=(n.addTo=function(t,e){return t.addHandler(e,this),this},{Events:e}),Ye=b.touch?"touchstart mousedown":"mousedown",Xe=it.extend({options:{clickTolerance:3},initialize:function(t,e,i,n){c(this,n),this._element=t,this._dragStartTarget=e||t,this._preventOutline=i},enable:function(){this._enabled||(S(this._dragStartTarget,Ye,this._onDown,this),this._enabled=!0)},disable:function(){this._enabled&&(Xe._dragging===this&&this.finishDrag(!0),k(this._dragStartTarget,Ye,this._onDown,this),this._enabled=!1,this._moved=!1)},_onDown:function(t){var e,i;this._enabled&&(this._moved=!1,ve(this._element,"leaflet-zoom-anim")||(t.touches&&1!==t.touches.length?Xe._dragging===this&&this.finishDrag():Xe._dragging||t.shiftKey||1!==t.which&&1!==t.button&&!t.touches||((Xe._dragging=this)._preventOutline&&Me(this._element),Le(),re(),this._moving||(this.fire("down"),i=t.touches?t.touches[0]:t,e=Ce(this._element),this._startPoint=new p(i.clientX,i.clientY),this._startPos=Pe(this._element),this._parentScale=Ze(e),i="mousedown"===t.type,S(document,i?"mousemove":"touchmove",this._onMove,this),S(document,i?"mouseup":"touchend touchcancel",this._onUp,this)))))},_onMove:function(t){var e;this._enabled&&(t.touches&&1<t.touches.length?this._moved=!0:!(e=new p((e=t.touches&&1===t.touches.length?t.touches[0]:t).clientX,e.clientY)._subtract(this._startPoint)).x&&!e.y||Math.abs(e.x)+Math.abs(e.y)<this.options.clickTolerance||(e.x/=this._parentScale.x,e.y/=this._parentScale.y,O(t),this._moved||(this.fire("dragstart"),this._moved=!0,M(document.body,"leaflet-dragging"),this._lastTarget=t.target||t.srcElement,window.SVGElementInstance&&this._lastTarget instanceof window.SVGElementInstance&&(this._lastTarget=this._lastTarget.correspondingUseElement),M(this._lastTarget,"leaflet-drag-target")),this._newPos=this._startPos.add(e),this._moving=!0,this._lastEvent=t,this._updatePosition()))},_updatePosition:function(){var t={originalEvent:this._lastEvent};this.fire("predrag",t),Z(this._element,this._newPos),this.fire("drag",t)},_onUp:function(){this._enabled&&this.finishDrag()},finishDrag:function(t){z(document.body,"leaflet-dragging"),this._lastTarget&&(z(this._lastTarget,"leaflet-drag-target"),this._lastTarget=null),k(document,"mousemove touchmove",this._onMove,this),k(document,"mouseup touchend touchcancel",this._onUp,this),Te(),ae();var e=this._moved&&this._moving;this._moving=!1,Xe._dragging=!1,e&&this.fire("dragend",{noInertia:t,distance:this._newPos.distanceTo(this._startPos)})}});function Je(t,e,i){for(var n,o,s,r,a,h,l,u=[1,4,2,8],c=0,d=t.length;c<d;c++)t[c]._code=si(t[c],e);for(s=0;s<4;s++){for(h=u[s],n=[],c=0,o=(d=t.length)-1;c<d;o=c++)r=t[c],a=t[o],r._code&h?a._code&h||((l=oi(a,r,h,e,i))._code=si(l,e),n.push(l)):(a._code&h&&((l=oi(a,r,h,e,i))._code=si(l,e),n.push(l)),n.push(r));t=n}return t}function $e(t,e){var i,n,o,s,r,a,h;if(!t||0===t.length)throw new Error("latlngs not passed");I(t)||(console.warn("latlngs are not flat! Only the first ring will be used"),t=t[0]);for(var l=w([0,0]),u=g(t),c=(u.getNorthWest().distanceTo(u.getSouthWest())*u.getNorthEast().distanceTo(u.getNorthWest())<1700&&(l=Qe(t)),t.length),d=[],_=0;_<c;_++){var p=w(t[_]);d.push(e.project(w([p.lat-l.lat,p.lng-l.lng])))}for(_=r=a=h=0,i=c-1;_<c;i=_++)n=d[_],o=d[i],s=n.y*o.x-o.y*n.x,a+=(n.x+o.x)*s,h+=(n.y+o.y)*s,r+=3*s;u=0===r?d[0]:[a/r,h/r],u=e.unproject(m(u));return w([u.lat+l.lat,u.lng+l.lng])}function Qe(t){for(var e=0,i=0,n=0,o=0;o<t.length;o++){var s=w(t[o]);e+=s.lat,i+=s.lng,n++}return w([e/n,i/n])}var ti,gt={__proto__:null,clipPolygon:Je,polygonCenter:$e,centroid:Qe};function ei(t,e){if(e&&t.length){var i=t=function(t,e){for(var i=[t[0]],n=1,o=0,s=t.length;n<s;n++)(function(t,e){var i=e.x-t.x,e=e.y-t.y;return i*i+e*e})(t[n],t[o])>e&&(i.push(t[n]),o=n);o<s-1&&i.push(t[s-1]);return i}(t,e=e*e),n=i.length,o=new(typeof Uint8Array!=void 0+""?Uint8Array:Array)(n);o[0]=o[n-1]=1,function t(e,i,n,o,s){var r,a,h,l=0;for(a=o+1;a<=s-1;a++)h=ri(e[a],e[o],e[s],!0),l<h&&(r=a,l=h);n<l&&(i[r]=1,t(e,i,n,o,r),t(e,i,n,r,s))}(i,o,e,0,n-1);var s,r=[];for(s=0;s<n;s++)o[s]&&r.push(i[s]);return r}return t.slice()}function ii(t,e,i){return Math.sqrt(ri(t,e,i,!0))}function ni(t,e,i,n,o){var s,r,a,h=n?ti:si(t,i),l=si(e,i);for(ti=l;;){if(!(h|l))return[t,e];if(h&l)return!1;a=si(r=oi(t,e,s=h||l,i,o),i),s===h?(t=r,h=a):(e=r,l=a)}}function oi(t,e,i,n,o){var s,r,a=e.x-t.x,e=e.y-t.y,h=n.min,n=n.max;return 8&i?(s=t.x+a*(n.y-t.y)/e,r=n.y):4&i?(s=t.x+a*(h.y-t.y)/e,r=h.y):2&i?(s=n.x,r=t.y+e*(n.x-t.x)/a):1&i&&(s=h.x,r=t.y+e*(h.x-t.x)/a),new p(s,r,o)}function si(t,e){var i=0;return t.x<e.min.x?i|=1:t.x>e.max.x&&(i|=2),t.y<e.min.y?i|=4:t.y>e.max.y&&(i|=8),i}function ri(t,e,i,n){var o=e.x,e=e.y,s=i.x-o,r=i.y-e,a=s*s+r*r;return 0<a&&(1<(a=((t.x-o)*s+(t.y-e)*r)/a)?(o=i.x,e=i.y):0<a&&(o+=s*a,e+=r*a)),s=t.x-o,r=t.y-e,n?s*s+r*r:new p(o,e)}function I(t){return!d(t[0])||"object"!=typeof t[0][0]&&void 0!==t[0][0]}function ai(t){return console.warn("Deprecated use of _flat, please use L.LineUtil.isFlat instead."),I(t)}function hi(t,e){var i,n,o,s,r,a;if(!t||0===t.length)throw new Error("latlngs not passed");I(t)||(console.warn("latlngs are not flat! Only the first ring will be used"),t=t[0]);for(var h=w([0,0]),l=g(t),u=(l.getNorthWest().distanceTo(l.getSouthWest())*l.getNorthEast().distanceTo(l.getNorthWest())<1700&&(h=Qe(t)),t.length),c=[],d=0;d<u;d++){var _=w(t[d]);c.push(e.project(w([_.lat-h.lat,_.lng-h.lng])))}for(i=d=0;d<u-1;d++)i+=c[d].distanceTo(c[d+1])/2;if(0===i)a=c[0];else for(n=d=0;d<u-1;d++)if(o=c[d],s=c[d+1],i<(n+=r=o.distanceTo(s))){a=[s.x-(r=(n-i)/r)*(s.x-o.x),s.y-r*(s.y-o.y)];break}l=e.unproject(m(a));return w([l.lat+h.lat,l.lng+h.lng])}var vt={__proto__:null,simplify:ei,pointToSegmentDistance:ii,closestPointOnSegment:function(t,e,i){return ri(t,e,i)},clipSegment:ni,_getEdgeIntersection:oi,_getBitCode:si,_sqClosestPointOnSegment:ri,isFlat:I,_flat:ai,polylineCenter:hi},yt={project:function(t){return new p(t.lng,t.lat)},unproject:function(t){return new v(t.y,t.x)},bounds:new f([-180,-90],[180,90])},xt={R:6378137,R_MINOR:6356752.314245179,bounds:new f([-20037508.34279,-15496570.73972],[20037508.34279,18764656.23138]),project:function(t){var e=Math.PI/180,i=this.R,n=t.lat*e,o=this.R_MINOR/i,o=Math.sqrt(1-o*o),s=o*Math.sin(n),s=Math.tan(Math.PI/4-n/2)/Math.pow((1-s)/(1+s),o/2),n=-i*Math.log(Math.max(s,1e-10));return new p(t.lng*e*i,n)},unproject:function(t){for(var e,i=180/Math.PI,n=this.R,o=this.R_MINOR/n,s=Math.sqrt(1-o*o),r=Math.exp(-t.y/n),a=Math.PI/2-2*Math.atan(r),h=0,l=.1;h<15&&1e-7<Math.abs(l);h++)e=s*Math.sin(a),e=Math.pow((1-e)/(1+e),s/2),a+=l=Math.PI/2-2*Math.atan(r*e)-a;return new v(a*i,t.x*i/n)}},wt={__proto__:null,LonLat:yt,Mercator:xt,SphericalMercator:rt},Pt=l({},st,{code:"EPSG:3395",projection:xt,transformation:ht(bt=.5/(Math.PI*xt.R),.5,-bt,.5)}),li=l({},st,{code:"EPSG:4326",projection:yt,transformation:ht(1/180,1,-1/180,.5)}),Lt=l({},ot,{projection:yt,transformation:ht(1,0,-1,0),scale:function(t){return Math.pow(2,t)},zoom:function(t){return Math.log(t)/Math.LN2},distance:function(t,e){var i=e.lng-t.lng,e=e.lat-t.lat;return Math.sqrt(i*i+e*e)},infinite:!0}),o=(ot.Earth=st,ot.EPSG3395=Pt,ot.EPSG3857=lt,ot.EPSG900913=ut,ot.EPSG4326=li,ot.Simple=Lt,it.extend({options:{pane:"overlayPane",attribution:null,bubblingMouseEvents:!0},addTo:function(t){return t.addLayer(this),this},remove:function(){return this.removeFrom(this._map||this._mapToAdd)},removeFrom:function(t){return t&&t.removeLayer(this),this},getPane:function(t){return this._map.getPane(t?this.options[t]||t:this.options.pane)},addInteractiveTarget:function(t){return this._map._targets[h(t)]=this},removeInteractiveTarget:function(t){return delete this._map._targets[h(t)],this},getAttribution:function(){return this.options.attribution},_layerAdd:function(t){var e,i=t.target;i.hasLayer(this)&&(this._map=i,this._zoomAnimated=i._zoomAnimated,this.getEvents&&(e=this.getEvents(),i.on(e,this),this.once("remove",function(){i.off(e,this)},this)),this.onAdd(i),this.fire("add"),i.fire("layeradd",{layer:this}))}})),ui=(A.include({addLayer:function(t){var e;if(t._layerAdd)return e=h(t),this._layers[e]||((this._layers[e]=t)._mapToAdd=this,t.beforeAdd&&t.beforeAdd(this),this.whenReady(t._layerAdd,t)),this;throw new Error("The provided object is not a Layer.")},removeLayer:function(t){var e=h(t);return this._layers[e]&&(this._loaded&&t.onRemove(this),delete this._layers[e],this._loaded&&(this.fire("layerremove",{layer:t}),t.fire("remove")),t._map=t._mapToAdd=null),this},hasLayer:function(t){return h(t)in this._layers},eachLayer:function(t,e){for(var i in this._layers)t.call(e,this._layers[i]);return this},_addLayers:function(t){for(var e=0,i=(t=t?d(t)?t:[t]:[]).length;e<i;e++)this.addLayer(t[e])},_addZoomLimit:function(t){isNaN(t.options.maxZoom)&&isNaN(t.options.minZoom)||(this._zoomBoundLayers[h(t)]=t,this._updateZoomLevels())},_removeZoomLimit:function(t){t=h(t);this._zoomBoundLayers[t]&&(delete this._zoomBoundLayers[t],this._updateZoomLevels())},_updateZoomLevels:function(){var t,e=1/0,i=-1/0,n=this._getZoomSpan();for(t in this._zoomBoundLayers)var o=this._zoomBoundLayers[t].options,e=void 0===o.minZoom?e:Math.min(e,o.minZoom),i=void 0===o.maxZoom?i:Math.max(i,o.maxZoom);this._layersMaxZoom=i===-1/0?void 0:i,this._layersMinZoom=e===1/0?void 0:e,n!==this._getZoomSpan()&&this.fire("zoomlevelschange"),void 0===this.options.maxZoom&&this._layersMaxZoom&&this.getZoom()>this._layersMaxZoom&&this.setZoom(this._layersMaxZoom),void 0===this.options.minZoom&&this._layersMinZoom&&this.getZoom()<this._layersMinZoom&&this.setZoom(this._layersMinZoom)}}),o.extend({initialize:function(t,e){var i,n;if(c(this,e),this._layers={},t)for(i=0,n=t.length;i<n;i++)this.addLayer(t[i])},addLayer:function(t){var e=this.getLayerId(t);return this._layers[e]=t,this._map&&this._map.addLayer(t),this},removeLayer:function(t){t=t in this._layers?t:this.getLayerId(t);return this._map&&this._layers[t]&&this._map.removeLayer(this._layers[t]),delete this._layers[t],this},hasLayer:function(t){return("number"==typeof t?t:this.getLayerId(t))in this._layers},clearLayers:function(){return this.eachLayer(this.removeLayer,this)},invoke:function(t){var e,i,n=Array.prototype.slice.call(arguments,1);for(e in this._layers)(i=this._layers[e])[t]&&i[t].apply(i,n);return this},onAdd:function(t){this.eachLayer(t.addLayer,t)},onRemove:function(t){this.eachLayer(t.removeLayer,t)},eachLayer:function(t,e){for(var i in this._layers)t.call(e,this._layers[i]);return this},getLayer:function(t){return this._layers[t]},getLayers:function(){var t=[];return this.eachLayer(t.push,t),t},setZIndex:function(t){return this.invoke("setZIndex",t)},getLayerId:h})),ci=ui.extend({addLayer:function(t){return this.hasLayer(t)?this:(t.addEventParent(this),ui.prototype.addLayer.call(this,t),this.fire("layeradd",{layer:t}))},removeLayer:function(t){return this.hasLayer(t)?((t=t in this._layers?this._layers[t]:t).removeEventParent(this),ui.prototype.removeLayer.call(this,t),this.fire("layerremove",{layer:t})):this},setStyle:function(t){return this.invoke("setStyle",t)},bringToFront:function(){return this.invoke("bringToFront")},bringToBack:function(){return this.invoke("bringToBack")},getBounds:function(){var t,e=new s;for(t in this._layers){var i=this._layers[t];e.extend(i.getBounds?i.getBounds():i.getLatLng())}return e}}),di=et.extend({options:{popupAnchor:[0,0],tooltipAnchor:[0,0],crossOrigin:!1},initialize:function(t){c(this,t)},createIcon:function(t){return this._createIcon("icon",t)},createShadow:function(t){return this._createIcon("shadow",t)},_createIcon:function(t,e){var i=this._getIconUrl(t);if(i)return i=this._createImg(i,e&&"IMG"===e.tagName?e:null),this._setIconStyles(i,t),!this.options.crossOrigin&&""!==this.options.crossOrigin||(i.crossOrigin=!0===this.options.crossOrigin?"":this.options.crossOrigin),i;if("icon"===t)throw new Error("iconUrl not set in Icon options (see the docs).");return null},_setIconStyles:function(t,e){var i=this.options,n=i[e+"Size"],n=m(n="number"==typeof n?[n,n]:n),o=m("shadow"===e&&i.shadowAnchor||i.iconAnchor||n&&n.divideBy(2,!0));t.className="leaflet-marker-"+e+" "+(i.className||""),o&&(t.style.marginLeft=-o.x+"px",t.style.marginTop=-o.y+"px"),n&&(t.style.width=n.x+"px",t.style.height=n.y+"px")},_createImg:function(t,e){return(e=e||document.createElement("img")).src=t,e},_getIconUrl:function(t){return b.retina&&this.options[t+"RetinaUrl"]||this.options[t+"Url"]}});var _i=di.extend({options:{iconUrl:"marker-icon.png",iconRetinaUrl:"marker-icon-2x.png",shadowUrl:"marker-shadow.png",iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],tooltipAnchor:[16,-28],shadowSize:[41,41]},_getIconUrl:function(t){return"string"!=typeof _i.imagePath&&(_i.imagePath=this._detectIconPath()),(this.options.imagePath||_i.imagePath)+di.prototype._getIconUrl.call(this,t)},_stripUrl:function(t){function e(t,e,i){return(e=e.exec(t))&&e[i]}return(t=e(t,/^url\((['"])?(.+)\1\)$/,2))&&e(t,/^(.*)marker-icon\.png$/,1)},_detectIconPath:function(){var t=P("div","leaflet-default-icon-path",document.body),e=pe(t,"background-image")||pe(t,"backgroundImage");return document.body.removeChild(t),(e=this._stripUrl(e))?e:(t=document.querySelector('link[href$="leaflet.css"]'))?t.href.substring(0,t.href.length-"leaflet.css".length-1):""}}),pi=n.extend({initialize:function(t){this._marker=t},addHooks:function(){var t=this._marker._icon;this._draggable||(this._draggable=new Xe(t,t,!0)),this._draggable.on({dragstart:this._onDragStart,predrag:this._onPreDrag,drag:this._onDrag,dragend:this._onDragEnd},this).enable(),M(t,"leaflet-marker-draggable")},removeHooks:function(){this._draggable.off({dragstart:this._onDragStart,predrag:this._onPreDrag,drag:this._onDrag,dragend:this._onDragEnd},this).disable(),this._marker._icon&&z(this._marker._icon,"leaflet-marker-draggable")},moved:function(){return this._draggable&&this._draggable._moved},_adjustPan:function(t){var e=this._marker,i=e._map,n=this._marker.options.autoPanSpeed,o=this._marker.options.autoPanPadding,s=Pe(e._icon),r=i.getPixelBounds(),a=i.getPixelOrigin(),a=_(r.min._subtract(a).add(o),r.max._subtract(a).subtract(o));a.contains(s)||(o=m((Math.max(a.max.x,s.x)-a.max.x)/(r.max.x-a.max.x)-(Math.min(a.min.x,s.x)-a.min.x)/(r.min.x-a.min.x),(Math.max(a.max.y,s.y)-a.max.y)/(r.max.y-a.max.y)-(Math.min(a.min.y,s.y)-a.min.y)/(r.min.y-a.min.y)).multiplyBy(n),i.panBy(o,{animate:!1}),this._draggable._newPos._add(o),this._draggable._startPos._add(o),Z(e._icon,this._draggable._newPos),this._onDrag(t),this._panRequest=x(this._adjustPan.bind(this,t)))},_onDragStart:function(){this._oldLatLng=this._marker.getLatLng(),this._marker.closePopup&&this._marker.closePopup(),this._marker.fire("movestart").fire("dragstart")},_onPreDrag:function(t){this._marker.options.autoPan&&(r(this._panRequest),this._panRequest=x(this._adjustPan.bind(this,t)))},_onDrag:function(t){var e=this._marker,i=e._shadow,n=Pe(e._icon),o=e._map.layerPointToLatLng(n);i&&Z(i,n),e._latlng=o,t.latlng=o,t.oldLatLng=this._oldLatLng,e.fire("move",t).fire("drag",t)},_onDragEnd:function(t){r(this._panRequest),delete this._oldLatLng,this._marker.fire("moveend").fire("dragend",t)}}),mi=o.extend({options:{icon:new _i,interactive:!0,keyboard:!0,title:"",alt:"Marker",zIndexOffset:0,opacity:1,riseOnHover:!1,riseOffset:250,pane:"markerPane",shadowPane:"shadowPane",bubblingMouseEvents:!1,autoPanOnFocus:!0,draggable:!1,autoPan:!1,autoPanPadding:[50,50],autoPanSpeed:10},initialize:function(t,e){c(this,e),this._latlng=w(t)},onAdd:function(t){this._zoomAnimated=this._zoomAnimated&&t.options.markerZoomAnimation,this._zoomAnimated&&t.on("zoomanim",this._animateZoom,this),this._initIcon(),this.update()},onRemove:function(t){this.dragging&&this.dragging.enabled()&&(this.options.draggable=!0,this.dragging.removeHooks()),delete this.dragging,this._zoomAnimated&&t.off("zoomanim",this._animateZoom,this),this._removeIcon(),this._removeShadow()},getEvents:function(){return{zoom:this.update,viewreset:this.update}},getLatLng:function(){return this._latlng},setLatLng:function(t){var e=this._latlng;return this._latlng=w(t),this.update(),this.fire("move",{oldLatLng:e,latlng:this._latlng})},setZIndexOffset:function(t){return this.options.zIndexOffset=t,this.update()},getIcon:function(){return this.options.icon},setIcon:function(t){return this.options.icon=t,this._map&&(this._initIcon(),this.update()),this._popup&&this.bindPopup(this._popup,this._popup.options),this},getElement:function(){return this._icon},update:function(){var t;return this._icon&&this._map&&(t=this._map.latLngToLayerPoint(this._latlng).round(),this._setPos(t)),this},_initIcon:function(){var t=this.options,e="leaflet-zoom-"+(this._zoomAnimated?"animated":"hide"),i=t.icon.createIcon(this._icon),n=!1,i=(i!==this._icon&&(this._icon&&this._removeIcon(),n=!0,t.title&&(i.title=t.title),"IMG"===i.tagName&&(i.alt=t.alt||"")),M(i,e),t.keyboard&&(i.tabIndex="0",i.setAttribute("role","button")),this._icon=i,t.riseOnHover&&this.on({mouseover:this._bringToFront,mouseout:this._resetZIndex}),this.options.autoPanOnFocus&&S(i,"focus",this._panOnFocus,this),t.icon.createShadow(this._shadow)),o=!1;i!==this._shadow&&(this._removeShadow(),o=!0),i&&(M(i,e),i.alt=""),this._shadow=i,t.opacity<1&&this._updateOpacity(),n&&this.getPane().appendChild(this._icon),this._initInteraction(),i&&o&&this.getPane(t.shadowPane).appendChild(this._shadow)},_removeIcon:function(){this.options.riseOnHover&&this.off({mouseover:this._bringToFront,mouseout:this._resetZIndex}),this.options.autoPanOnFocus&&k(this._icon,"focus",this._panOnFocus,this),T(this._icon),this.removeInteractiveTarget(this._icon),this._icon=null},_removeShadow:function(){this._shadow&&T(this._shadow),this._shadow=null},_setPos:function(t){this._icon&&Z(this._icon,t),this._shadow&&Z(this._shadow,t),this._zIndex=t.y+this.options.zIndexOffset,this._resetZIndex()},_updateZIndex:function(t){this._icon&&(this._icon.style.zIndex=this._zIndex+t)},_animateZoom:function(t){t=this._map._latLngToNewLayerPoint(this._latlng,t.zoom,t.center).round();this._setPos(t)},_initInteraction:function(){var t;this.options.interactive&&(M(this._icon,"leaflet-interactive"),this.addInteractiveTarget(this._icon),pi&&(t=this.options.draggable,this.dragging&&(t=this.dragging.enabled(),this.dragging.disable()),this.dragging=new pi(this),t&&this.dragging.enable()))},setOpacity:function(t){return this.options.opacity=t,this._map&&this._updateOpacity(),this},_updateOpacity:function(){var t=this.options.opacity;this._icon&&C(this._icon,t),this._shadow&&C(this._shadow,t)},_bringToFront:function(){this._updateZIndex(this.options.riseOffset)},_resetZIndex:function(){this._updateZIndex(0)},_panOnFocus:function(){var t,e,i=this._map;i&&(t=(e=this.options.icon.options).iconSize?m(e.iconSize):m(0,0),e=e.iconAnchor?m(e.iconAnchor):m(0,0),i.panInside(this._latlng,{paddingTopLeft:e,paddingBottomRight:t.subtract(e)}))},_getPopupAnchor:function(){return this.options.icon.options.popupAnchor},_getTooltipAnchor:function(){return this.options.icon.options.tooltipAnchor}});var fi=o.extend({options:{stroke:!0,color:"#3388ff",weight:3,opacity:1,lineCap:"round",lineJoin:"round",dashArray:null,dashOffset:null,fill:!1,fillColor:null,fillOpacity:.2,fillRule:"evenodd",interactive:!0,bubblingMouseEvents:!0},beforeAdd:function(t){this._renderer=t.getRenderer(this)},onAdd:function(){this._renderer._initPath(this),this._reset(),this._renderer._addPath(this)},onRemove:function(){this._renderer._removePath(this)},redraw:function(){return this._map&&this._renderer._updatePath(this),this},setStyle:function(t){return c(this,t),this._renderer&&(this._renderer._updateStyle(this),this.options.stroke&&t&&Object.prototype.hasOwnProperty.call(t,"weight")&&this._updateBounds()),this},bringToFront:function(){return this._renderer&&this._renderer._bringToFront(this),this},bringToBack:function(){return this._renderer&&this._renderer._bringToBack(this),this},getElement:function(){return this._path},_reset:function(){this._project(),this._update()},_clickTolerance:function(){return(this.options.stroke?this.options.weight/2:0)+(this._renderer.options.tolerance||0)}}),gi=fi.extend({options:{fill:!0,radius:10},initialize:function(t,e){c(this,e),this._latlng=w(t),this._radius=this.options.radius},setLatLng:function(t){var e=this._latlng;return this._latlng=w(t),this.redraw(),this.fire("move",{oldLatLng:e,latlng:this._latlng})},getLatLng:function(){return this._latlng},setRadius:function(t){return this.options.radius=this._radius=t,this.redraw()},getRadius:function(){return this._radius},setStyle:function(t){var e=t&&t.radius||this._radius;return fi.prototype.setStyle.call(this,t),this.setRadius(e),this},_project:function(){this._point=this._map.latLngToLayerPoint(this._latlng),this._updateBounds()},_updateBounds:function(){var t=this._radius,e=this._radiusY||t,i=this._clickTolerance(),t=[t+i,e+i];this._pxBounds=new f(this._point.subtract(t),this._point.add(t))},_update:function(){this._map&&this._updatePath()},_updatePath:function(){this._renderer._updateCircle(this)},_empty:function(){return this._radius&&!this._renderer._bounds.intersects(this._pxBounds)},_containsPoint:function(t){return t.distanceTo(this._point)<=this._radius+this._clickTolerance()}});var vi=gi.extend({initialize:function(t,e,i){if(c(this,e="number"==typeof e?l({},i,{radius:e}):e),this._latlng=w(t),isNaN(this.options.radius))throw new Error("Circle radius cannot be NaN");this._mRadius=this.options.radius},setRadius:function(t){return this._mRadius=t,this.redraw()},getRadius:function(){return this._mRadius},getBounds:function(){var t=[this._radius,this._radiusY||this._radius];return new s(this._map.layerPointToLatLng(this._point.subtract(t)),this._map.layerPointToLatLng(this._point.add(t)))},setStyle:fi.prototype.setStyle,_project:function(){var t,e,i,n,o,s=this._latlng.lng,r=this._latlng.lat,a=this._map,h=a.options.crs;h.distance===st.distance?(n=Math.PI/180,o=this._mRadius/st.R/n,t=a.project([r+o,s]),e=a.project([r-o,s]),e=t.add(e).divideBy(2),i=a.unproject(e).lat,n=Math.acos((Math.cos(o*n)-Math.sin(r*n)*Math.sin(i*n))/(Math.cos(r*n)*Math.cos(i*n)))/n,!isNaN(n)&&0!==n||(n=o/Math.cos(Math.PI/180*r)),this._point=e.subtract(a.getPixelOrigin()),this._radius=isNaN(n)?0:e.x-a.project([i,s-n]).x,this._radiusY=e.y-t.y):(o=h.unproject(h.project(this._latlng).subtract([this._mRadius,0])),this._point=a.latLngToLayerPoint(this._latlng),this._radius=this._point.x-a.latLngToLayerPoint(o).x),this._updateBounds()}});var yi=fi.extend({options:{smoothFactor:1,noClip:!1},initialize:function(t,e){c(this,e),this._setLatLngs(t)},getLatLngs:function(){return this._latlngs},setLatLngs:function(t){return this._setLatLngs(t),this.redraw()},isEmpty:function(){return!this._latlngs.length},closestLayerPoint:function(t){for(var e=1/0,i=null,n=ri,o=0,s=this._parts.length;o<s;o++)for(var r=this._parts[o],a=1,h=r.length;a<h;a++){var l,u,c=n(t,l=r[a-1],u=r[a],!0);c<e&&(e=c,i=n(t,l,u))}return i&&(i.distance=Math.sqrt(e)),i},getCenter:function(){if(this._map)return hi(this._defaultShape(),this._map.options.crs);throw new Error("Must add layer to map before using getCenter()")},getBounds:function(){return this._bounds},addLatLng:function(t,e){return e=e||this._defaultShape(),t=w(t),e.push(t),this._bounds.extend(t),this.redraw()},_setLatLngs:function(t){this._bounds=new s,this._latlngs=this._convertLatLngs(t)},_defaultShape:function(){return I(this._latlngs)?this._latlngs:this._latlngs[0]},_convertLatLngs:function(t){for(var e=[],i=I(t),n=0,o=t.length;n<o;n++)i?(e[n]=w(t[n]),this._bounds.extend(e[n])):e[n]=this._convertLatLngs(t[n]);return e},_project:function(){var t=new f;this._rings=[],this._projectLatlngs(this._latlngs,this._rings,t),this._bounds.isValid()&&t.isValid()&&(this._rawPxBounds=t,this._updateBounds())},_updateBounds:function(){var t=this._clickTolerance(),t=new p(t,t);this._rawPxBounds&&(this._pxBounds=new f([this._rawPxBounds.min.subtract(t),this._rawPxBounds.max.add(t)]))},_projectLatlngs:function(t,e,i){var n,o,s=t[0]instanceof v,r=t.length;if(s){for(o=[],n=0;n<r;n++)o[n]=this._map.latLngToLayerPoint(t[n]),i.extend(o[n]);e.push(o)}else for(n=0;n<r;n++)this._projectLatlngs(t[n],e,i)},_clipPoints:function(){var t=this._renderer._bounds;if(this._parts=[],this._pxBounds&&this._pxBounds.intersects(t))if(this.options.noClip)this._parts=this._rings;else for(var e,i,n,o,s=this._parts,r=0,a=0,h=this._rings.length;r<h;r++)for(e=0,i=(o=this._rings[r]).length;e<i-1;e++)(n=ni(o[e],o[e+1],t,e,!0))&&(s[a]=s[a]||[],s[a].push(n[0]),n[1]===o[e+1]&&e!==i-2||(s[a].push(n[1]),a++))},_simplifyPoints:function(){for(var t=this._parts,e=this.options.smoothFactor,i=0,n=t.length;i<n;i++)t[i]=ei(t[i],e)},_update:function(){this._map&&(this._clipPoints(),this._simplifyPoints(),this._updatePath())},_updatePath:function(){this._renderer._updatePoly(this)},_containsPoint:function(t,e){var i,n,o,s,r,a,h=this._clickTolerance();if(this._pxBounds&&this._pxBounds.contains(t))for(i=0,s=this._parts.length;i<s;i++)for(n=0,o=(r=(a=this._parts[i]).length)-1;n<r;o=n++)if((e||0!==n)&&ii(t,a[o],a[n])<=h)return!0;return!1}});yi._flat=ai;var xi=yi.extend({options:{fill:!0},isEmpty:function(){return!this._latlngs.length||!this._latlngs[0].length},getCenter:function(){if(this._map)return $e(this._defaultShape(),this._map.options.crs);throw new Error("Must add layer to map before using getCenter()")},_convertLatLngs:function(t){var t=yi.prototype._convertLatLngs.call(this,t),e=t.length;return 2<=e&&t[0]instanceof v&&t[0].equals(t[e-1])&&t.pop(),t},_setLatLngs:function(t){yi.prototype._setLatLngs.call(this,t),I(this._latlngs)&&(this._latlngs=[this._latlngs])},_defaultShape:function(){return(I(this._latlngs[0])?this._latlngs:this._latlngs[0])[0]},_clipPoints:function(){var t=this._renderer._bounds,e=this.options.weight,e=new p(e,e),t=new f(t.min.subtract(e),t.max.add(e));if(this._parts=[],this._pxBounds&&this._pxBounds.intersects(t))if(this.options.noClip)this._parts=this._rings;else for(var i,n=0,o=this._rings.length;n<o;n++)(i=Je(this._rings[n],t,!0)).length&&this._parts.push(i)},_updatePath:function(){this._renderer._updatePoly(this,!0)},_containsPoint:function(t){var e,i,n,o,s,r,a,h,l=!1;if(!this._pxBounds||!this._pxBounds.contains(t))return!1;for(o=0,a=this._parts.length;o<a;o++)for(s=0,r=(h=(e=this._parts[o]).length)-1;s<h;r=s++)i=e[s],n=e[r],i.y>t.y!=n.y>t.y&&t.x<(n.x-i.x)*(t.y-i.y)/(n.y-i.y)+i.x&&(l=!l);return l||yi.prototype._containsPoint.call(this,t,!0)}});var wi=ci.extend({initialize:function(t,e){c(this,e),this._layers={},t&&this.addData(t)},addData:function(t){var e,i,n,o=d(t)?t:t.features;if(o){for(e=0,i=o.length;e<i;e++)((n=o[e]).geometries||n.geometry||n.features||n.coordinates)&&this.addData(n);return this}var s,r=this.options;return(!r.filter||r.filter(t))&&(s=bi(t,r))?(s.feature=Zi(t),s.defaultOptions=s.options,this.resetStyle(s),r.onEachFeature&&r.onEachFeature(t,s),this.addLayer(s)):this},resetStyle:function(t){return void 0===t?this.eachLayer(this.resetStyle,this):(t.options=l({},t.defaultOptions),this._setLayerStyle(t,this.options.style),this)},setStyle:function(e){return this.eachLayer(function(t){this._setLayerStyle(t,e)},this)},_setLayerStyle:function(t,e){t.setStyle&&("function"==typeof e&&(e=e(t.feature)),t.setStyle(e))}});function bi(t,e){var i,n,o,s,r="Feature"===t.type?t.geometry:t,a=r?r.coordinates:null,h=[],l=e&&e.pointToLayer,u=e&&e.coordsToLatLng||Li;if(!a&&!r)return null;switch(r.type){case"Point":return Pi(l,t,i=u(a),e);case"MultiPoint":for(o=0,s=a.length;o<s;o++)i=u(a[o]),h.push(Pi(l,t,i,e));return new ci(h);case"LineString":case"MultiLineString":return n=Ti(a,"LineString"===r.type?0:1,u),new yi(n,e);case"Polygon":case"MultiPolygon":return n=Ti(a,"Polygon"===r.type?1:2,u),new xi(n,e);case"GeometryCollection":for(o=0,s=r.geometries.length;o<s;o++){var c=bi({geometry:r.geometries[o],type:"Feature",properties:t.properties},e);c&&h.push(c)}return new ci(h);case"FeatureCollection":for(o=0,s=r.features.length;o<s;o++){var d=bi(r.features[o],e);d&&h.push(d)}return new ci(h);default:throw new Error("Invalid GeoJSON object.")}}function Pi(t,e,i,n){return t?t(e,i):new mi(i,n&&n.markersInheritOptions&&n)}function Li(t){return new v(t[1],t[0],t[2])}function Ti(t,e,i){for(var n,o=[],s=0,r=t.length;s<r;s++)n=e?Ti(t[s],e-1,i):(i||Li)(t[s]),o.push(n);return o}function Mi(t,e){return void 0!==(t=w(t)).alt?[i(t.lng,e),i(t.lat,e),i(t.alt,e)]:[i(t.lng,e),i(t.lat,e)]}function zi(t,e,i,n){for(var o=[],s=0,r=t.length;s<r;s++)o.push(e?zi(t[s],I(t[s])?0:e-1,i,n):Mi(t[s],n));return!e&&i&&0<o.length&&o.push(o[0].slice()),o}function Ci(t,e){return t.feature?l({},t.feature,{geometry:e}):Zi(e)}function Zi(t){return"Feature"===t.type||"FeatureCollection"===t.type?t:{type:"Feature",properties:{},geometry:t}}Tt={toGeoJSON:function(t){return Ci(this,{type:"Point",coordinates:Mi(this.getLatLng(),t)})}};function Si(t,e){return new wi(t,e)}mi.include(Tt),vi.include(Tt),gi.include(Tt),yi.include({toGeoJSON:function(t){var e=!I(this._latlngs);return Ci(this,{type:(e?"Multi":"")+"LineString",coordinates:zi(this._latlngs,e?1:0,!1,t)})}}),xi.include({toGeoJSON:function(t){var e=!I(this._latlngs),i=e&&!I(this._latlngs[0]),t=zi(this._latlngs,i?2:e?1:0,!0,t);return Ci(this,{type:(i?"Multi":"")+"Polygon",coordinates:t=e?t:[t]})}}),ui.include({toMultiPoint:function(e){var i=[];return this.eachLayer(function(t){i.push(t.toGeoJSON(e).geometry.coordinates)}),Ci(this,{type:"MultiPoint",coordinates:i})},toGeoJSON:function(e){var i,n,t=this.feature&&this.feature.geometry&&this.feature.geometry.type;return"MultiPoint"===t?this.toMultiPoint(e):(i="GeometryCollection"===t,n=[],this.eachLayer(function(t){t.toGeoJSON&&(t=t.toGeoJSON(e),i?n.push(t.geometry):"FeatureCollection"===(t=Zi(t)).type?n.push.apply(n,t.features):n.push(t))}),i?Ci(this,{geometries:n,type:"GeometryCollection"}):{type:"FeatureCollection",features:n})}});var Mt=Si,Ei=o.extend({options:{opacity:1,alt:"",interactive:!1,crossOrigin:!1,errorOverlayUrl:"",zIndex:1,className:""},initialize:function(t,e,i){this._url=t,this._bounds=g(e),c(this,i)},onAdd:function(){this._image||(this._initImage(),this.options.opacity<1&&this._updateOpacity()),this.options.interactive&&(M(this._image,"leaflet-interactive"),this.addInteractiveTarget(this._image)),this.getPane().appendChild(this._image),this._reset()},onRemove:function(){T(this._image),this.options.interactive&&this.removeInteractiveTarget(this._image)},setOpacity:function(t){return this.options.opacity=t,this._image&&this._updateOpacity(),this},setStyle:function(t){return t.opacity&&this.setOpacity(t.opacity),this},bringToFront:function(){return this._map&&fe(this._image),this},bringToBack:function(){return this._map&&ge(this._image),this},setUrl:function(t){return this._url=t,this._image&&(this._image.src=t),this},setBounds:function(t){return this._bounds=g(t),this._map&&this._reset(),this},getEvents:function(){var t={zoom:this._reset,viewreset:this._reset};return this._zoomAnimated&&(t.zoomanim=this._animateZoom),t},setZIndex:function(t){return this.options.zIndex=t,this._updateZIndex(),this},getBounds:function(){return this._bounds},getElement:function(){return this._image},_initImage:function(){var t="IMG"===this._url.tagName,e=this._image=t?this._url:P("img");M(e,"leaflet-image-layer"),this._zoomAnimated&&M(e,"leaflet-zoom-animated"),this.options.className&&M(e,this.options.className),e.onselectstart=u,e.onmousemove=u,e.onload=a(this.fire,this,"load"),e.onerror=a(this._overlayOnError,this,"error"),!this.options.crossOrigin&&""!==this.options.crossOrigin||(e.crossOrigin=!0===this.options.crossOrigin?"":this.options.crossOrigin),this.options.zIndex&&this._updateZIndex(),t?this._url=e.src:(e.src=this._url,e.alt=this.options.alt)},_animateZoom:function(t){var e=this._map.getZoomScale(t.zoom),t=this._map._latLngBoundsToNewLayerBounds(this._bounds,t.zoom,t.center).min;be(this._image,t,e)},_reset:function(){var t=this._image,e=new f(this._map.latLngToLayerPoint(this._bounds.getNorthWest()),this._map.latLngToLayerPoint(this._bounds.getSouthEast())),i=e.getSize();Z(t,e.min),t.style.width=i.x+"px",t.style.height=i.y+"px"},_updateOpacity:function(){C(this._image,this.options.opacity)},_updateZIndex:function(){this._image&&void 0!==this.options.zIndex&&null!==this.options.zIndex&&(this._image.style.zIndex=this.options.zIndex)},_overlayOnError:function(){this.fire("error");var t=this.options.errorOverlayUrl;t&&this._url!==t&&(this._url=t,this._image.src=t)},getCenter:function(){return this._bounds.getCenter()}}),ki=Ei.extend({options:{autoplay:!0,loop:!0,keepAspectRatio:!0,muted:!1,playsInline:!0},_initImage:function(){var t="VIDEO"===this._url.tagName,e=this._image=t?this._url:P("video");if(M(e,"leaflet-image-layer"),this._zoomAnimated&&M(e,"leaflet-zoom-animated"),this.options.className&&M(e,this.options.className),e.onselectstart=u,e.onmousemove=u,e.onloadeddata=a(this.fire,this,"load"),t){for(var i=e.getElementsByTagName("source"),n=[],o=0;o<i.length;o++)n.push(i[o].src);this._url=0<i.length?n:[e.src]}else{d(this._url)||(this._url=[this._url]),!this.options.keepAspectRatio&&Object.prototype.hasOwnProperty.call(e.style,"objectFit")&&(e.style.objectFit="fill"),e.autoplay=!!this.options.autoplay,e.loop=!!this.options.loop,e.muted=!!this.options.muted,e.playsInline=!!this.options.playsInline;for(var s=0;s<this._url.length;s++){var r=P("source");r.src=this._url[s],e.appendChild(r)}}}});var Oi=Ei.extend({_initImage:function(){var t=this._image=this._url;M(t,"leaflet-image-layer"),this._zoomAnimated&&M(t,"leaflet-zoom-animated"),this.options.className&&M(t,this.options.className),t.onselectstart=u,t.onmousemove=u}});var Ai=o.extend({options:{interactive:!1,offset:[0,0],className:"",pane:void 0,content:""},initialize:function(t,e){t&&(t instanceof v||d(t))?(this._latlng=w(t),c(this,e)):(c(this,t),this._source=e),this.options.content&&(this._content=this.options.content)},openOn:function(t){return(t=arguments.length?t:this._source._map).hasLayer(this)||t.addLayer(this),this},close:function(){return this._map&&this._map.removeLayer(this),this},toggle:function(t){return this._map?this.close():(arguments.length?this._source=t:t=this._source,this._prepareOpen(),this.openOn(t._map)),this},onAdd:function(t){this._zoomAnimated=t._zoomAnimated,this._container||this._initLayout(),t._fadeAnimated&&C(this._container,0),clearTimeout(this._removeTimeout),this.getPane().appendChild(this._container),this.update(),t._fadeAnimated&&C(this._container,1),this.bringToFront(),this.options.interactive&&(M(this._container,"leaflet-interactive"),this.addInteractiveTarget(this._container))},onRemove:function(t){t._fadeAnimated?(C(this._container,0),this._removeTimeout=setTimeout(a(T,void 0,this._container),200)):T(this._container),this.options.interactive&&(z(this._container,"leaflet-interactive"),this.removeInteractiveTarget(this._container))},getLatLng:function(){return this._latlng},setLatLng:function(t){return this._latlng=w(t),this._map&&(this._updatePosition(),this._adjustPan()),this},getContent:function(){return this._content},setContent:function(t){return this._content=t,this.update(),this},getElement:function(){return this._container},update:function(){this._map&&(this._container.style.visibility="hidden",this._updateContent(),this._updateLayout(),this._updatePosition(),this._container.style.visibility="",this._adjustPan())},getEvents:function(){var t={zoom:this._updatePosition,viewreset:this._updatePosition};return this._zoomAnimated&&(t.zoomanim=this._animateZoom),t},isOpen:function(){return!!this._map&&this._map.hasLayer(this)},bringToFront:function(){return this._map&&fe(this._container),this},bringToBack:function(){return this._map&&ge(this._container),this},_prepareOpen:function(t){if(!(i=this._source)._map)return!1;if(i instanceof ci){var e,i=null,n=this._source._layers;for(e in n)if(n[e]._map){i=n[e];break}if(!i)return!1;this._source=i}if(!t)if(i.getCenter)t=i.getCenter();else if(i.getLatLng)t=i.getLatLng();else{if(!i.getBounds)throw new Error("Unable to get source layer LatLng.");t=i.getBounds().getCenter()}return this.setLatLng(t),this._map&&this.update(),!0},_updateContent:function(){if(this._content){var t=this._contentNode,e="function"==typeof this._content?this._content(this._source||this):this._content;if("string"==typeof e)t.innerHTML=e;else{for(;t.hasChildNodes();)t.removeChild(t.firstChild);t.appendChild(e)}this.fire("contentupdate")}},_updatePosition:function(){var t,e,i;this._map&&(e=this._map.latLngToLayerPoint(this._latlng),t=m(this.options.offset),i=this._getAnchor(),this._zoomAnimated?Z(this._container,e.add(i)):t=t.add(e).add(i),e=this._containerBottom=-t.y,i=this._containerLeft=-Math.round(this._containerWidth/2)+t.x,this._container.style.bottom=e+"px",this._container.style.left=i+"px")},_getAnchor:function(){return[0,0]}}),Bi=(A.include({_initOverlay:function(t,e,i,n){var o=e;return o instanceof t||(o=new t(n).setContent(e)),i&&o.setLatLng(i),o}}),o.include({_initOverlay:function(t,e,i,n){var o=i;return o instanceof t?(c(o,n),o._source=this):(o=e&&!n?e:new t(n,this)).setContent(i),o}}),Ai.extend({options:{pane:"popupPane",offset:[0,7],maxWidth:300,minWidth:50,maxHeight:null,autoPan:!0,autoPanPaddingTopLeft:null,autoPanPaddingBottomRight:null,autoPanPadding:[5,5],keepInView:!1,closeButton:!0,autoClose:!0,closeOnEscapeKey:!0,className:""},openOn:function(t){return!(t=arguments.length?t:this._source._map).hasLayer(this)&&t._popup&&t._popup.options.autoClose&&t.removeLayer(t._popup),t._popup=this,Ai.prototype.openOn.call(this,t)},onAdd:function(t){Ai.prototype.onAdd.call(this,t),t.fire("popupopen",{popup:this}),this._source&&(this._source.fire("popupopen",{popup:this},!0),this._source instanceof fi||this._source.on("preclick",Ae))},onRemove:function(t){Ai.prototype.onRemove.call(this,t),t.fire("popupclose",{popup:this}),this._source&&(this._source.fire("popupclose",{popup:this},!0),this._source instanceof fi||this._source.off("preclick",Ae))},getEvents:function(){var t=Ai.prototype.getEvents.call(this);return(void 0!==this.options.closeOnClick?this.options.closeOnClick:this._map.options.closePopupOnClick)&&(t.preclick=this.close),this.options.keepInView&&(t.moveend=this._adjustPan),t},_initLayout:function(){var t="leaflet-popup",e=this._container=P("div",t+" "+(this.options.className||"")+" leaflet-zoom-animated"),i=this._wrapper=P("div",t+"-content-wrapper",e);this._contentNode=P("div",t+"-content",i),Ie(e),Be(this._contentNode),S(e,"contextmenu",Ae),this._tipContainer=P("div",t+"-tip-container",e),this._tip=P("div",t+"-tip",this._tipContainer),this.options.closeButton&&((i=this._closeButton=P("a",t+"-close-button",e)).setAttribute("role","button"),i.setAttribute("aria-label","Close popup"),i.href="#close",i.innerHTML='<span aria-hidden="true">&#215;</span>',S(i,"click",function(t){O(t),this.close()},this))},_updateLayout:function(){var t=this._contentNode,e=t.style,i=(e.width="",e.whiteSpace="nowrap",t.offsetWidth),i=Math.min(i,this.options.maxWidth),i=(i=Math.max(i,this.options.minWidth),e.width=i+1+"px",e.whiteSpace="",e.height="",t.offsetHeight),n=this.options.maxHeight,o="leaflet-popup-scrolled";(n&&n<i?(e.height=n+"px",M):z)(t,o),this._containerWidth=this._container.offsetWidth},_animateZoom:function(t){var t=this._map._latLngToNewLayerPoint(this._latlng,t.zoom,t.center),e=this._getAnchor();Z(this._container,t.add(e))},_adjustPan:function(){var t,e,i,n,o,s,r,a;this.options.autoPan&&(this._map._panAnim&&this._map._panAnim.stop(),this._autopanning?this._autopanning=!1:(t=this._map,e=parseInt(pe(this._container,"marginBottom"),10)||0,e=this._container.offsetHeight+e,a=this._containerWidth,(i=new p(this._containerLeft,-e-this._containerBottom))._add(Pe(this._container)),i=t.layerPointToContainerPoint(i),o=m(this.options.autoPanPadding),n=m(this.options.autoPanPaddingTopLeft||o),o=m(this.options.autoPanPaddingBottomRight||o),s=t.getSize(),r=0,i.x+a+o.x>s.x&&(r=i.x+a-s.x+o.x),i.x-r-n.x<(a=0)&&(r=i.x-n.x),i.y+e+o.y>s.y&&(a=i.y+e-s.y+o.y),i.y-a-n.y<0&&(a=i.y-n.y),(r||a)&&(this.options.keepInView&&(this._autopanning=!0),t.fire("autopanstart").panBy([r,a]))))},_getAnchor:function(){return m(this._source&&this._source._getPopupAnchor?this._source._getPopupAnchor():[0,0])}})),Ii=(A.mergeOptions({closePopupOnClick:!0}),A.include({openPopup:function(t,e,i){return this._initOverlay(Bi,t,e,i).openOn(this),this},closePopup:function(t){return(t=arguments.length?t:this._popup)&&t.close(),this}}),o.include({bindPopup:function(t,e){return this._popup=this._initOverlay(Bi,this._popup,t,e),this._popupHandlersAdded||(this.on({click:this._openPopup,keypress:this._onKeyPress,remove:this.closePopup,move:this._movePopup}),this._popupHandlersAdded=!0),this},unbindPopup:function(){return this._popup&&(this.off({click:this._openPopup,keypress:this._onKeyPress,remove:this.closePopup,move:this._movePopup}),this._popupHandlersAdded=!1,this._popup=null),this},openPopup:function(t){return this._popup&&(this instanceof ci||(this._popup._source=this),this._popup._prepareOpen(t||this._latlng)&&this._popup.openOn(this._map)),this},closePopup:function(){return this._popup&&this._popup.close(),this},togglePopup:function(){return this._popup&&this._popup.toggle(this),this},isPopupOpen:function(){return!!this._popup&&this._popup.isOpen()},setPopupContent:function(t){return this._popup&&this._popup.setContent(t),this},getPopup:function(){return this._popup},_openPopup:function(t){var e;this._popup&&this._map&&(Re(t),e=t.layer||t.target,this._popup._source!==e||e instanceof fi?(this._popup._source=e,this.openPopup(t.latlng)):this._map.hasLayer(this._popup)?this.closePopup():this.openPopup(t.latlng))},_movePopup:function(t){this._popup.setLatLng(t.latlng)},_onKeyPress:function(t){13===t.originalEvent.keyCode&&this._openPopup(t)}}),Ai.extend({options:{pane:"tooltipPane",offset:[0,0],direction:"auto",permanent:!1,sticky:!1,opacity:.9},onAdd:function(t){Ai.prototype.onAdd.call(this,t),this.setOpacity(this.options.opacity),t.fire("tooltipopen",{tooltip:this}),this._source&&(this.addEventParent(this._source),this._source.fire("tooltipopen",{tooltip:this},!0))},onRemove:function(t){Ai.prototype.onRemove.call(this,t),t.fire("tooltipclose",{tooltip:this}),this._source&&(this.removeEventParent(this._source),this._source.fire("tooltipclose",{tooltip:this},!0))},getEvents:function(){var t=Ai.prototype.getEvents.call(this);return this.options.permanent||(t.preclick=this.close),t},_initLayout:function(){var t="leaflet-tooltip "+(this.options.className||"")+" leaflet-zoom-"+(this._zoomAnimated?"animated":"hide");this._contentNode=this._container=P("div",t),this._container.setAttribute("role","tooltip"),this._container.setAttribute("id","leaflet-tooltip-"+h(this))},_updateLayout:function(){},_adjustPan:function(){},_setPosition:function(t){var e,i=this._map,n=this._container,o=i.latLngToContainerPoint(i.getCenter()),i=i.layerPointToContainerPoint(t),s=this.options.direction,r=n.offsetWidth,a=n.offsetHeight,h=m(this.options.offset),l=this._getAnchor(),i="top"===s?(e=r/2,a):"bottom"===s?(e=r/2,0):(e="center"===s?r/2:"right"===s?0:"left"===s?r:i.x<o.x?(s="right",0):(s="left",r+2*(h.x+l.x)),a/2);t=t.subtract(m(e,i,!0)).add(h).add(l),z(n,"leaflet-tooltip-right"),z(n,"leaflet-tooltip-left"),z(n,"leaflet-tooltip-top"),z(n,"leaflet-tooltip-bottom"),M(n,"leaflet-tooltip-"+s),Z(n,t)},_updatePosition:function(){var t=this._map.latLngToLayerPoint(this._latlng);this._setPosition(t)},setOpacity:function(t){this.options.opacity=t,this._container&&C(this._container,t)},_animateZoom:function(t){t=this._map._latLngToNewLayerPoint(this._latlng,t.zoom,t.center);this._setPosition(t)},_getAnchor:function(){return m(this._source&&this._source._getTooltipAnchor&&!this.options.sticky?this._source._getTooltipAnchor():[0,0])}})),Ri=(A.include({openTooltip:function(t,e,i){return this._initOverlay(Ii,t,e,i).openOn(this),this},closeTooltip:function(t){return t.close(),this}}),o.include({bindTooltip:function(t,e){return this._tooltip&&this.isTooltipOpen()&&this.unbindTooltip(),this._tooltip=this._initOverlay(Ii,this._tooltip,t,e),this._initTooltipInteractions(),this._tooltip.options.permanent&&this._map&&this._map.hasLayer(this)&&this.openTooltip(),this},unbindTooltip:function(){return this._tooltip&&(this._initTooltipInteractions(!0),this.closeTooltip(),this._tooltip=null),this},_initTooltipInteractions:function(t){var e,i;!t&&this._tooltipHandlersAdded||(e=t?"off":"on",i={remove:this.closeTooltip,move:this._moveTooltip},this._tooltip.options.permanent?i.add=this._openTooltip:(i.mouseover=this._openTooltip,i.mouseout=this.closeTooltip,i.click=this._openTooltip,this._map?this._addFocusListeners():i.add=this._addFocusListeners),this._tooltip.options.sticky&&(i.mousemove=this._moveTooltip),this[e](i),this._tooltipHandlersAdded=!t)},openTooltip:function(t){return this._tooltip&&(this instanceof ci||(this._tooltip._source=this),this._tooltip._prepareOpen(t)&&(this._tooltip.openOn(this._map),this.getElement?this._setAriaDescribedByOnLayer(this):this.eachLayer&&this.eachLayer(this._setAriaDescribedByOnLayer,this))),this},closeTooltip:function(){if(this._tooltip)return this._tooltip.close()},toggleTooltip:function(){return this._tooltip&&this._tooltip.toggle(this),this},isTooltipOpen:function(){return this._tooltip.isOpen()},setTooltipContent:function(t){return this._tooltip&&this._tooltip.setContent(t),this},getTooltip:function(){return this._tooltip},_addFocusListeners:function(){this.getElement?this._addFocusListenersOnLayer(this):this.eachLayer&&this.eachLayer(this._addFocusListenersOnLayer,this)},_addFocusListenersOnLayer:function(t){var e="function"==typeof t.getElement&&t.getElement();e&&(S(e,"focus",function(){this._tooltip._source=t,this.openTooltip()},this),S(e,"blur",this.closeTooltip,this))},_setAriaDescribedByOnLayer:function(t){t="function"==typeof t.getElement&&t.getElement();t&&t.setAttribute("aria-describedby",this._tooltip._container.id)},_openTooltip:function(t){var e;this._tooltip&&this._map&&(this._map.dragging&&this._map.dragging.moving()&&!this._openOnceFlag?(this._openOnceFlag=!0,(e=this)._map.once("moveend",function(){e._openOnceFlag=!1,e._openTooltip(t)})):(this._tooltip._source=t.layer||t.target,this.openTooltip(this._tooltip.options.sticky?t.latlng:void 0)))},_moveTooltip:function(t){var e=t.latlng;this._tooltip.options.sticky&&t.originalEvent&&(t=this._map.mouseEventToContainerPoint(t.originalEvent),t=this._map.containerPointToLayerPoint(t),e=this._map.layerPointToLatLng(t)),this._tooltip.setLatLng(e)}}),di.extend({options:{iconSize:[12,12],html:!1,bgPos:null,className:"leaflet-div-icon"},createIcon:function(t){var t=t&&"DIV"===t.tagName?t:document.createElement("div"),e=this.options;return e.html instanceof Element?(me(t),t.appendChild(e.html)):t.innerHTML=!1!==e.html?e.html:"",e.bgPos&&(e=m(e.bgPos),t.style.backgroundPosition=-e.x+"px "+-e.y+"px"),this._setIconStyles(t,"icon"),t},createShadow:function(){return null}}));di.Default=_i;var Ni=o.extend({options:{tileSize:256,opacity:1,updateWhenIdle:b.mobile,updateWhenZooming:!0,updateInterval:200,zIndex:1,bounds:null,minZoom:0,maxZoom:void 0,maxNativeZoom:void 0,minNativeZoom:void 0,noWrap:!1,pane:"tilePane",className:"",keepBuffer:2},initialize:function(t){c(this,t)},onAdd:function(){this._initContainer(),this._levels={},this._tiles={},this._resetView()},beforeAdd:function(t){t._addZoomLimit(this)},onRemove:function(t){this._removeAllTiles(),T(this._container),t._removeZoomLimit(this),this._container=null,this._tileZoom=void 0},bringToFront:function(){return this._map&&(fe(this._container),this._setAutoZIndex(Math.max)),this},bringToBack:function(){return this._map&&(ge(this._container),this._setAutoZIndex(Math.min)),this},getContainer:function(){return this._container},setOpacity:function(t){return this.options.opacity=t,this._updateOpacity(),this},setZIndex:function(t){return this.options.zIndex=t,this._updateZIndex(),this},isLoading:function(){return this._loading},redraw:function(){var t;return this._map&&(this._removeAllTiles(),(t=this._clampZoom(this._map.getZoom()))!==this._tileZoom&&(this._tileZoom=t,this._updateLevels()),this._update()),this},getEvents:function(){var t={viewprereset:this._invalidateAll,viewreset:this._resetView,zoom:this._resetView,moveend:this._onMoveEnd};return this.options.updateWhenIdle||(this._onMove||(this._onMove=j(this._onMoveEnd,this.options.updateInterval,this)),t.move=this._onMove),this._zoomAnimated&&(t.zoomanim=this._animateZoom),t},createTile:function(){return document.createElement("div")},getTileSize:function(){var t=this.options.tileSize;return t instanceof p?t:new p(t,t)},_updateZIndex:function(){this._container&&void 0!==this.options.zIndex&&null!==this.options.zIndex&&(this._container.style.zIndex=this.options.zIndex)},_setAutoZIndex:function(t){for(var e,i=this.getPane().children,n=-t(-1/0,1/0),o=0,s=i.length;o<s;o++)e=i[o].style.zIndex,i[o]!==this._container&&e&&(n=t(n,+e));isFinite(n)&&(this.options.zIndex=n+t(-1,1),this._updateZIndex())},_updateOpacity:function(){if(this._map&&!b.ielt9){C(this._container,this.options.opacity);var t,e=+new Date,i=!1,n=!1;for(t in this._tiles){var o,s=this._tiles[t];s.current&&s.loaded&&(o=Math.min(1,(e-s.loaded)/200),C(s.el,o),o<1?i=!0:(s.active?n=!0:this._onOpaqueTile(s),s.active=!0))}n&&!this._noPrune&&this._pruneTiles(),i&&(r(this._fadeFrame),this._fadeFrame=x(this._updateOpacity,this))}},_onOpaqueTile:u,_initContainer:function(){this._container||(this._container=P("div","leaflet-layer "+(this.options.className||"")),this._updateZIndex(),this.options.opacity<1&&this._updateOpacity(),this.getPane().appendChild(this._container))},_updateLevels:function(){var t=this._tileZoom,e=this.options.maxZoom;if(void 0!==t){for(var i in this._levels)i=Number(i),this._levels[i].el.children.length||i===t?(this._levels[i].el.style.zIndex=e-Math.abs(t-i),this._onUpdateLevel(i)):(T(this._levels[i].el),this._removeTilesAtZoom(i),this._onRemoveLevel(i),delete this._levels[i]);var n=this._levels[t],o=this._map;return n||((n=this._levels[t]={}).el=P("div","leaflet-tile-container leaflet-zoom-animated",this._container),n.el.style.zIndex=e,n.origin=o.project(o.unproject(o.getPixelOrigin()),t).round(),n.zoom=t,this._setZoomTransform(n,o.getCenter(),o.getZoom()),u(n.el.offsetWidth),this._onCreateLevel(n)),this._level=n}},_onUpdateLevel:u,_onRemoveLevel:u,_onCreateLevel:u,_pruneTiles:function(){if(this._map){var t,e,i,n=this._map.getZoom();if(n>this.options.maxZoom||n<this.options.minZoom)this._removeAllTiles();else{for(t in this._tiles)(i=this._tiles[t]).retain=i.current;for(t in this._tiles)(i=this._tiles[t]).current&&!i.active&&(e=i.coords,this._retainParent(e.x,e.y,e.z,e.z-5)||this._retainChildren(e.x,e.y,e.z,e.z+2));for(t in this._tiles)this._tiles[t].retain||this._removeTile(t)}}},_removeTilesAtZoom:function(t){for(var e in this._tiles)this._tiles[e].coords.z===t&&this._removeTile(e)},_removeAllTiles:function(){for(var t in this._tiles)this._removeTile(t)},_invalidateAll:function(){for(var t in this._levels)T(this._levels[t].el),this._onRemoveLevel(Number(t)),delete this._levels[t];this._removeAllTiles(),this._tileZoom=void 0},_retainParent:function(t,e,i,n){var t=Math.floor(t/2),e=Math.floor(e/2),i=i-1,o=new p(+t,+e),o=(o.z=i,this._tileCoordsToKey(o)),o=this._tiles[o];return o&&o.active?o.retain=!0:(o&&o.loaded&&(o.retain=!0),n<i&&this._retainParent(t,e,i,n))},_retainChildren:function(t,e,i,n){for(var o=2*t;o<2*t+2;o++)for(var s=2*e;s<2*e+2;s++){var r=new p(o,s),r=(r.z=i+1,this._tileCoordsToKey(r)),r=this._tiles[r];r&&r.active?r.retain=!0:(r&&r.loaded&&(r.retain=!0),i+1<n&&this._retainChildren(o,s,i+1,n))}},_resetView:function(t){t=t&&(t.pinch||t.flyTo);this._setView(this._map.getCenter(),this._map.getZoom(),t,t)},_animateZoom:function(t){this._setView(t.center,t.zoom,!0,t.noUpdate)},_clampZoom:function(t){var e=this.options;return void 0!==e.minNativeZoom&&t<e.minNativeZoom?e.minNativeZoom:void 0!==e.maxNativeZoom&&e.maxNativeZoom<t?e.maxNativeZoom:t},_setView:function(t,e,i,n){var o=Math.round(e),o=void 0!==this.options.maxZoom&&o>this.options.maxZoom||void 0!==this.options.minZoom&&o<this.options.minZoom?void 0:this._clampZoom(o),s=this.options.updateWhenZooming&&o!==this._tileZoom;n&&!s||(this._tileZoom=o,this._abortLoading&&this._abortLoading(),this._updateLevels(),this._resetGrid(),void 0!==o&&this._update(t),i||this._pruneTiles(),this._noPrune=!!i),this._setZoomTransforms(t,e)},_setZoomTransforms:function(t,e){for(var i in this._levels)this._setZoomTransform(this._levels[i],t,e)},_setZoomTransform:function(t,e,i){var n=this._map.getZoomScale(i,t.zoom),e=t.origin.multiplyBy(n).subtract(this._map._getNewPixelOrigin(e,i)).round();b.any3d?be(t.el,e,n):Z(t.el,e)},_resetGrid:function(){var t=this._map,e=t.options.crs,i=this._tileSize=this.getTileSize(),n=this._tileZoom,o=this._map.getPixelWorldBounds(this._tileZoom);o&&(this._globalTileRange=this._pxBoundsToTileRange(o)),this._wrapX=e.wrapLng&&!this.options.noWrap&&[Math.floor(t.project([0,e.wrapLng[0]],n).x/i.x),Math.ceil(t.project([0,e.wrapLng[1]],n).x/i.y)],this._wrapY=e.wrapLat&&!this.options.noWrap&&[Math.floor(t.project([e.wrapLat[0],0],n).y/i.x),Math.ceil(t.project([e.wrapLat[1],0],n).y/i.y)]},_onMoveEnd:function(){this._map&&!this._map._animatingZoom&&this._update()},_getTiledPixelBounds:function(t){var e=this._map,i=e._animatingZoom?Math.max(e._animateToZoom,e.getZoom()):e.getZoom(),i=e.getZoomScale(i,this._tileZoom),t=e.project(t,this._tileZoom).floor(),e=e.getSize().divideBy(2*i);return new f(t.subtract(e),t.add(e))},_update:function(t){var e=this._map;if(e){var i=this._clampZoom(e.getZoom());if(void 0===t&&(t=e.getCenter()),void 0!==this._tileZoom){var n,e=this._getTiledPixelBounds(t),o=this._pxBoundsToTileRange(e),s=o.getCenter(),r=[],e=this.options.keepBuffer,a=new f(o.getBottomLeft().subtract([e,-e]),o.getTopRight().add([e,-e]));if(!(isFinite(o.min.x)&&isFinite(o.min.y)&&isFinite(o.max.x)&&isFinite(o.max.y)))throw new Error("Attempted to load an infinite number of tiles");for(n in this._tiles){var h=this._tiles[n].coords;h.z===this._tileZoom&&a.contains(new p(h.x,h.y))||(this._tiles[n].current=!1)}if(1<Math.abs(i-this._tileZoom))this._setView(t,i);else{for(var l=o.min.y;l<=o.max.y;l++)for(var u=o.min.x;u<=o.max.x;u++){var c,d=new p(u,l);d.z=this._tileZoom,this._isValidTile(d)&&((c=this._tiles[this._tileCoordsToKey(d)])?c.current=!0:r.push(d))}if(r.sort(function(t,e){return t.distanceTo(s)-e.distanceTo(s)}),0!==r.length){this._loading||(this._loading=!0,this.fire("loading"));for(var _=document.createDocumentFragment(),u=0;u<r.length;u++)this._addTile(r[u],_);this._level.el.appendChild(_)}}}}},_isValidTile:function(t){var e=this._map.options.crs;if(!e.infinite){var i=this._globalTileRange;if(!e.wrapLng&&(t.x<i.min.x||t.x>i.max.x)||!e.wrapLat&&(t.y<i.min.y||t.y>i.max.y))return!1}return!this.options.bounds||(e=this._tileCoordsToBounds(t),g(this.options.bounds).overlaps(e))},_keyToBounds:function(t){return this._tileCoordsToBounds(this._keyToTileCoords(t))},_tileCoordsToNwSe:function(t){var e=this._map,i=this.getTileSize(),n=t.scaleBy(i),i=n.add(i);return[e.unproject(n,t.z),e.unproject(i,t.z)]},_tileCoordsToBounds:function(t){t=this._tileCoordsToNwSe(t),t=new s(t[0],t[1]);return t=this.options.noWrap?t:this._map.wrapLatLngBounds(t)},_tileCoordsToKey:function(t){return t.x+":"+t.y+":"+t.z},_keyToTileCoords:function(t){var t=t.split(":"),e=new p(+t[0],+t[1]);return e.z=+t[2],e},_removeTile:function(t){var e=this._tiles[t];e&&(T(e.el),delete this._tiles[t],this.fire("tileunload",{tile:e.el,coords:this._keyToTileCoords(t)}))},_initTile:function(t){M(t,"leaflet-tile");var e=this.getTileSize();t.style.width=e.x+"px",t.style.height=e.y+"px",t.onselectstart=u,t.onmousemove=u,b.ielt9&&this.options.opacity<1&&C(t,this.options.opacity)},_addTile:function(t,e){var i=this._getTilePos(t),n=this._tileCoordsToKey(t),o=this.createTile(this._wrapCoords(t),a(this._tileReady,this,t));this._initTile(o),this.createTile.length<2&&x(a(this._tileReady,this,t,null,o)),Z(o,i),this._tiles[n]={el:o,coords:t,current:!0},e.appendChild(o),this.fire("tileloadstart",{tile:o,coords:t})},_tileReady:function(t,e,i){e&&this.fire("tileerror",{error:e,tile:i,coords:t});var n=this._tileCoordsToKey(t);(i=this._tiles[n])&&(i.loaded=+new Date,this._map._fadeAnimated?(C(i.el,0),r(this._fadeFrame),this._fadeFrame=x(this._updateOpacity,this)):(i.active=!0,this._pruneTiles()),e||(M(i.el,"leaflet-tile-loaded"),this.fire("tileload",{tile:i.el,coords:t})),this._noTilesToLoad()&&(this._loading=!1,this.fire("load"),b.ielt9||!this._map._fadeAnimated?x(this._pruneTiles,this):setTimeout(a(this._pruneTiles,this),250)))},_getTilePos:function(t){return t.scaleBy(this.getTileSize()).subtract(this._level.origin)},_wrapCoords:function(t){var e=new p(this._wrapX?H(t.x,this._wrapX):t.x,this._wrapY?H(t.y,this._wrapY):t.y);return e.z=t.z,e},_pxBoundsToTileRange:function(t){var e=this.getTileSize();return new f(t.min.unscaleBy(e).floor(),t.max.unscaleBy(e).ceil().subtract([1,1]))},_noTilesToLoad:function(){for(var t in this._tiles)if(!this._tiles[t].loaded)return!1;return!0}});var Di=Ni.extend({options:{minZoom:0,maxZoom:18,subdomains:"abc",errorTileUrl:"",zoomOffset:0,tms:!1,zoomReverse:!1,detectRetina:!1,crossOrigin:!1,referrerPolicy:!1},initialize:function(t,e){this._url=t,(e=c(this,e)).detectRetina&&b.retina&&0<e.maxZoom?(e.tileSize=Math.floor(e.tileSize/2),e.zoomReverse?(e.zoomOffset--,e.minZoom=Math.min(e.maxZoom,e.minZoom+1)):(e.zoomOffset++,e.maxZoom=Math.max(e.minZoom,e.maxZoom-1)),e.minZoom=Math.max(0,e.minZoom)):e.zoomReverse?e.minZoom=Math.min(e.maxZoom,e.minZoom):e.maxZoom=Math.max(e.minZoom,e.maxZoom),"string"==typeof e.subdomains&&(e.subdomains=e.subdomains.split("")),this.on("tileunload",this._onTileRemove)},setUrl:function(t,e){return this._url===t&&void 0===e&&(e=!0),this._url=t,e||this.redraw(),this},createTile:function(t,e){var i=document.createElement("img");return S(i,"load",a(this._tileOnLoad,this,e,i)),S(i,"error",a(this._tileOnError,this,e,i)),!this.options.crossOrigin&&""!==this.options.crossOrigin||(i.crossOrigin=!0===this.options.crossOrigin?"":this.options.crossOrigin),"string"==typeof this.options.referrerPolicy&&(i.referrerPolicy=this.options.referrerPolicy),i.alt="",i.src=this.getTileUrl(t),i},getTileUrl:function(t){var e={r:b.retina?"@2x":"",s:this._getSubdomain(t),x:t.x,y:t.y,z:this._getZoomForUrl()};return this._map&&!this._map.options.crs.infinite&&(t=this._globalTileRange.max.y-t.y,this.options.tms&&(e.y=t),e["-y"]=t),q(this._url,l(e,this.options))},_tileOnLoad:function(t,e){b.ielt9?setTimeout(a(t,this,null,e),0):t(null,e)},_tileOnError:function(t,e,i){var n=this.options.errorTileUrl;n&&e.getAttribute("src")!==n&&(e.src=n),t(i,e)},_onTileRemove:function(t){t.tile.onload=null},_getZoomForUrl:function(){var t=this._tileZoom,e=this.options.maxZoom;return(t=this.options.zoomReverse?e-t:t)+this.options.zoomOffset},_getSubdomain:function(t){t=Math.abs(t.x+t.y)%this.options.subdomains.length;return this.options.subdomains[t]},_abortLoading:function(){var t,e,i;for(t in this._tiles)this._tiles[t].coords.z!==this._tileZoom&&((i=this._tiles[t].el).onload=u,i.onerror=u,i.complete||(i.src=K,e=this._tiles[t].coords,T(i),delete this._tiles[t],this.fire("tileabort",{tile:i,coords:e})))},_removeTile:function(t){var e=this._tiles[t];if(e)return e.el.setAttribute("src",K),Ni.prototype._removeTile.call(this,t)},_tileReady:function(t,e,i){if(this._map&&(!i||i.getAttribute("src")!==K))return Ni.prototype._tileReady.call(this,t,e,i)}});function ji(t,e){return new Di(t,e)}var Hi=Di.extend({defaultWmsParams:{service:"WMS",request:"GetMap",layers:"",styles:"",format:"image/jpeg",transparent:!1,version:"1.1.1"},options:{crs:null,uppercase:!1},initialize:function(t,e){this._url=t;var i,n=l({},this.defaultWmsParams);for(i in e)i in this.options||(n[i]=e[i]);var t=(e=c(this,e)).detectRetina&&b.retina?2:1,o=this.getTileSize();n.width=o.x*t,n.height=o.y*t,this.wmsParams=n},onAdd:function(t){this._crs=this.options.crs||t.options.crs,this._wmsVersion=parseFloat(this.wmsParams.version);var e=1.3<=this._wmsVersion?"crs":"srs";this.wmsParams[e]=this._crs.code,Di.prototype.onAdd.call(this,t)},getTileUrl:function(t){var e=this._tileCoordsToNwSe(t),i=this._crs,i=_(i.project(e[0]),i.project(e[1])),e=i.min,i=i.max,e=(1.3<=this._wmsVersion&&this._crs===li?[e.y,e.x,i.y,i.x]:[e.x,e.y,i.x,i.y]).join(","),i=Di.prototype.getTileUrl.call(this,t);return i+U(this.wmsParams,i,this.options.uppercase)+(this.options.uppercase?"&BBOX=":"&bbox=")+e},setParams:function(t,e){return l(this.wmsParams,t),e||this.redraw(),this}});Di.WMS=Hi,ji.wms=function(t,e){return new Hi(t,e)};var Wi=o.extend({options:{padding:.1},initialize:function(t){c(this,t),h(this),this._layers=this._layers||{}},onAdd:function(){this._container||(this._initContainer(),M(this._container,"leaflet-zoom-animated")),this.getPane().appendChild(this._container),this._update(),this.on("update",this._updatePaths,this)},onRemove:function(){this.off("update",this._updatePaths,this),this._destroyContainer()},getEvents:function(){var t={viewreset:this._reset,zoom:this._onZoom,moveend:this._update,zoomend:this._onZoomEnd};return this._zoomAnimated&&(t.zoomanim=this._onAnimZoom),t},_onAnimZoom:function(t){this._updateTransform(t.center,t.zoom)},_onZoom:function(){this._updateTransform(this._map.getCenter(),this._map.getZoom())},_updateTransform:function(t,e){var i=this._map.getZoomScale(e,this._zoom),n=this._map.getSize().multiplyBy(.5+this.options.padding),o=this._map.project(this._center,e),n=n.multiplyBy(-i).add(o).subtract(this._map._getNewPixelOrigin(t,e));b.any3d?be(this._container,n,i):Z(this._container,n)},_reset:function(){for(var t in this._update(),this._updateTransform(this._center,this._zoom),this._layers)this._layers[t]._reset()},_onZoomEnd:function(){for(var t in this._layers)this._layers[t]._project()},_updatePaths:function(){for(var t in this._layers)this._layers[t]._update()},_update:function(){var t=this.options.padding,e=this._map.getSize(),i=this._map.containerPointToLayerPoint(e.multiplyBy(-t)).round();this._bounds=new f(i,i.add(e.multiplyBy(1+2*t)).round()),this._center=this._map.getCenter(),this._zoom=this._map.getZoom()}}),Fi=Wi.extend({options:{tolerance:0},getEvents:function(){var t=Wi.prototype.getEvents.call(this);return t.viewprereset=this._onViewPreReset,t},_onViewPreReset:function(){this._postponeUpdatePaths=!0},onAdd:function(){Wi.prototype.onAdd.call(this),this._draw()},_initContainer:function(){var t=this._container=document.createElement("canvas");S(t,"mousemove",this._onMouseMove,this),S(t,"click dblclick mousedown mouseup contextmenu",this._onClick,this),S(t,"mouseout",this._handleMouseOut,this),t._leaflet_disable_events=!0,this._ctx=t.getContext("2d")},_destroyContainer:function(){r(this._redrawRequest),delete this._ctx,T(this._container),k(this._container),delete this._container},_updatePaths:function(){if(!this._postponeUpdatePaths){for(var t in this._redrawBounds=null,this._layers)this._layers[t]._update();this._redraw()}},_update:function(){var t,e,i,n;this._map._animatingZoom&&this._bounds||(Wi.prototype._update.call(this),t=this._bounds,e=this._container,i=t.getSize(),n=b.retina?2:1,Z(e,t.min),e.width=n*i.x,e.height=n*i.y,e.style.width=i.x+"px",e.style.height=i.y+"px",b.retina&&this._ctx.scale(2,2),this._ctx.translate(-t.min.x,-t.min.y),this.fire("update"))},_reset:function(){Wi.prototype._reset.call(this),this._postponeUpdatePaths&&(this._postponeUpdatePaths=!1,this._updatePaths())},_initPath:function(t){this._updateDashArray(t);t=(this._layers[h(t)]=t)._order={layer:t,prev:this._drawLast,next:null};this._drawLast&&(this._drawLast.next=t),this._drawLast=t,this._drawFirst=this._drawFirst||this._drawLast},_addPath:function(t){this._requestRedraw(t)},_removePath:function(t){var e=t._order,i=e.next,e=e.prev;i?i.prev=e:this._drawLast=e,e?e.next=i:this._drawFirst=i,delete t._order,delete this._layers[h(t)],this._requestRedraw(t)},_updatePath:function(t){this._extendRedrawBounds(t),t._project(),t._update(),this._requestRedraw(t)},_updateStyle:function(t){this._updateDashArray(t),this._requestRedraw(t)},_updateDashArray:function(t){if("string"==typeof t.options.dashArray){for(var e,i=t.options.dashArray.split(/[, ]+/),n=[],o=0;o<i.length;o++){if(e=Number(i[o]),isNaN(e))return;n.push(e)}t.options._dashArray=n}else t.options._dashArray=t.options.dashArray},_requestRedraw:function(t){this._map&&(this._extendRedrawBounds(t),this._redrawRequest=this._redrawRequest||x(this._redraw,this))},_extendRedrawBounds:function(t){var e;t._pxBounds&&(e=(t.options.weight||0)+1,this._redrawBounds=this._redrawBounds||new f,this._redrawBounds.extend(t._pxBounds.min.subtract([e,e])),this._redrawBounds.extend(t._pxBounds.max.add([e,e])))},_redraw:function(){this._redrawRequest=null,this._redrawBounds&&(this._redrawBounds.min._floor(),this._redrawBounds.max._ceil()),this._clear(),this._draw(),this._redrawBounds=null},_clear:function(){var t,e=this._redrawBounds;e?(t=e.getSize(),this._ctx.clearRect(e.min.x,e.min.y,t.x,t.y)):(this._ctx.save(),this._ctx.setTransform(1,0,0,1,0,0),this._ctx.clearRect(0,0,this._container.width,this._container.height),this._ctx.restore())},_draw:function(){var t,e,i=this._redrawBounds;this._ctx.save(),i&&(e=i.getSize(),this._ctx.beginPath(),this._ctx.rect(i.min.x,i.min.y,e.x,e.y),this._ctx.clip()),this._drawing=!0;for(var n=this._drawFirst;n;n=n.next)t=n.layer,(!i||t._pxBounds&&t._pxBounds.intersects(i))&&t._updatePath();this._drawing=!1,this._ctx.restore()},_updatePoly:function(t,e){if(this._drawing){var i,n,o,s,r=t._parts,a=r.length,h=this._ctx;if(a){for(h.beginPath(),i=0;i<a;i++){for(n=0,o=r[i].length;n<o;n++)s=r[i][n],h[n?"lineTo":"moveTo"](s.x,s.y);e&&h.closePath()}this._fillStroke(h,t)}}},_updateCircle:function(t){var e,i,n,o;this._drawing&&!t._empty()&&(e=t._point,i=this._ctx,n=Math.max(Math.round(t._radius),1),1!=(o=(Math.max(Math.round(t._radiusY),1)||n)/n)&&(i.save(),i.scale(1,o)),i.beginPath(),i.arc(e.x,e.y/o,n,0,2*Math.PI,!1),1!=o&&i.restore(),this._fillStroke(i,t))},_fillStroke:function(t,e){var i=e.options;i.fill&&(t.globalAlpha=i.fillOpacity,t.fillStyle=i.fillColor||i.color,t.fill(i.fillRule||"evenodd")),i.stroke&&0!==i.weight&&(t.setLineDash&&t.setLineDash(e.options&&e.options._dashArray||[]),t.globalAlpha=i.opacity,t.lineWidth=i.weight,t.strokeStyle=i.color,t.lineCap=i.lineCap,t.lineJoin=i.lineJoin,t.stroke())},_onClick:function(t){for(var e,i,n=this._map.mouseEventToLayerPoint(t),o=this._drawFirst;o;o=o.next)(e=o.layer).options.interactive&&e._containsPoint(n)&&(("click"===t.type||"preclick"===t.type)&&this._map._draggableMoved(e)||(i=e));this._fireEvent(!!i&&[i],t)},_onMouseMove:function(t){var e;!this._map||this._map.dragging.moving()||this._map._animatingZoom||(e=this._map.mouseEventToLayerPoint(t),this._handleMouseHover(t,e))},_handleMouseOut:function(t){var e=this._hoveredLayer;e&&(z(this._container,"leaflet-interactive"),this._fireEvent([e],t,"mouseout"),this._hoveredLayer=null,this._mouseHoverThrottled=!1)},_handleMouseHover:function(t,e){if(!this._mouseHoverThrottled){for(var i,n,o=this._drawFirst;o;o=o.next)(i=o.layer).options.interactive&&i._containsPoint(e)&&(n=i);n!==this._hoveredLayer&&(this._handleMouseOut(t),n&&(M(this._container,"leaflet-interactive"),this._fireEvent([n],t,"mouseover"),this._hoveredLayer=n)),this._fireEvent(!!this._hoveredLayer&&[this._hoveredLayer],t),this._mouseHoverThrottled=!0,setTimeout(a(function(){this._mouseHoverThrottled=!1},this),32)}},_fireEvent:function(t,e,i){this._map._fireDOMEvent(e,i||e.type,t)},_bringToFront:function(t){var e,i,n=t._order;n&&(e=n.next,i=n.prev,e&&((e.prev=i)?i.next=e:e&&(this._drawFirst=e),n.prev=this._drawLast,(this._drawLast.next=n).next=null,this._drawLast=n,this._requestRedraw(t)))},_bringToBack:function(t){var e,i,n=t._order;n&&(e=n.next,(i=n.prev)&&((i.next=e)?e.prev=i:i&&(this._drawLast=i),n.prev=null,n.next=this._drawFirst,this._drawFirst.prev=n,this._drawFirst=n,this._requestRedraw(t)))}});function Ui(t){return b.canvas?new Fi(t):null}var Vi=function(){try{return document.namespaces.add("lvml","urn:schemas-microsoft-com:vml"),function(t){return document.createElement("<lvml:"+t+' class="lvml">')}}catch(t){}return function(t){return document.createElement("<"+t+' xmlns="urn:schemas-microsoft.com:vml" class="lvml">')}}(),zt={_initContainer:function(){this._container=P("div","leaflet-vml-container")},_update:function(){this._map._animatingZoom||(Wi.prototype._update.call(this),this.fire("update"))},_initPath:function(t){var e=t._container=Vi("shape");M(e,"leaflet-vml-shape "+(this.options.className||"")),e.coordsize="1 1",t._path=Vi("path"),e.appendChild(t._path),this._updateStyle(t),this._layers[h(t)]=t},_addPath:function(t){var e=t._container;this._container.appendChild(e),t.options.interactive&&t.addInteractiveTarget(e)},_removePath:function(t){var e=t._container;T(e),t.removeInteractiveTarget(e),delete this._layers[h(t)]},_updateStyle:function(t){var e=t._stroke,i=t._fill,n=t.options,o=t._container;o.stroked=!!n.stroke,o.filled=!!n.fill,n.stroke?(e=e||(t._stroke=Vi("stroke")),o.appendChild(e),e.weight=n.weight+"px",e.color=n.color,e.opacity=n.opacity,n.dashArray?e.dashStyle=d(n.dashArray)?n.dashArray.join(" "):n.dashArray.replace(/( *, *)/g," "):e.dashStyle="",e.endcap=n.lineCap.replace("butt","flat"),e.joinstyle=n.lineJoin):e&&(o.removeChild(e),t._stroke=null),n.fill?(i=i||(t._fill=Vi("fill")),o.appendChild(i),i.color=n.fillColor||n.color,i.opacity=n.fillOpacity):i&&(o.removeChild(i),t._fill=null)},_updateCircle:function(t){var e=t._point.round(),i=Math.round(t._radius),n=Math.round(t._radiusY||i);this._setPath(t,t._empty()?"M0 0":"AL "+e.x+","+e.y+" "+i+","+n+" 0,23592600")},_setPath:function(t,e){t._path.v=e},_bringToFront:function(t){fe(t._container)},_bringToBack:function(t){ge(t._container)}},qi=b.vml?Vi:ct,Gi=Wi.extend({_initContainer:function(){this._container=qi("svg"),this._container.setAttribute("pointer-events","none"),this._rootGroup=qi("g"),this._container.appendChild(this._rootGroup)},_destroyContainer:function(){T(this._container),k(this._container),delete this._container,delete this._rootGroup,delete this._svgSize},_update:function(){var t,e,i;this._map._animatingZoom&&this._bounds||(Wi.prototype._update.call(this),e=(t=this._bounds).getSize(),i=this._container,this._svgSize&&this._svgSize.equals(e)||(this._svgSize=e,i.setAttribute("width",e.x),i.setAttribute("height",e.y)),Z(i,t.min),i.setAttribute("viewBox",[t.min.x,t.min.y,e.x,e.y].join(" ")),this.fire("update"))},_initPath:function(t){var e=t._path=qi("path");t.options.className&&M(e,t.options.className),t.options.interactive&&M(e,"leaflet-interactive"),this._updateStyle(t),this._layers[h(t)]=t},_addPath:function(t){this._rootGroup||this._initContainer(),this._rootGroup.appendChild(t._path),t.addInteractiveTarget(t._path)},_removePath:function(t){T(t._path),t.removeInteractiveTarget(t._path),delete this._layers[h(t)]},_updatePath:function(t){t._project(),t._update()},_updateStyle:function(t){var e=t._path,t=t.options;e&&(t.stroke?(e.setAttribute("stroke",t.color),e.setAttribute("stroke-opacity",t.opacity),e.setAttribute("stroke-width",t.weight),e.setAttribute("stroke-linecap",t.lineCap),e.setAttribute("stroke-linejoin",t.lineJoin),t.dashArray?e.setAttribute("stroke-dasharray",t.dashArray):e.removeAttribute("stroke-dasharray"),t.dashOffset?e.setAttribute("stroke-dashoffset",t.dashOffset):e.removeAttribute("stroke-dashoffset")):e.setAttribute("stroke","none"),t.fill?(e.setAttribute("fill",t.fillColor||t.color),e.setAttribute("fill-opacity",t.fillOpacity),e.setAttribute("fill-rule",t.fillRule||"evenodd")):e.setAttribute("fill","none"))},_updatePoly:function(t,e){this._setPath(t,dt(t._parts,e))},_updateCircle:function(t){var e=t._point,i=Math.max(Math.round(t._radius),1),n="a"+i+","+(Math.max(Math.round(t._radiusY),1)||i)+" 0 1,0 ",e=t._empty()?"M0 0":"M"+(e.x-i)+","+e.y+n+2*i+",0 "+n+2*-i+",0 ";this._setPath(t,e)},_setPath:function(t,e){t._path.setAttribute("d",e)},_bringToFront:function(t){fe(t._path)},_bringToBack:function(t){ge(t._path)}});function Ki(t){return b.svg||b.vml?new Gi(t):null}b.vml&&Gi.include(zt),A.include({getRenderer:function(t){t=(t=t.options.renderer||this._getPaneRenderer(t.options.pane)||this.options.renderer||this._renderer)||(this._renderer=this._createRenderer());return this.hasLayer(t)||this.addLayer(t),t},_getPaneRenderer:function(t){var e;return"overlayPane"!==t&&void 0!==t&&(void 0===(e=this._paneRenderers[t])&&(e=this._createRenderer({pane:t}),this._paneRenderers[t]=e),e)},_createRenderer:function(t){return this.options.preferCanvas&&Ui(t)||Ki(t)}});var Yi=xi.extend({initialize:function(t,e){xi.prototype.initialize.call(this,this._boundsToLatLngs(t),e)},setBounds:function(t){return this.setLatLngs(this._boundsToLatLngs(t))},_boundsToLatLngs:function(t){return[(t=g(t)).getSouthWest(),t.getNorthWest(),t.getNorthEast(),t.getSouthEast()]}});Gi.create=qi,Gi.pointsToPath=dt,wi.geometryToLayer=bi,wi.coordsToLatLng=Li,wi.coordsToLatLngs=Ti,wi.latLngToCoords=Mi,wi.latLngsToCoords=zi,wi.getFeature=Ci,wi.asFeature=Zi,A.mergeOptions({boxZoom:!0});var _t=n.extend({initialize:function(t){this._map=t,this._container=t._container,this._pane=t._panes.overlayPane,this._resetStateTimeout=0,t.on("unload",this._destroy,this)},addHooks:function(){S(this._container,"mousedown",this._onMouseDown,this)},removeHooks:function(){k(this._container,"mousedown",this._onMouseDown,this)},moved:function(){return this._moved},_destroy:function(){T(this._pane),delete this._pane},_resetState:function(){this._resetStateTimeout=0,this._moved=!1},_clearDeferredResetState:function(){0!==this._resetStateTimeout&&(clearTimeout(this._resetStateTimeout),this._resetStateTimeout=0)},_onMouseDown:function(t){if(!t.shiftKey||1!==t.which&&1!==t.button)return!1;this._clearDeferredResetState(),this._resetState(),re(),Le(),this._startPoint=this._map.mouseEventToContainerPoint(t),S(document,{contextmenu:Re,mousemove:this._onMouseMove,mouseup:this._onMouseUp,keydown:this._onKeyDown},this)},_onMouseMove:function(t){this._moved||(this._moved=!0,this._box=P("div","leaflet-zoom-box",this._container),M(this._container,"leaflet-crosshair"),this._map.fire("boxzoomstart")),this._point=this._map.mouseEventToContainerPoint(t);var t=new f(this._point,this._startPoint),e=t.getSize();Z(this._box,t.min),this._box.style.width=e.x+"px",this._box.style.height=e.y+"px"},_finish:function(){this._moved&&(T(this._box),z(this._container,"leaflet-crosshair")),ae(),Te(),k(document,{contextmenu:Re,mousemove:this._onMouseMove,mouseup:this._onMouseUp,keydown:this._onKeyDown},this)},_onMouseUp:function(t){1!==t.which&&1!==t.button||(this._finish(),this._moved&&(this._clearDeferredResetState(),this._resetStateTimeout=setTimeout(a(this._resetState,this),0),t=new s(this._map.containerPointToLatLng(this._startPoint),this._map.containerPointToLatLng(this._point)),this._map.fitBounds(t).fire("boxzoomend",{boxZoomBounds:t})))},_onKeyDown:function(t){27===t.keyCode&&(this._finish(),this._clearDeferredResetState(),this._resetState())}}),Ct=(A.addInitHook("addHandler","boxZoom",_t),A.mergeOptions({doubleClickZoom:!0}),n.extend({addHooks:function(){this._map.on("dblclick",this._onDoubleClick,this)},removeHooks:function(){this._map.off("dblclick",this._onDoubleClick,this)},_onDoubleClick:function(t){var e=this._map,i=e.getZoom(),n=e.options.zoomDelta,i=t.originalEvent.shiftKey?i-n:i+n;"center"===e.options.doubleClickZoom?e.setZoom(i):e.setZoomAround(t.containerPoint,i)}})),Zt=(A.addInitHook("addHandler","doubleClickZoom",Ct),A.mergeOptions({dragging:!0,inertia:!0,inertiaDeceleration:3400,inertiaMaxSpeed:1/0,easeLinearity:.2,worldCopyJump:!1,maxBoundsViscosity:0}),n.extend({addHooks:function(){var t;this._draggable||(t=this._map,this._draggable=new Xe(t._mapPane,t._container),this._draggable.on({dragstart:this._onDragStart,drag:this._onDrag,dragend:this._onDragEnd},this),this._draggable.on("predrag",this._onPreDragLimit,this),t.options.worldCopyJump&&(this._draggable.on("predrag",this._onPreDragWrap,this),t.on("zoomend",this._onZoomEnd,this),t.whenReady(this._onZoomEnd,this))),M(this._map._container,"leaflet-grab leaflet-touch-drag"),this._draggable.enable(),this._positions=[],this._times=[]},removeHooks:function(){z(this._map._container,"leaflet-grab"),z(this._map._container,"leaflet-touch-drag"),this._draggable.disable()},moved:function(){return this._draggable&&this._draggable._moved},moving:function(){return this._draggable&&this._draggable._moving},_onDragStart:function(){var t,e=this._map;e._stop(),this._map.options.maxBounds&&this._map.options.maxBoundsViscosity?(t=g(this._map.options.maxBounds),this._offsetLimit=_(this._map.latLngToContainerPoint(t.getNorthWest()).multiplyBy(-1),this._map.latLngToContainerPoint(t.getSouthEast()).multiplyBy(-1).add(this._map.getSize())),this._viscosity=Math.min(1,Math.max(0,this._map.options.maxBoundsViscosity))):this._offsetLimit=null,e.fire("movestart").fire("dragstart"),e.options.inertia&&(this._positions=[],this._times=[])},_onDrag:function(t){var e,i;this._map.options.inertia&&(e=this._lastTime=+new Date,i=this._lastPos=this._draggable._absPos||this._draggable._newPos,this._positions.push(i),this._times.push(e),this._prunePositions(e)),this._map.fire("move",t).fire("drag",t)},_prunePositions:function(t){for(;1<this._positions.length&&50<t-this._times[0];)this._positions.shift(),this._times.shift()},_onZoomEnd:function(){var t=this._map.getSize().divideBy(2),e=this._map.latLngToLayerPoint([0,0]);this._initialWorldOffset=e.subtract(t).x,this._worldWidth=this._map.getPixelWorldBounds().getSize().x},_viscousLimit:function(t,e){return t-(t-e)*this._viscosity},_onPreDragLimit:function(){var t,e;this._viscosity&&this._offsetLimit&&(t=this._draggable._newPos.subtract(this._draggable._startPos),e=this._offsetLimit,t.x<e.min.x&&(t.x=this._viscousLimit(t.x,e.min.x)),t.y<e.min.y&&(t.y=this._viscousLimit(t.y,e.min.y)),t.x>e.max.x&&(t.x=this._viscousLimit(t.x,e.max.x)),t.y>e.max.y&&(t.y=this._viscousLimit(t.y,e.max.y)),this._draggable._newPos=this._draggable._startPos.add(t))},_onPreDragWrap:function(){var t=this._worldWidth,e=Math.round(t/2),i=this._initialWorldOffset,n=this._draggable._newPos.x,o=(n-e+i)%t+e-i,n=(n+e+i)%t-e-i,t=Math.abs(o+i)<Math.abs(n+i)?o:n;this._draggable._absPos=this._draggable._newPos.clone(),this._draggable._newPos.x=t},_onDragEnd:function(t){var e,i,n,o,s=this._map,r=s.options,a=!r.inertia||t.noInertia||this._times.length<2;s.fire("dragend",t),!a&&(this._prunePositions(+new Date),t=this._lastPos.subtract(this._positions[0]),a=(this._lastTime-this._times[0])/1e3,e=r.easeLinearity,a=(t=t.multiplyBy(e/a)).distanceTo([0,0]),i=Math.min(r.inertiaMaxSpeed,a),t=t.multiplyBy(i/a),n=i/(r.inertiaDeceleration*e),(o=t.multiplyBy(-n/2).round()).x||o.y)?(o=s._limitOffset(o,s.options.maxBounds),x(function(){s.panBy(o,{duration:n,easeLinearity:e,noMoveStart:!0,animate:!0})})):s.fire("moveend")}})),St=(A.addInitHook("addHandler","dragging",Zt),A.mergeOptions({keyboard:!0,keyboardPanDelta:80}),n.extend({keyCodes:{left:[37],right:[39],down:[40],up:[38],zoomIn:[187,107,61,171],zoomOut:[189,109,54,173]},initialize:function(t){this._map=t,this._setPanDelta(t.options.keyboardPanDelta),this._setZoomDelta(t.options.zoomDelta)},addHooks:function(){var t=this._map._container;t.tabIndex<=0&&(t.tabIndex="0"),S(t,{focus:this._onFocus,blur:this._onBlur,mousedown:this._onMouseDown},this),this._map.on({focus:this._addHooks,blur:this._removeHooks},this)},removeHooks:function(){this._removeHooks(),k(this._map._container,{focus:this._onFocus,blur:this._onBlur,mousedown:this._onMouseDown},this),this._map.off({focus:this._addHooks,blur:this._removeHooks},this)},_onMouseDown:function(){var t,e,i;this._focused||(i=document.body,t=document.documentElement,e=i.scrollTop||t.scrollTop,i=i.scrollLeft||t.scrollLeft,this._map._container.focus(),window.scrollTo(i,e))},_onFocus:function(){this._focused=!0,this._map.fire("focus")},_onBlur:function(){this._focused=!1,this._map.fire("blur")},_setPanDelta:function(t){for(var e=this._panKeys={},i=this.keyCodes,n=0,o=i.left.length;n<o;n++)e[i.left[n]]=[-1*t,0];for(n=0,o=i.right.length;n<o;n++)e[i.right[n]]=[t,0];for(n=0,o=i.down.length;n<o;n++)e[i.down[n]]=[0,t];for(n=0,o=i.up.length;n<o;n++)e[i.up[n]]=[0,-1*t]},_setZoomDelta:function(t){for(var e=this._zoomKeys={},i=this.keyCodes,n=0,o=i.zoomIn.length;n<o;n++)e[i.zoomIn[n]]=t;for(n=0,o=i.zoomOut.length;n<o;n++)e[i.zoomOut[n]]=-t},_addHooks:function(){S(document,"keydown",this._onKeyDown,this)},_removeHooks:function(){k(document,"keydown",this._onKeyDown,this)},_onKeyDown:function(t){if(!(t.altKey||t.ctrlKey||t.metaKey)){var e,i,n=t.keyCode,o=this._map;if(n in this._panKeys)o._panAnim&&o._panAnim._inProgress||(i=this._panKeys[n],t.shiftKey&&(i=m(i).multiplyBy(3)),o.options.maxBounds&&(i=o._limitOffset(m(i),o.options.maxBounds)),o.options.worldCopyJump?(e=o.wrapLatLng(o.unproject(o.project(o.getCenter()).add(i))),o.panTo(e)):o.panBy(i));else if(n in this._zoomKeys)o.setZoom(o.getZoom()+(t.shiftKey?3:1)*this._zoomKeys[n]);else{if(27!==n||!o._popup||!o._popup.options.closeOnEscapeKey)return;o.closePopup()}Re(t)}}})),Et=(A.addInitHook("addHandler","keyboard",St),A.mergeOptions({scrollWheelZoom:!0,wheelDebounceTime:40,wheelPxPerZoomLevel:60}),n.extend({addHooks:function(){S(this._map._container,"wheel",this._onWheelScroll,this),this._delta=0},removeHooks:function(){k(this._map._container,"wheel",this._onWheelScroll,this)},_onWheelScroll:function(t){var e=He(t),i=this._map.options.wheelDebounceTime,e=(this._delta+=e,this._lastMousePos=this._map.mouseEventToContainerPoint(t),this._startTime||(this._startTime=+new Date),Math.max(i-(+new Date-this._startTime),0));clearTimeout(this._timer),this._timer=setTimeout(a(this._performZoom,this),e),Re(t)},_performZoom:function(){var t=this._map,e=t.getZoom(),i=this._map.options.zoomSnap||0,n=(t._stop(),this._delta/(4*this._map.options.wheelPxPerZoomLevel)),n=4*Math.log(2/(1+Math.exp(-Math.abs(n))))/Math.LN2,i=i?Math.ceil(n/i)*i:n,n=t._limitZoom(e+(0<this._delta?i:-i))-e;this._delta=0,this._startTime=null,n&&("center"===t.options.scrollWheelZoom?t.setZoom(e+n):t.setZoomAround(this._lastMousePos,e+n))}})),kt=(A.addInitHook("addHandler","scrollWheelZoom",Et),A.mergeOptions({tapHold:b.touchNative&&b.safari&&b.mobile,tapTolerance:15}),n.extend({addHooks:function(){S(this._map._container,"touchstart",this._onDown,this)},removeHooks:function(){k(this._map._container,"touchstart",this._onDown,this)},_onDown:function(t){var e;clearTimeout(this._holdTimeout),1===t.touches.length&&(e=t.touches[0],this._startPos=this._newPos=new p(e.clientX,e.clientY),this._holdTimeout=setTimeout(a(function(){this._cancel(),this._isTapValid()&&(S(document,"touchend",O),S(document,"touchend touchcancel",this._cancelClickPrevent),this._simulateEvent("contextmenu",e))},this),600),S(document,"touchend touchcancel contextmenu",this._cancel,this),S(document,"touchmove",this._onMove,this))},_cancelClickPrevent:function t(){k(document,"touchend",O),k(document,"touchend touchcancel",t)},_cancel:function(){clearTimeout(this._holdTimeout),k(document,"touchend touchcancel contextmenu",this._cancel,this),k(document,"touchmove",this._onMove,this)},_onMove:function(t){t=t.touches[0];this._newPos=new p(t.clientX,t.clientY)},_isTapValid:function(){return this._newPos.distanceTo(this._startPos)<=this._map.options.tapTolerance},_simulateEvent:function(t,e){t=new MouseEvent(t,{bubbles:!0,cancelable:!0,view:window,screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY});t._simulated=!0,e.target.dispatchEvent(t)}})),Ot=(A.addInitHook("addHandler","tapHold",kt),A.mergeOptions({touchZoom:b.touch,bounceAtZoomLimits:!0}),n.extend({addHooks:function(){M(this._map._container,"leaflet-touch-zoom"),S(this._map._container,"touchstart",this._onTouchStart,this)},removeHooks:function(){z(this._map._container,"leaflet-touch-zoom"),k(this._map._container,"touchstart",this._onTouchStart,this)},_onTouchStart:function(t){var e,i,n=this._map;!t.touches||2!==t.touches.length||n._animatingZoom||this._zooming||(e=n.mouseEventToContainerPoint(t.touches[0]),i=n.mouseEventToContainerPoint(t.touches[1]),this._centerPoint=n.getSize()._divideBy(2),this._startLatLng=n.containerPointToLatLng(this._centerPoint),"center"!==n.options.touchZoom&&(this._pinchStartLatLng=n.containerPointToLatLng(e.add(i)._divideBy(2))),this._startDist=e.distanceTo(i),this._startZoom=n.getZoom(),this._moved=!1,this._zooming=!0,n._stop(),S(document,"touchmove",this._onTouchMove,this),S(document,"touchend touchcancel",this._onTouchEnd,this),O(t))},_onTouchMove:function(t){if(t.touches&&2===t.touches.length&&this._zooming){var e=this._map,i=e.mouseEventToContainerPoint(t.touches[0]),n=e.mouseEventToContainerPoint(t.touches[1]),o=i.distanceTo(n)/this._startDist;if(this._zoom=e.getScaleZoom(o,this._startZoom),!e.options.bounceAtZoomLimits&&(this._zoom<e.getMinZoom()&&o<1||this._zoom>e.getMaxZoom()&&1<o)&&(this._zoom=e._limitZoom(this._zoom)),"center"===e.options.touchZoom){if(this._center=this._startLatLng,1==o)return}else{i=i._add(n)._divideBy(2)._subtract(this._centerPoint);if(1==o&&0===i.x&&0===i.y)return;this._center=e.unproject(e.project(this._pinchStartLatLng,this._zoom).subtract(i),this._zoom)}this._moved||(e._moveStart(!0,!1),this._moved=!0),r(this._animRequest);n=a(e._move,e,this._center,this._zoom,{pinch:!0,round:!1},void 0);this._animRequest=x(n,this,!0),O(t)}},_onTouchEnd:function(){this._moved&&this._zooming?(this._zooming=!1,r(this._animRequest),k(document,"touchmove",this._onTouchMove,this),k(document,"touchend touchcancel",this._onTouchEnd,this),this._map.options.zoomAnimation?this._map._animateZoom(this._center,this._map._limitZoom(this._zoom),!0,this._map.options.zoomSnap):this._map._resetView(this._center,this._map._limitZoom(this._zoom))):this._zooming=!1}})),Xi=(A.addInitHook("addHandler","touchZoom",Ot),A.BoxZoom=_t,A.DoubleClickZoom=Ct,A.Drag=Zt,A.Keyboard=St,A.ScrollWheelZoom=Et,A.TapHold=kt,A.TouchZoom=Ot,t.Bounds=f,t.Browser=b,t.CRS=ot,t.Canvas=Fi,t.Circle=vi,t.CircleMarker=gi,t.Class=et,t.Control=B,t.DivIcon=Ri,t.DivOverlay=Ai,t.DomEvent=mt,t.DomUtil=pt,t.Draggable=Xe,t.Evented=it,t.FeatureGroup=ci,t.GeoJSON=wi,t.GridLayer=Ni,t.Handler=n,t.Icon=di,t.ImageOverlay=Ei,t.LatLng=v,t.LatLngBounds=s,t.Layer=o,t.LayerGroup=ui,t.LineUtil=vt,t.Map=A,t.Marker=mi,t.Mixin=ft,t.Path=fi,t.Point=p,t.PolyUtil=gt,t.Polygon=xi,t.Polyline=yi,t.Popup=Bi,t.PosAnimation=Fe,t.Projection=wt,t.Rectangle=Yi,t.Renderer=Wi,t.SVG=Gi,t.SVGOverlay=Oi,t.TileLayer=Di,t.Tooltip=Ii,t.Transformation=at,t.Util=tt,t.VideoOverlay=ki,t.bind=a,t.bounds=_,t.canvas=Ui,t.circle=function(t,e,i){return new vi(t,e,i)},t.circleMarker=function(t,e){return new gi(t,e)},t.control=Ue,t.divIcon=function(t){return new Ri(t)},t.extend=l,t.featureGroup=function(t,e){return new ci(t,e)},t.geoJSON=Si,t.geoJson=Mt,t.gridLayer=function(t){return new Ni(t)},t.icon=function(t){return new di(t)},t.imageOverlay=function(t,e,i){return new Ei(t,e,i)},t.latLng=w,t.latLngBounds=g,t.layerGroup=function(t,e){return new ui(t,e)},t.map=function(t,e){return new A(t,e)},t.marker=function(t,e){return new mi(t,e)},t.point=m,t.polygon=function(t,e){return new xi(t,e)},t.polyline=function(t,e){return new yi(t,e)},t.popup=function(t,e){return new Bi(t,e)},t.rectangle=function(t,e){return new Yi(t,e)},t.setOptions=c,t.stamp=h,t.svg=Ki,t.svgOverlay=function(t,e,i){return new Oi(t,e,i)},t.tileLayer=ji,t.tooltip=function(t,e){return new Ii(t,e)},t.transformation=ht,t.version="1.9.4",t.videoOverlay=function(t,e,i){return new ki(t,e,i)},window.L);t.noConflict=function(){return window.L=Xi,this},window.L=t});
/* Leaflet-Instanz festhalten, unabhängig davon, was später an `window.L` hängt. */
  } catch (error) {
    console.warn("busch-map-card: Leaflet liess sich nicht laden", error);
  }
  return window.L || null;
}


/* ═══════════════════════════════════════════════════════════════════════════
 * Karten-Karte — die eingebaute `map`-Karte mit frei wählbaren Kacheln.
 *
 * Der Kniff: Diese Karte baut die Landkarte NICHT nach. Sie erzeugt Home
 * Assistants eigene `map`-Karte, hängt sie in ihren Shadow-DOM und tauscht
 * danach nur die Kachelebene aus. Alles andere — Entitäten, Zonenkreise,
 * `hours_to_show`-Spuren, Genauigkeitsringe, Personenbilder, Beschriftungen,
 * `auto_fit`, `cluster` — bleibt identisch, weil es dieselbe Karte IST.
 *
 * Nachbauen wäre der teurere Weg: 14 Optionen plus sechs Felder je Entität,
 * und bei jedem Home-Assistant-Update droht neue Abweichung.
 *
 * Der Preis ist eine Abhängigkeit von HA-Interna (`ha-map.leafletMap`).
 * Deshalb gilt: Bricht der Kniff, faellt die Karte auf HAs normale Karte mit
 * deren eigenen Kacheln zurueck — niemals auf eine leere Karte.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Kachelvorlagen. Alle ohne Schlüssel nutzbar.
 *
 * Die Quellenangabe je Vorlage ist keine Kosmetik: OpenStreetMap, CARTO, Esri
 * und OpenTopoMap verlangen sie in ihren Nutzungsbedingungen. Wer eine eigene
 * URL einträgt, traegt auch die eigene Angabe ein.
 *
 * `{r}` ersetzt Leaflet durch "@2x" nur bei `detectRetina`, sonst durch nichts
 * — das Feld darf also gefahrlos in der URL stehen.
 */
const MAP_STYLES = {
  ha: {
    name: "Home-Assistant-Standard",
    keep: true,   // Kacheln gar nicht anfassen
  },
  osm: {
    name: "OpenStreetMap",
    light: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  carto: {
    name: "CARTO Positron / Dark Matter",
    keyParam: "key",
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  voyager: {
    name: "CARTO Voyager",
    keyParam: "key",
    light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    dark: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    name: "Esri Satellit",
    light: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: 'Kacheln &copy; Esri — Quellen: Esri, Maxar, Earthstar Geographics und die GIS-Gemeinschaft',
  },
  topo: {
    name: "OpenTopoMap",
    light: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 17,
    attribution: 'Kartendaten &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://viewfinderpanoramas.org">SRTM</a> · Darstellung &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  },
  custom: {
    name: "Eigene URL",
    custom: true,
  },
};

const MAP_CARD_DEFAULTS = { map_style: "carto" };

/** Wo der Schluessel liegt, wenn er nicht in der Karte steht.
 *
 *  Ein Kachelschluessel gehoert EINMAL ins System, nicht in jede Karte. Ein
 *  `input_text`-Helfer ist dafuer der richtige Ort: er wird einmal angelegt,
 *  gilt fuer alle Dashboards und alle Geraete, und er landet nie in diesem
 *  oeffentlichen Repo. Wer mehrere Anbieter mischt, zeigt je Karte mit
 *  `tile_api_key_entity` auf einen anderen Helfer. */
const MAP_KEY_ENTITY = "input_text.carto_api_key";

/** Eigene Leaflet-Ebene fuer den Vektorfall. Fester Name, damit ein zweiter
 *  Aufruf dieselbe Ebene wiederfindet statt eine weitere anzulegen. */
const MAP_PANE = "busch-map-tiles";

/** Eigene Optionen der Karte — alles Uebrige gehoert der eingebauten Karte. */
const MAP_OWN_KEYS = [
  "map_style", "tile_url", "tile_url_dark", "tile_attribution", "tile_max_zoom",
  "tile_api_key", "tile_api_key_entity",
];

const SCHEMA_BUSCH_MAP_CARD = [
  {
    name: "map_style",
    selector: {
      select: {
        mode: "dropdown",
        // Die Beschriftungen der Vorlagen sind Eigennamen (OpenStreetMap,
        // CARTO, Esri) und in beiden Sprachen gleich. Nur `ha` und `custom`
        // heissen anders — `buschSchemaMitTexten` ersetzt genau die beiden
        // aus `texte.map_style_ha` bzw. `texte.map_style_custom`.
        options: Object.entries(MAP_STYLES).map(([value, s]) => ({ value, label: s.name })),
      },
    },
  },
  { name: "tile_url", selector: { text: {} } },
  { name: "tile_url_dark", selector: { text: {} } },
  { name: "tile_attribution", selector: { text: {} } },
  { name: "tile_max_zoom", selector: { number: { min: 1, max: 22, step: 1, mode: "box" } } },
  { name: "tile_api_key", selector: { text: {} } },
  {
    name: "tile_api_key_entity",
    selector: { entity: { filter: { domain: ["input_text"] } } },
  },
];

const TEXTE_BUSCH_MAP_CARD = {
  de: {
    name: "Busch Landkarte",
    description: "Die eingebaute Map-Karte mit frei wählbaren Kacheln — nur der Typ wird getauscht.",
    labels: {
      map_style: "Kartenvorlage",
      tile_url: "Eigene Kachel-URL",
      tile_url_dark: "Eigene Kachel-URL dunkel",
      tile_attribution: "Eigene Quellenangabe",
      tile_max_zoom: "Größte Zoomstufe",
      tile_api_key: "Schlüssel",
      tile_api_key_entity: "Schlüssel-Helfer",
    },
    helpers: {
      map_style: "Welche Kacheln die Karte zeichnet. Home-Assistant-Standard lässt sie unberührt. Vorgabe: CARTO Positron / Dark Matter.",
      tile_url: "Gilt nur bei der Vorlage Eigene URL. Eine Kachel-URL mit den Platzhaltern für Zoom, Spalte und Zeile. Vorgabe: leer.",
      tile_url_dark: "Wird im dunklen Thema anstelle der hellen URL geladen. Leer heißt: die helle gilt in beiden Themen. Vorgabe: leer.",
      tile_attribution: "Die Quellenangabe unten rechts in der Karte. Die meisten Anbieter verlangen sie. Vorgabe: leer.",
      tile_max_zoom: "Die größte Zoomstufe, die die eigene Kachelquelle liefert. Gilt nur bei der Vorlage Eigene URL. Vorgabe 19.",
      tile_api_key: "Ein Kachelschlüssel nur für diese Karte. Er überschreibt den Helfer. Vorgabe: leer, dann gilt der Helfer.",
      tile_api_key_entity: "Der input_text-Helfer, in dem der Kachelschlüssel steht. Ein Eintrag genügt für alle Karten. Vorgabe: input_text.carto_api_key.",
    },
    texte: {
      map_style_ha: "Home-Assistant-Standard",
      map_style_custom: "Eigene URL",
      innenTitel: "Alles Weitere wie bei der eingebauten Karte:",
      karteFehlt: "Die eingebaute Karte ließ sich nicht erzeugen: {grund}",
      editorFehlt: "Der eingebaute Map-Editor ließ sich nicht laden — die übrigen Optionen bitte in YAML bearbeiten. Sie sind dieselben wie bei type: map.",
    },
  },
  en: {
    name: "Busch map",
    description: "The built-in map card with freely chosen tiles — only the type changes.",
    labels: {
      map_style: "Tile preset",
      tile_url: "Own tile URL",
      tile_url_dark: "Own tile URL dark",
      tile_attribution: "Own attribution",
      tile_max_zoom: "Maximum zoom",
      tile_api_key: "Key",
      tile_api_key_entity: "Key helper",
    },
    helpers: {
      map_style: "Which tiles the map draws. Home Assistant default leaves them untouched. Default: CARTO Positron / Dark Matter.",
      tile_url: "Only used with the Own URL preset. A tile URL with the placeholders for zoom, column and row. Default: empty.",
      tile_url_dark: "Loaded instead of the light URL in the dark theme. Empty means the light one applies to both. Default: empty.",
      tile_attribution: "The attribution in the bottom right of the map. Most providers require it. Default: empty.",
      tile_max_zoom: "The highest zoom level your own tile source serves. Only used with the Own URL preset. Default 19.",
      tile_api_key: "A tile key for this card alone. It overrides the helper. Default: empty, then the helper applies.",
      tile_api_key_entity: "The input_text helper holding the tile key. One entry is enough for every card. Default: input_text.carto_api_key.",
    },
    texte: {
      map_style_ha: "Home Assistant default",
      map_style_custom: "Own URL",
      innenTitel: "Everything else as on the built-in card:",
      karteFehlt: "The built-in map card could not be created: {grund}",
      editorFehlt: "The built-in map editor could not be loaded — please edit the remaining options in YAML. They are the same as for type: map.",
    },
  },
};

/** Sucht ein Element durch verschachtelte Shadow-DOMs, mit Tiefenbegrenzung.
 *  Ohne Grenze laeuft die Suche auf einer grossen Oberflaeche lange. */
function queryDeepShadow(root, selector, depth = 6) {
  if (!root || depth < 0) return null;
  const direct = root.querySelector?.(selector);
  if (direct) return direct;
  const kinder = root.querySelectorAll ? root.querySelectorAll("*") : [];
  for (const kind of kinder) {
    if (kind.shadowRoot) {
      const treffer = queryDeepShadow(kind.shadowRoot, selector, depth - 1);
      if (treffer) return treffer;
    }
  }
  return null;
}

class BuschMapCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-map-card-editor");
  }

  static getStubConfig(hass) {
    const person = Object.keys(hass?.states || {}).find((id) => id.startsWith("person."));
    return {
      type: "custom:busch-map-card",
      entities: person ? [person] : [],
      map_style: "carto",
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._inner = null;
    this._haMap = null;
    this._layer = null;
    this._urspruenglich = null;   // Zustand vor dem Eingriff, fuer den Rueckfall
    this._dunkel = null;
    this._versuche = 0;
    this._gewarnt = false;
  }

  setConfig(config) {
    if (!config) throw new Error("busch-map-card: Konfiguration fehlt");
    this._config = { ...MAP_CARD_DEFAULTS, ...config };
    this._inner = null;
    this._haMap = null;
    this._layer = null;
    this._build();
  }

  set hass(hass) {
    const dunkelVorher = this._dunkelJetzt();
    const schluesselVorher = this._schluessel();
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
    // Auch der Schluessel kann sich aendern — er steht in einem Helfer, den
    // der Nutzer jederzeit bearbeitet. Ohne diese Pruefung bliebe das
    // Wasserzeichen bis zum naechsten Neuladen stehen.
    if (this._layer
        && (this._dunkelJetzt() !== dunkelVorher || this._schluessel() !== schluesselVorher)) {
      this._applyTiles();
    }
  }

  getCardSize() {
    if (this._inner && typeof this._inner.getCardSize === "function") {
      return this._inner.getCardSize();
    }
    return 5;
  }

  /** Spalten in Vielfachen von 3 (Regel 3). Dieselben Masse wie bei HAs
   *  eingebauter Map-Karte: eine Landkarte unter halber Breite zeigt nichts. */
  getGridOptions() {
    return { columns: 12, rows: 4, min_columns: 6, min_rows: 3 };
  }

  /** Der Textabschnitt der geltenden Sprache. */
  get _texte() {
    return buschTexte(TEXTE_BUSCH_MAP_CARD, this._hass).texte;
  }

  /** Konfiguration fuer die eingebaute Karte: die eigenen Schluessel muessen
   *  raus, sonst reicht man ihr Felder, die sie nicht kennt. */
  _innerConfig() {
    const rest = { ...this._config };
    for (const key of MAP_OWN_KEYS) delete rest[key];
    rest.type = "map";
    return rest;
  }

  _stil() {
    const stil = MAP_STYLES[this._config.map_style] || MAP_STYLES.carto;
    if (!stil.custom) return stil;
    return {
      name: stil.name,
      light: this._config.tile_url || "",
      dark: this._config.tile_url_dark || "",
      attribution: this._config.tile_attribution || "",
      maxZoom: Number(this._config.tile_max_zoom) || 19,
    };
  }

  /** Der Schluessel, in dieser Reihenfolge: direkt in der Karte, sonst aus
   *  dem Helfer. So genuegt EIN Eintrag im System fuer alle Karten, und wer
   *  eine einzelne Karte anders bestuecken will, kann es trotzdem. */
  _schluessel() {
    const direkt = (this._config?.tile_api_key || "").trim();
    if (direkt) return direkt;
    const id = (this._config?.tile_api_key_entity || MAP_KEY_ENTITY).trim();
    const zustand = this._hass?.states?.[id]?.state;
    if (!zustand || zustand === "unknown" || zustand === "unavailable") return "";
    return String(zustand).trim();
  }

  _dunkelJetzt() {
    const modus = this._config?.theme_mode || "auto";
    if (modus === "dark") return true;
    if (modus === "light") return false;
    if (this._hass?.themes && typeof this._hass.themes.darkMode === "boolean") {
      return this._hass.themes.darkMode;
    }
    return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  }

  async _build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; z-index: 0; }
        .fehler { padding: var(--ha-space-4, 16px); color: var(--error-color, #db4437);
                  font-size: 0.9em; overflow-wrap: anywhere; min-width: 0; }
      </style>
      <div class="wrap"></div>
    `;
    const wrap = this.shadowRoot.querySelector(".wrap");
    try {
      const helpers = await window.loadCardHelpers();
      const inner = await helpers.createCardElement(this._innerConfig());
      this._inner = inner;
      if (this._hass) inner.hass = this._hass;
      wrap.appendChild(inner);
      this._sucheKarte();
    } catch (error) {
      const meldung = buschFuellen(this._texte.karteFehlt, {
        grund: error?.message || error,
      });
      wrap.textContent = "";
      // Im Regelfall bringt HAs eingebaute map-Karte ihre eigene `ha-card`
      // mit — eine zweite darum wäre ein Rahmen im Rahmen. Im FEHLERFALL
      // gibt es sie nicht, und dann muss die Karte selbst eine stellen
      // (Regel 4: jede Karte rendert in `<ha-card>`).
      const karte = document.createElement("ha-card");
      const kasten = document.createElement("div");
      kasten.className = "fehler";
      // `textContent`, nicht `innerHTML`: die Fehlermeldung kommt aus einer
      // fremden Bibliothek und ist damit nichts, was man in HTML einsetzt.
      kasten.textContent = meldung;
      karte.appendChild(kasten);
      wrap.appendChild(karte);
    }
  }

  /** Die Leaflet-Instanz taucht erst auf, wenn die innere Karte gerendert hat.
   *  Deshalb ein paar Anlaeufe statt eines einzelnen Versuchs. */
  _sucheKarte() {
    this._versuche = 0;
    const versuch = () => {
      this._versuche += 1;
      const haMap = queryDeepShadow(this._inner?.shadowRoot || this._inner, "ha-map");
      if (haMap && haMap.leafletMap) {
        this._haMap = haMap;
        if (this._applyTiles()) return;
      }
      if (this._versuche < 40) {
        setTimeout(versuch, 250);
        return;
      }
      // Rueckfall: HAs Karte bleibt, wie sie ist. Kein leeres Feld.
      if (!this._gewarnt) {
        this._gewarnt = true;
        console.warn(
          "busch-map-card: `ha-map.leafletMap` nicht gefunden — die Kacheln "
          + "bleiben die von Home Assistant. Die Karte funktioniert unveraendert weiter."
        );
      }
    };
    versuch();
  }

  _applyTiles() {
    const map = this._haMap?.leafletMap;
    if (!map) return false;
    const stil = this._stil();
    const dunkel = this._dunkelJetzt();
    this._dunkel = dunkel;

    if (stil.keep) {
      this._layer = null;
      return true;   // Standardvorlage: bewusst nichts anfassen
    }
    let url = (dunkel && stil.dark) ? stil.dark : stil.light;
    if (!url) return false;   // Eigene URL noch leer — HAs Kacheln stehen lassen

    // CARTO verlangt einen Schluessel. Ohne ihn liefert es zwar HTTP 200 und
    // eine gueltige PNG-Kachel — aber mit "API KEY REQUIRED" quer eingebrannt.
    // Am 06.09.2026 auf Byte-Ebene nachgemessen: derselbe Kachelpfad ergab
    // ohne Schluessel 20411 B, mit `?key=` 22692 B. Der Parameter heisst `key`;
    // `api_key` wird stillschweigend ignoriert.
    //
    // Der Schluessel steht in der KARTENKONFIGURATION, nie im Quelltext: dieses
    // Repo ist oeffentlich.
    const schluessel = this._schluessel();
    if (stil.keyParam && schluessel) {
      url += (url.includes("?") ? "&" : "?")
        + encodeURIComponent(stil.keyParam) + "=" + encodeURIComponent(schluessel);
    } else if (stil.keyParam && !this._keyGemeldet) {
      this._keyGemeldet = true;
      console.info(
        "busch-map-card: " + stil.name + " braucht einen Schluessel, sonst steht "
        + "\"API KEY REQUIRED\" in den Kacheln. Kostenlos unter "
        + "https://carto.com/basemaps/apikey. Einmal in den Helfer "
        + MAP_KEY_ENTITY + " eintragen, dann gilt er fuer alle Karten."
      );
    }

    // Vorhandene Rasterebene suchen. `setUrl` ist der schonende Weg: er
    // vermeidet, eine Ebene aus UNSERER Leaflet-Kopie in HAs Karte zu haengen.
    let raster = null;
    map.eachLayer((layer) => {
      if (!raster && typeof layer.setUrl === "function" && typeof layer.getTileUrl === "function") {
        raster = layer;
      }
    });

    if (raster) {
      if (!this._urspruenglich) {
        this._urspruenglich = {
          url: raster._url,
          attribution: raster.options.attribution,
          subdomains: raster.options.subdomains,
          maxZoom: raster.options.maxZoom,
        };
      }
      if (stil.subdomains) raster.options.subdomains = stil.subdomains;
      if (stil.maxZoom) raster.options.maxZoom = stil.maxZoom;
      this._setzeQuellenangabe(map, raster, stil.attribution);
      raster.setUrl(url);
      this._layer = raster;
    } else {
      // Keine Rasterebene: Home Assistant zeichnet die Grundkarte als
      // Vektorkarte (MapLibre). Deren URL laesst sich nicht tauschen, also
      // legen wir eine eigene Rasterebene an — dafuer liegt Leaflet oben in
      // dieser Datei.
      const L = leafletLaden();
      if (!L || !L.tileLayer) {
        if (!this._gewarnt) {
          this._gewarnt = true;
          console.warn(
            "busch-map-card: kein Leaflet verfuegbar — die Grundkarte bleibt, "
            + "wie Home Assistant sie zeichnet."
          );
        }
        this._layer = null;
        return true;
      }
      try {
        // Eigene Ebene, damit die Reihenfolge sicher stimmt: ueber der
        // Grundkarte (tilePane, 200), aber UNTER Routen (400) und Markern
        // (600) — sonst verdecken unsere Kacheln die Personen.
        if (!map.getPane(MAP_PANE)) {
          const pane = map.createPane(MAP_PANE);
          pane.style.zIndex = "250";
          pane.style.pointerEvents = "none";
          // ABER: Home Assistant flacht ALLE Leaflet-Ebenen ein —
          // `.leaflet-pane { z-index: 0 !important; }` (frontend,
          // `src/components/map/ha-map.ts`, Zeile 958 im Stand 20260826.6 =
          // HA 2026.9.1). Ein `!important` aus einem Stilblatt schlaegt die
          // Zeile oben; unsere 250 gelten dort also NICHT. Alle Ebenen liegen
          // dann auf 0 und stapeln sich einzig nach Dokumentreihenfolge —
          // und `createPane` haengt neu ganz hinten an, hinter markerPane.
          // Genau daran verschwanden die Entitaeten: die undurchsichtigen
          // Kacheln lagen ueber den Markern (v0.9.0, gemeldet 09.09.2026).
          // Deshalb wird die Ebene direkt hinter die Grundkacheln
          // einsortiert. Das stimmt in BEIDEN Faellen: mit den 250 (ueber
          // tilePane 200, unter overlayPane 400) und ohne sie, allein nach
          // Reihenfolge.
          const ueberlagerung = map.getPane("overlayPane");
          if (ueberlagerung && ueberlagerung.parentNode === pane.parentNode) {
            pane.parentNode.insertBefore(pane, ueberlagerung);
          }
        }
        // Die Vektor-Grundkarte darunter abraeumen, wenn sie sich zu erkennen
        // gibt. Gelingt das nicht, deckt unsere undurchsichtige Rasterebene
        // sie ohnehin ab — nur laeuft sie dann unnoetig weiter.
        map.eachLayer((layer) => {
          const istVektorBasis = !!(layer._glMap || layer._maplibreMap
            || typeof layer.getMaplibreMap === "function");
          if (istVektorBasis) {
            try { map.removeLayer(layer); } catch (e) { /* dann eben verdeckt */ }
          }
        });
        const neu = L.tileLayer(url, {
          pane: MAP_PANE,
          attribution: stil.attribution,
          subdomains: stil.subdomains || "abc",
          maxZoom: stil.maxZoom || 19,
        });
        neu.addTo(map);
        this._layer = neu;
      } catch (error) {
        console.warn("busch-map-card: eigene Kachelebene fehlgeschlagen", error);
        this._layer = null;
        return false;
      }
    }

    // HAs Dunkelmodus-Filter abschalten: echte dunkle Kacheln brauchen keine
    // Invertierung, und beides zusammen ergibt Matsch. Nur wenn wir die
    // Kacheln wirklich getauscht haben.
    if (this._inner && this._layer) {
      this._inner.style.setProperty("--map-filter", "none");
    }
    return true;
  }

  _setzeQuellenangabe(map, layer, text) {
    if (!text) return;
    const control = map.attributionControl;
    if (control) {
      if (layer.options.attribution) {
        try { control.removeAttribution(layer.options.attribution); } catch (e) { /* egal */ }
      }
      try { control.addAttribution(text); } catch (e) { /* egal */ }
    }
    layer.options.attribution = text;
  }
}

class BuschMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  async _render() {
    if (!this._hass || !this._config) return;
    if (!this._aufgebaut) {
      this._aufgebaut = true;
      const texte = buschTexte(TEXTE_BUSCH_MAP_CARD, this._hass);
      this._texte = texte.texte;
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_MAP_CARD, texte);
      this._form.computeLabel = (s) => texte.labels[s.name] || s.name;
      this._form.computeHelper = (s) => texte.helpers[s.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        const merged = { ...this._config, ...event.detail.value };
        for (const [key, value] of Object.entries(MAP_CARD_DEFAULTS)) {
          if (merged[key] === value) delete merged[key];
        }
        this._emit(merged);
      });
      this.appendChild(this._form);

      const hinweis = document.createElement("div");
      hinweis.style.cssText = "margin:12px 0 4px;font-size:0.85em;opacity:.7;";
      hinweis.textContent = texte.texte.innenTitel;
      this.appendChild(hinweis);
      this._innenBehaelter = document.createElement("div");
      this.appendChild(this._innenBehaelter);
      this._baueInnenEditor();
    }
    this._form.hass = this._hass;
    this._form.data = { ...MAP_CARD_DEFAULTS, ...this._config };
    if (this._innen) {
      this._innen.hass = this._hass;
      this._innen.setConfig(this._innerConfig());
    }
  }

  _innerConfig() {
    const rest = { ...this._config };
    for (const key of MAP_OWN_KEYS) delete rest[key];
    rest.type = "map";
    return rest;
  }

  /** Home Assistants eigenen Map-Editor einbetten. Klappt das nicht, bleibt
   *  ein ehrlicher Hinweis statt eines halben Formulars. */
  async _baueInnenEditor() {
    try {
      const helpers = await window.loadCardHelpers();
      // Mit der ECHTEN Konfiguration erzeugen, nicht mit `entities: []`: HAs
      // Map-Karte lehnt eine Konfiguration ohne Entitaeten ab, und der ganze
      // Editor fiel deshalb auf den Hinweistext zurueck. Am 06.09.2026 im
      // Screenshot des Nutzers gesehen.
      let karte = null;
      for (const versuch of [this._innerConfig(), { type: "map", entities: ["zone.home"] }]) {
        try {
          karte = await helpers.createCardElement(versuch);
          break;
        } catch (e) { /* naechster Versuch */ }
      }
      if (!karte) throw new Error("map-Karte liess sich nicht erzeugen");
      const editor = await karte.constructor.getConfigElement();
      editor.hass = this._hass;
      editor.setConfig(this._innerConfig());
      editor.addEventListener("config-changed", (event) => {
        event.stopPropagation();
        const innen = { ...(event.detail?.config || {}) };
        delete innen.type;
        const eigene = {};
        for (const key of MAP_OWN_KEYS) {
          if (this._config[key] !== undefined) eigene[key] = this._config[key];
        }
        this._emit({ type: this._config.type, ...innen, ...eigene });
      });
      this._innen = editor;
      this._innenBehaelter.appendChild(editor);
    } catch (error) {
      const kasten = document.createElement("div");
      kasten.style.cssText = "font-size:0.85em;opacity:.7;overflow-wrap:anywhere;";
      kasten.textContent = (this._texte || TEXTE_BUSCH_MAP_CARD.de.texte).editorFehlt;
      this._innenBehaelter.textContent = "";
      this._innenBehaelter.appendChild(kasten);
    }
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("busch-map-card", BuschMapCard);
customElements.define("busch-map-card-editor", BuschMapCardEditor);

const waehlerLandkarte = buschTexte(TEXTE_BUSCH_MAP_CARD);

window.customCards.push({
  type: "busch-map-card",
  name: waehlerLandkarte.name,
  description: waehlerLandkarte.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});

/* ────────────────────────────────────────────────────────────────────────────
 * busch-device-card — eine Entität, ihr ganzes Gerät
 *
 * Spec: docs/superpowers/specs/2026-09-09-geraetekarte-design.md
 *
 * Alles, was die Karte über Geräte weiß, steht schon im `hass`-Objekt:
 * `hass.entities` (Registereinträge mit `device_id`, `labels`, `hidden`,
 * `entity_category`, `platform`), `hass.devices`, `hass.areas`. Belegt am
 * Frontend-Quelltext (`src/data/entity/entity_registry.ts`,
 * `src/data/device/device_registry.ts`) am 09.09.2026. Nur die Label-NAMEN
 * kommen per WebSocket (`config/label_registry/list`).
 *
 * Bedienelement und Entitätenzeilen zeichnet HA selbst — über
 * `window.loadCardHelpers()`: `createCardElement({type:"tile", …})` und
 * `createRowElement({entity})`. Diese Datei zeichnet nur Kopfzeile, Chips und
 * Gruppenköpfe. Namensraum: `dev` / `DEV_`.
 * ──────────────────────────────────────────────────────────────────────── */

const DEV_STANDARD = {
  title: "",
  template: "auto",
  labels: [],
  show_subtitle: true,
  show_config: true,
  show_diagnostic: true,
  start_expanded: false,
  tap_action: "expand",
  hold_action: "more-info",
  navigation_path: "",
};

/** Die Kopfzeilen-Aktionen aus Spec Abschnitt 6. */
const DEV_AKTIONEN = ["expand", "more-info", "toggle", "device-page", "navigate", "none"];

/**
 * Vorlage → Features der Tile-Karte (Spec Abschnitt 4). Die Typnamen stehen
 * in `src/panels/lovelace/card-features/types.ts`. Ein Feature, das die
 * Domain nicht unterstützt oder das die HA-Version nicht kennt, rendert HA
 * leer — die Karte prüft das nicht selbst.
 */
const DEV_VORLAGEN = {
  light: { domains: ["light"], features: [{ type: "light-brightness" }] },
  climate: {
    domains: ["climate"],
    features: [{ type: "target-temperature" }, { type: "climate-hvac-modes" }],
  },
  cover: {
    domains: ["cover"],
    features: [{ type: "cover-open-close" }, { type: "cover-position" }],
  },
  fan: { domains: ["fan"], features: [{ type: "fan-speed" }] },
  media: { domains: ["media_player"], features: [{ type: "media-player-volume-slider" }] },
  lock: { domains: ["lock"], features: [{ type: "lock-commands" }] },
  switch: { domains: ["switch", "input_boolean"], features: [{ type: "toggle" }] },
  generic: { domains: [], features: [] },
};

function devNormalisiereKonfig(config) {
  const roh = config || {};
  const k = { ...DEV_STANDARD, ...roh };
  k.entity = typeof roh.entity === "string" ? roh.entity : "";
  if (typeof roh.labels === "string") k.labels = [roh.labels];
  else if (Array.isArray(roh.labels)) k.labels = roh.labels.filter((l) => typeof l === "string");
  else k.labels = [];
  if (!DEV_AKTIONEN.includes(k.tap_action)) k.tap_action = DEV_STANDARD.tap_action;
  if (!DEV_AKTIONEN.includes(k.hold_action)) k.hold_action = DEV_STANDARD.hold_action;
  if (typeof k.navigation_path !== "string") k.navigation_path = "";
  if (typeof k.title !== "string") k.title = "";
  return k;
}

function devDomain(entityId) {
  const s = String(entityId || "");
  const p = s.indexOf(".");
  return p > 0 ? s.slice(0, p) : "";
}

function devVorlageWaehlen(template, entityId) {
  if (template && template !== "auto") {
    return DEV_VORLAGEN[template] ? template : "generic";
  }
  const domain = devDomain(entityId);
  for (const name of Object.keys(DEV_VORLAGEN)) {
    if (DEV_VORLAGEN[name].domains.includes(domain)) return name;
  }
  return "generic";
}

/** „Hersteller · Modell · Bereich" — leere Teile fallen samt Punkt weg. */
function devUntertitel(geraet, bereich) {
  const teile = [];
  if (geraet && geraet.manufacturer) teile.push(String(geraet.manufacturer));
  if (geraet && geraet.model) teile.push(String(geraet.model));
  if (bereich && bereich.name) teile.push(String(bereich.name));
  return teile.join(" · ");
}

/**
 * Entität → Gerät → Bereich. Liefert `{ fehler }` mit einem Wörterbuch-
 * schlüssel aus `texte`, oder die Auflösung.
 */
function devGeraetAufloesen(hass, entityId) {
  if (!entityId) return { fehler: "keineEntitaet" };
  if (!hass || !hass.entities || !hass.devices) return { fehler: "altesHa" };
  const eintrag = hass.entities[entityId];
  if (!eintrag) return { fehler: "nichtRegistriert" };
  if (!eintrag.device_id) return { fehler: "keinGeraet" };
  const geraet = hass.devices[eintrag.device_id];
  if (!geraet) return { fehler: "keinGeraet" };
  const bereich = (geraet.area_id && hass.areas && hass.areas[geraet.area_id]) || null;
  const name = geraet.name_by_user || geraet.name || entityId;
  return {
    eintrag,
    geraet,
    bereich,
    name,
    untertitel: devUntertitel(geraet, bereich),
    platform: eintrag.platform || "",
  };
}

/**
 * HAs `SENSOR_ENTITIES` aus `src/common/const.ts` plus `event`. HA führt
 * `event`, `notify` und Assist als eigene Gruppen; diese Karte faltet `event`
 * in Sensoren und den Rest in Steuerung (Spec Abschnitt 5).
 */
const DEV_SENSOR_DOMAINS = [
  "sensor", "binary_sensor", "calendar", "camera", "device_tracker", "image", "weather", "event",
];

/** Reihenfolge der Gruppen in der Karte. */
const DEV_GRUPPEN = ["control", "sensor", "config", "diagnostic"];

function devEntitaetenDesGeraets(hass, deviceId, hauptId) {
  const aus = [];
  const register = (hass && hass.entities) || {};
  for (const id of Object.keys(register)) {
    const e = register[id];
    if (!e || e.device_id !== deviceId || e.hidden || id === hauptId) continue;
    aus.push(e);
  }
  return aus;
}

function devLabelFilter(eintraege, labels) {
  if (!Array.isArray(labels) || labels.length === 0) return eintraege.slice();
  return eintraege.filter((e) => Array.isArray(e.labels) && e.labels.some((l) => labels.includes(l)));
}

function devGruppe(eintrag) {
  if (eintrag.entity_category === "config") return "config";
  if (eintrag.entity_category === "diagnostic") return "diagnostic";
  return DEV_SENSOR_DOMAINS.includes(devDomain(eintrag.entity_id)) ? "sensor" : "control";
}

function devAnzeigename(hass, eintrag) {
  if (eintrag.name) return String(eintrag.name);
  const zustand = hass && hass.states && hass.states[eintrag.entity_id];
  const fn = zustand && zustand.attributes && zustand.attributes.friendly_name;
  return fn ? String(fn) : eintrag.entity_id;
}

/** „Wohnzimmer Deckenlampe Leistung" → „Leistung"; der Gerätename allein bleibt. */
function devKurzname(anzeigename, geraeteName) {
  const n = String(anzeigename || "");
  const g = String(geraeteName || "");
  if (g && n.length > g.length + 1 && n.startsWith(g + " ")) return n.slice(g.length + 1);
  return n;
}

function devGruppieren(hass, eintraege, konfig) {
  const koerbe = { control: [], sensor: [], config: [], diagnostic: [] };
  for (const e of eintraege) koerbe[devGruppe(e)].push(e);
  const aus = [];
  for (const gruppe of DEV_GRUPPEN) {
    if (gruppe === "config" && !konfig.show_config) continue;
    if (gruppe === "diagnostic" && !konfig.show_diagnostic) continue;
    const liste = koerbe[gruppe];
    if (!liste.length) continue;
    liste.sort((a, b) =>
      devAnzeigename(hass, a).localeCompare(devAnzeigename(hass, b), undefined, { sensitivity: "base" })
    );
    aus.push({ gruppe, ids: liste.map((e) => e.entity_id) });
  }
  return aus;
}

/**
 * Spec Abschnitt 7: Nur wenn sich dieser Stempel ändert, wird das DOM neu
 * gebaut. Ein Zustandswechsel ändert ihn nicht — der wird nur durchgereicht.
 */
function devStrukturStempel(deviceId, vorlage, gruppen, konfig) {
  const felder = Object.keys(DEV_STANDARD).concat(["entity"]).sort()
    .map((k) => `${k}=${JSON.stringify(konfig[k])}`);
  const g = gruppen.map((x) => `${x.gruppe}:${x.ids.join(",")}`);
  return [deviceId, vorlage, g.join("|"), felder.join("&")].join("#");
}

/* DEV-ENDE */

customElements.define("busch-calendar-card", BuschCalendarCard);
customElements.define("busch-calendar-card-editor", BuschCalendarCardEditor);

const waehlerKalender = buschTexte(TEXTE_BUSCH_CALENDAR_CARD);

window.customCards.push({
  type: "busch-calendar-card",
  name: waehlerKalender.name,
  description: waehlerKalender.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});
