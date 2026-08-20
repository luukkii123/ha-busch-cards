/**
 * Busch Cards — Lovelace-Karten für Home Assistant.
 *
 * Bewusst ohne Build-Schritt: eine einzelne Datei, reines Vanilla-JS mit
 * Custom Elements. Das Repo liegt auf einer SMB-Share, auf der kein npm läuft
 * — was hier steht, ist genau das, was ausgeliefert wird.
 *
 * Neue Karte hinzufügen: Klasse schreiben, `customElements.define(...)`,
 * Eintrag in `window.customCards` — alles in dieser Datei.
 */

const CARD_VERSION = "0.1.0";

console.info(
  `%c BUSCH-CARDS %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);

/** Schema für den grafischen Editor (ha-form kommt von Home Assistant selbst). */
const ENTITIES_CARD_SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "columns", selector: { number: { min: 1, max: 4, mode: "box" } } },
  { name: "entities", selector: { entity: { multiple: true } } },
];

const LABELS = {
  title: "Titel",
  columns: "Spalten",
  entities: "Entitäten",
};

/** Entitäten dürfen als String oder als Objekt `{entity, name, icon}` kommen. */
function normalizeEntity(item) {
  if (typeof item === "string") return { entity: item };
  if (item && typeof item === "object" && item.entity) return { ...item };
  throw new Error("busch-entities-card: Eintrag ohne 'entity'");
}

function formatState(hass, entityId) {
  const state = hass.states[entityId];
  if (!state) return { name: entityId, value: "—", unavailable: true };
  const unit = state.attributes.unit_of_measurement;
  const unavailable =
    state.state === "unavailable" || state.state === "unknown";
  let value = hass.formatEntityState
    ? hass.formatEntityState(state)
    : unit
      ? `${state.state} ${unit}`
      : state.state;
  return {
    name: state.attributes.friendly_name || entityId,
    value,
    unavailable,
  };
}

class BuschEntitiesCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-entities-card-editor");
  }

  /** Vorschlag beim Hinzufügen über die Kartenauswahl. */
  static getStubConfig(hass) {
    const entities = Object.keys(hass.states)
      .filter((id) => id.startsWith("sensor."))
      .slice(0, 3);
    return { type: "custom:busch-entities-card", title: "Busch", entities };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._rows = [];
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.entities) || !config.entities.length) {
      throw new Error(
        "busch-entities-card: 'entities' muss eine nicht leere Liste sein"
      );
    }
    this._config = {
      columns: 1,
      ...config,
      entities: config.entities.map(normalizeEntity),
    };
    this._build();
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    const rows = this._config ? this._config.entities.length : 1;
    return 1 + Math.ceil(rows / (this._config?.columns || 1));
  }

  getLayoutOptions() {
    return { grid_rows: this.getCardSize(), grid_columns: 12 };
  }

  /** Aufbau nur bei setConfig — `hass` ändert danach nur noch Texte. */
  _build() {
    const { title, columns, entities } = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 12px 16px 16px; }
        .title {
          font-size: var(--ha-card-header-font-size, 24px);
          font-weight: 400;
          padding: 4px 0 12px;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(${columns}, minmax(0, 1fr));
          gap: 4px 16px;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 40px;
          cursor: pointer;
        }
        .row:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
          border-radius: 4px;
        }
        ha-icon { color: var(--state-icon-color, var(--paper-item-icon-color)); flex: 0 0 auto; }
        .name {
          flex: 1 1 auto;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--primary-text-color);
        }
        .value {
          flex: 0 0 auto;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }
        .row.unavailable .name, .row.unavailable .value { opacity: 0.5; }
      </style>
      <ha-card>
        ${title ? `<div class="title">${title}</div>` : ""}
        <div class="grid">
          ${entities
            .map(
              (item, index) => `
            <div class="row" data-index="${index}" tabindex="0" role="button">
              <ha-icon${item.icon ? ` icon="${item.icon}"` : ""}></ha-icon>
              <span class="name"></span>
              <span class="value"></span>
            </div>`
            )
            .join("")}
        </div>
      </ha-card>
    `;

    this._rows = Array.from(this.shadowRoot.querySelectorAll(".row"));
    for (const row of this._rows) {
      const index = Number(row.dataset.index);
      row.addEventListener("click", () => this._showMore(index));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._showMore(index);
        }
      });
    }
  }

  _render() {
    if (!this._hass || !this._config || !this._rows.length) return;
    this._config.entities.forEach((item, index) => {
      const row = this._rows[index];
      if (!row) return;
      const state = this._hass.states[item.entity];
      const info = formatState(this._hass, item.entity);
      row.classList.toggle("unavailable", info.unavailable);
      row.querySelector(".name").textContent = item.name || info.name;
      row.querySelector(".value").textContent = info.value;
      const icon = row.querySelector("ha-icon");
      if (!item.icon) {
        // Ohne eigenes Icon das der Entität nehmen, sonst bleibt es leer.
        icon.setAttribute("icon", state?.attributes.icon || "mdi:eye");
      }
    });
  }

  /** Standard-Detaildialog von Home Assistant öffnen. */
  _showMore(index) {
    const entityId = this._config.entities[index]?.entity;
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

class BuschEntitiesCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { columns: 1, ...config };
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
      this._form.schema = ENTITIES_CARD_SCHEMA;
      this._form.computeLabel = (schema) => LABELS[schema.name] || schema.name;
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
    // Entitäten kommen als Objekte zurück — der Editor arbeitet mit reinen IDs.
    this._form.data = {
      ...this._config,
      entities: (this._config.entities || []).map((item) =>
        typeof item === "string" ? item : item.entity
      ),
    };
  }
}

customElements.define("busch-entities-card", BuschEntitiesCard);
customElements.define("busch-entities-card-editor", BuschEntitiesCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "busch-entities-card",
  name: "Busch Entities",
  description: "Entitätenliste mit Spalten, Icons und Detaildialog.",
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});
