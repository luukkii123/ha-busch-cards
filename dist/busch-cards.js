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

const CARD_VERSION = "0.7.1";

console.info(
  `%c BUSCH-CARDS %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);


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

const SCHEDULE_CARD_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { filter: { domain: "schedule" } } } },
  { name: "title", selector: { text: {} } },
  {
    name: "first_day",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto", label: "Wie in Home Assistant" },
          { value: "monday", label: "Montag" },
          { value: "sunday", label: "Sonntag" },
        ],
      },
    },
  },
  {
    name: "step",
    selector: { number: { min: 5, max: 60, step: 5, mode: "slider", unit_of_measurement: "min" } },
  },
];

const SCHEDULE_LABELS = {
  entity: "Zeitplan",
  title: "Titel",
  first_day: "Woche beginnt am",
  step: "Raster beim Ziehen",
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
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: 6, min_columns: 6, min_rows: 5 };
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
    if (showSpinner) this._renderStatus("Lade …");
    try {
      if (!this._scheduleId) {
        this._scheduleId = await this._resolveScheduleId();
      }
      const items = await this._hass.callWS({ type: "schedule/list" });
      const item = items.find((entry) => entry.id === this._scheduleId);
      if (!item) {
        throw new Error(
          `Zeitplan zu ${this._config.entity} nicht gefunden. In YAML definierte Zeitpläne lassen sich nicht über die Oberfläche ändern.`
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
    this._renderStatus("Speichere …");

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
      this._notify(`Zeitplan nicht gespeichert: ${this._error}`);
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
        }
        ha-card {
          display: block;
          padding: 12px 16px 16px;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-bottom: 12px;
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
        }
        .head .sub {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .head .status {
          flex: 0 0 auto;
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .ruler {
          display: grid;
          grid-template-columns: var(--label-col, 40px) 1fr;
          align-items: end;
          gap: 0 8px;
          height: 16px;
          margin-bottom: 2px;
        }
        .ruler .scale { position: relative; height: 100%; }
        .ruler span {
          position: absolute;
          font-size: 10px;
          line-height: 1;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
          transform: translateX(-50%);
          white-space: nowrap;
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
          font-size: 12px;
          color: var(--secondary-text-color);
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .day.today .label { color: var(--primary-text-color); font-weight: 500; }

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
          white-space: nowrap;
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
          gap: 8px;
          margin-top: 10px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .foot .hint { flex: 1 1 auto; }
        .foot .err { color: var(--error-color, #db4437); }

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
        .dlg { padding: 20px; }
        .dlg h2 {
          margin: 0 0 16px;
          font-size: 18px;
          font-weight: 400;
        }
        .fields { display: flex; gap: 12px; }
        .fields label {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .fields input {
          font: inherit;
          font-size: 16px; /* unter 16px zoomt iOS beim Fokus hinein */
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          color-scheme: light dark;
        }
        .fields input:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: -1px;
        }
        .dlg .note { margin-top: 8px; font-size: 12px; color: var(--secondary-text-color); }
        .dlg .msg { margin-top: 12px; font-size: 13px; color: var(--error-color, #db4437); }
        .dlg .msg:empty { display: none; }
        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 20px 0 0;
          padding: 0;
        }
        .actions .spacer { flex: 1 1 auto; }
        .actions button {
          font: inherit;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: none;
          background: none;
          color: var(--primary-color);
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
        }
        .actions button:hover { background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
        .actions button.danger { color: var(--error-color, #db4437); }
        .actions button.danger:hover { background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }

        .choices { display: flex; flex-direction: column; }
        .choices button {
          font: inherit;
          font-size: 14px;
          text-align: left;
          border: none;
          background: none;
          color: var(--primary-text-color);
          padding: 12px 8px;
          border-radius: 6px;
          cursor: pointer;
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
          <h2></h2>
          <div class="fields">
            <label>Von <input type="time" class="f-from"></label>
            <label>Bis <input type="time" class="f-to"></label>
          </div>
          <div class="note">Bis <b>00:00</b> bedeutet Mitternacht am Tagesende.</div>
          <div class="msg"></div>
          <menu class="actions">
            <button class="danger" data-act="delete">Löschen</button>
            <span class="spacer"></span>
            <button data-act="cancel">Abbrechen</button>
            <button data-act="ok">Übernehmen</button>
          </menu>
        </div>
      </dialog>

      <dialog class="day-dialog">
        <div class="dlg">
          <h2></h2>
          <div class="choices">
            <button data-act="all">Auf alle Tage kopieren</button>
            <button data-act="weekdays">Auf Montag–Freitag kopieren</button>
            <button data-act="weekend">Auf Samstag und Sonntag kopieren</button>
            <button data-act="clear" class="danger">Alle Blöcke dieses Tages löschen</button>
          </div>
          <menu class="actions">
            <span class="spacer"></span>
            <button data-act="cancel">Abbrechen</button>
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
    this._wireDialogs();
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
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      this._resolveBlockDialog(button.dataset.act);
    });
    blockDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this._resolveBlockDialog("cancel");
    });

    const dayDialog = this._els.dayDialog;
    dayDialog.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      dayDialog.close();
      this._applyDayAction(button.dataset.act);
    });
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
        ? "In YAML festgelegt — hier nur zum Ansehen."
        : "Ziehen legt einen Block an, Tippen öffnet ihn.";
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
      this._els.sub.textContent = "Entität nicht gefunden";
      return;
    }
    const parts = [isOn ? "Ein" : "Aus"];
    const next = state.attributes?.next_event;
    if (next) {
      const date = new Date(next);
      if (!Number.isNaN(date.getTime())) {
        const time = this._hass.formatEntityAttributeValue
          ? this._hass.formatEntityAttributeValue(state, "next_event")
          : date.toLocaleString(this._hass.locale?.language || "de");
        parts.push(`${isOn ? "bis" : "ab"} ${time}`);
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
    this._dialogTarget = { day, index };
    dialog.showModal();
  }

  _resolveBlockDialog(action) {
    const dialog = this._els.blockDialog;
    const target = this._dialogTarget;
    if (!target) {
      dialog.close();
      return;
    }

    if (action === "cancel") {
      dialog.close();
      this._dialogTarget = null;
      return;
    }

    const blocks = this._model[target.day];

    if (action === "delete") {
      blocks.splice(target.index, 1);
      dialog.close();
      this._dialogTarget = null;
      this._renderDays();
      this._save();
      return;
    }

    const fromValue = dialog.querySelector(".f-from").value;
    const toValue = dialog.querySelector(".f-to").value;
    const message = dialog.querySelector(".msg");
    if (!fromValue || !toValue) {
      message.textContent = "Bitte beide Zeiten angeben.";
      return;
    }

    const start = parseScheduleTime(fromValue);
    // 00:00 als Ende kann nur das Tagesende meinen — from < to ist Pflicht.
    const parsedTo = parseScheduleTime(toValue);
    const end = parsedTo === 0 ? MINUTES_PER_DAY : parsedTo;

    if (start >= end) {
      message.textContent = "Die Startzeit muss vor der Endzeit liegen.";
      return;
    }
    const others = blocks.filter((_, index) => index !== target.index);
    if (others.some((block) => start < block.end && end > block.start)) {
      message.textContent = "Der Zeitraum überschneidet sich mit einem anderen Block.";
      return;
    }

    blocks[target.index] = { ...blocks[target.index], start, end };
    blocks.sort((a, b) => a.start - b.start);
    dialog.close();
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
    dialog.showModal();
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
      this._form = document.createElement("ha-form");
      this._form.schema = SCHEDULE_CARD_SCHEMA;
      this._form.computeLabel = (schema) =>
        SCHEDULE_LABELS[schema.name] || schema.name;
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
  // spaetere Nachweise) soll die Liste nicht sprengen.
  const farbe = (optionen.farben || {})[termin._entity] || calPalette[0];
  const punkt = optionen.mehrereKalender
    ? `<span class="cal-punkt" style="background:${calEscape(farbe)}"></span>`
    : "";
  const zeit = calIstGanztags(termin)
    ? "ganztägig"
    : `${calFormatUhrzeit(calStartDatum(termin), optionen.locale)} – ` +
      `${calFormatUhrzeit(calEndDatum(termin), optionen.locale)}`;
  // Beschreibung und Ort landen im `title`, weil es keinen Termin-Dialog gibt.
  const hinweis = [termin.description, termin.location].filter(Boolean).join(" · ");
  return (
    `<div class="cal-termin" data-uid="${calEscape(termin.uid || "")}" ` +
    `data-entity="${calEscape(termin._entity || "")}" ` +
    `title="${calEscape(hinweis)}">` +
    `${punkt}<span class="cal-zeit">${calEscape(zeit)}</span>` +
    `<span class="cal-titel">${calEscape(termin.summary || "(ohne Titel)")}</span>` +
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
function calHinweisText(fehler, nichtGezeigt) {
  const teile = [];
  if (fehler && fehler.length) teile.push(`Nicht erreichbar: ${fehler.join(", ")}`);
  if (nichtGezeigt > 0) {
    // Der Wortlaut nennt den GEMEINSAMEN Grund, nicht mehr nur einen von
    // mehreren: die Zahl kommt aus der Differenz und deckt jeden Termin ab,
    // fuer den die Tagesschleife keinen Platz im gezeigten Monat hatte.
    teile.push(
      nichtGezeigt === 1
        ? "1 Termin ohne Tag im gezeigten Monat, nicht angezeigt."
        : `${nichtGezeigt} Termine ohne Tag im gezeigten Monat, nicht angezeigt.`
    );
  }
  return teile.join(" · ");
}

const CAL_STIL = `
  .cal-kopf { display:flex; align-items:center; justify-content:space-between;
    padding:12px 16px 8px; }
  .cal-monat { font-size:1.1em; font-weight:600; color:var(--primary-text-color); }
  .cal-pfeil { background:none; border:none; cursor:pointer; padding:6px 10px;
    color:var(--secondary-text-color); font-size:1.2em; line-height:1; border-radius:6px; }
  .cal-pfeil:hover { background:var(--divider-color); color:var(--primary-text-color); }
  .cal-titel-zeile { padding:12px 16px 0; font-weight:600;
    color:var(--primary-text-color); }
  .cal-liste { padding:0 8px 8px; }
  .cal-tag { display:flex; gap:12px; padding:6px 8px; border-radius:8px;
    border-bottom:1px solid var(--divider-color); }
  .cal-tag:last-child { border-bottom:none; }
  .cal-wochenende { background:var(--secondary-background-color); }
  .cal-heute { outline:2px solid var(--primary-color); outline-offset:-2px; }
  .cal-datum { display:flex; gap:6px; min-width:64px; align-items:baseline;
    color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
  .cal-nr { font-weight:600; color:var(--primary-text-color); }
  .cal-inhalt { flex:1; min-width:0; }
  .cal-termin { display:flex; gap:8px; align-items:baseline; padding:2px 0;
    cursor:pointer; }
  .cal-leer .cal-termin { cursor:default; min-height:1.2em; }
  .cal-punkt { width:8px; height:8px; border-radius:50%; flex:none;
    align-self:center; }
  .cal-zeit { color:var(--secondary-text-color); font-variant-numeric:tabular-nums;
    white-space:nowrap; }
  .cal-titel { color:var(--primary-text-color); overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  /* Linksbuendig mit festem Abstand, NICHT ueber die Breite verteilt.
     Gemessen: Mit \`space-between\` sassen bei zwei Werten "3 Tage" und
     "25,7 h" in den gegenueberliegenden Ecken, 436 px Leerraum dazwischen —
     und das ist der Regelfall, weil "1 ganztaegig" nur erscheint, wenn es im
     Monat einen ganztaegigen Termin gab. Die Zeile sprang also, je nachdem ob
     Urlaub drin war. Mit \`gap\` steht sie ruhig und liest sich als eine
     Angabe, ohne dass ein Trennzeichen noetig waere. */
  .cal-fuss { display:flex; justify-content:flex-start; gap:24px; padding:10px 16px;
    border-top:1px solid var(--divider-color); color:var(--secondary-text-color); }
  .cal-hinweis { padding:12px 16px; color:var(--error-color, #db4437); }
  .cal-leermeldung { padding:16px; color:var(--secondary-text-color); }
`;

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
          alle.push({ ...termin, _entity: eintrag.entity });
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
   * Home Assistant hat KEINE oeffentliche Schnittstelle, um einen einzelnen
   * Termin als Dialog zu oeffnen. Der Klick oeffnet deshalb den
   * Info-Dialog der Kalender-Entitaet. Beschreibung und Ort des Termins
   * stehen zusaetzlich im `title` der Zeile und erscheinen beim Ueberfahren.
   * Das ist bewusst weniger, als ein Termin-Dialog waere — es tut aber nicht
   * so, als koennte es mehr.
   */
  _oeffneTermin(uid, entity) {
    if (!this._config.open_event_on_tap || !entity) return;
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
          this._oeffneTermin(zeile.dataset.uid, zeile.dataset.entity);
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
        ? `<button class="cal-pfeil" data-schritt="-1" aria-label="Voriger Monat">‹</button>`
        : `<span></span>`) +
      `<span class="cal-monat">${calEscape(calMonatsName(start, locale))}</span>` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="1" aria-label="Naechster Monat">›</button>`
        : `<span></span>`) +
      `</div>`;

    let rumpf;
    if (this._config.entities.length === 0) {
      rumpf = `<div class="cal-leermeldung">Kein Kalender gewählt. Im Karteneditor einen auswählen.</div>`;
    } else if (this._tage === null) {
      rumpf = `<div class="cal-leermeldung">Wird geladen …</div>`;
    } else {
      const liste = calListeHtml(this._tage, {
        zeigeLeereTage: this._config.show_empty_days,
        locale,
        farben,
        mehrereKalender: this._config.entities.length > 1,
      });
      rumpf = liste
        ? `<div class="cal-liste">${liste}</div>`
        : `<div class="cal-leermeldung">Keine Termine in diesem Monat.</div>`;
    }

    let fuss = "";
    if (this._config.show_total && this._tage) {
      // MIT den Monatsgrenzen: eine Summe, die schneiden kann, aber
      // ungeschnitten aufgerufen wird, ist so falsch wie eine, die es nicht kann.
      const s = calSummeStunden(this._alleTermine || [], start, ende);
      const teile = [`${s.tageMitTermin} Tage`, `${calFormatStunden(s.stunden, locale)} h`];
      if (s.ganztags) teile.push(`${s.ganztags} ganztägig`);
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

    const hinweisText = calHinweisText(this._fehler || [], this._nichtGezeigt || 0);
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

const CAL_CARD_SCHEMA = [
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
    ],
  },
];

const CAL_LABELS = {
  title: "Überschrift",
  entities: "Kalender",
  month_offset: "Monatsversatz (-1 = Vormonat)",
  navigation: "Pfeile zum Blättern",
  show_empty_days: "Leere Tage zeigen",
  show_total: "Summe in der Fußzeile",
  open_event_on_tap: "Klick öffnet den Kalender",
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
      this._form = document.createElement("ha-form");
      this._form.schema = CAL_CARD_SCHEMA;
      this._form.computeLabel = (schema) => CAL_LABELS[schema.name] || schema.name;
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
    this._farbFeld.innerHTML =
      `<div style="font-weight:600;margin:8px 0 4px">Farben</div>` +
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

window.customCards = window.customCards || [];
window.customCards.push({
  type: "busch-schedule-card",
  name: "Busch Zeitplan",
  description: "Zeitplan-Helfer im Dashboard bearbeiten — ziehen, tippen, kopieren.",
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});


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

/** Eigene Optionen der Karte — alles Uebrige gehoert der eingebauten Karte. */
const MAP_OWN_KEYS = [
  "map_style", "tile_url", "tile_url_dark", "tile_attribution", "tile_max_zoom",
  "tile_api_key", "tile_api_key_entity",
];

const MAP_CARD_SCHEMA = [
  {
    name: "map_style",
    selector: {
      select: {
        mode: "dropdown",
        options: Object.entries(MAP_STYLES).map(([value, s]) => ({ value, label: s.name })),
      },
    },
  },
  { name: "tile_url", selector: { text: {} } },
  { name: "tile_url_dark", selector: { text: {} } },
  { name: "tile_attribution", selector: { text: {} } },
  { name: "tile_api_key", selector: { text: {} } },
  {
    name: "tile_api_key_entity",
    selector: { entity: { filter: { domain: ["input_text"] } } },
  },
];

const MAP_LABELS = {
  map_style: "Kartenvorlage",
  tile_url: "Eigene Kachel-URL (hell)",
  tile_url_dark: "Eigene Kachel-URL (dunkel, optional)",
  tile_attribution: "Eigene Quellenangabe",
  tile_api_key: "Schlüssel direkt eintragen (überschreibt den Helfer)",
  tile_api_key_entity: `Schlüssel-Helfer (Standard: ${MAP_KEY_ENTITY})`,
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
        .fehler { padding: 16px; color: var(--error-color, #db4437); font-size: 0.9em; }
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
      wrap.innerHTML = `<div class="fehler">Die eingebaute Karte liess sich nicht erzeugen: ${
        error?.message || error
      }</div>`;
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
      // Keine Rasterebene gefunden — Home Assistant zeichnet die Grundkarte
      // dann als Vektorkacheln, die eigene dunkle Kartografie mitbringen.
      // Hier wird bewusst NICHTS ersetzt: eine eigene Leaflet-Kopie nur fuer
      // diesen Fall mitzuschleppen (200 kB) waere teuer, und der Zweig war
      // ohnehin der riskante. Die Karte bleibt HAs Karte.
      if (!this._gewarnt) {
        this._gewarnt = true;
        console.info(
          "busch-map-card: keine Rasterkacheln gefunden — Home Assistant "
          + "zeichnet vermutlich Vektorkacheln. Die Grundkarte bleibt unveraendert."
        );
      }
      this._layer = null;
      return true;
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
      this._form = document.createElement("ha-form");
      this._form.schema = MAP_CARD_SCHEMA;
      this._form.computeLabel = (s) => MAP_LABELS[s.name] || s.name;
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
      hinweis.textContent = "Alles Weitere wie bei der eingebauten Karte:";
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
      this._innenBehaelter.innerHTML =
        '<div style="font-size:0.85em;opacity:.7;">Der eingebaute Map-Editor liess sich '
        + 'nicht laden — die uebrigen Optionen bitte in YAML bearbeiten. Sie sind '
        + 'dieselben wie bei <code>type: map</code>.</div>';
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

window.customCards.push({
  type: "busch-map-card",
  name: "Busch Landkarte",
  description: "Die eingebaute Map-Karte mit frei wählbaren Kacheln — nur `type:` tauschen.",
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});

customElements.define("busch-calendar-card", BuschCalendarCard);
customElements.define("busch-calendar-card-editor", BuschCalendarCardEditor);

window.customCards.push({
  type: "busch-calendar-card",
  name: "Busch Kalender",
  description: "Termine als Monatsliste, mit Monatsversatz und Blättern.",
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});
