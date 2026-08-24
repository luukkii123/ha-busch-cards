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

const CARD_VERSION = "0.4.0";

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
