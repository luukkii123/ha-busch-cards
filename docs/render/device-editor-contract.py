"""Local browser contract for the device card's native filter inputs.

Run: python3 device-editor-contract.py <dist/busch-cards.js>
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright


source = pathlib.Path(sys.argv[1]).read_text()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page()
    page.set_content("<main></main>")
    page.add_script_tag(content="customElements.define('ha-form', class extends HTMLElement {});")
    page.add_script_tag(content=source)
    result = page.evaluate("""() => {
      const config = {type: 'custom:busch-device-card', entity: 'light.example',
        filter: {include: [{domain: 'sensor', state: 'on'}]}};
      const editor = document.createElement('busch-device-card-editor');
      const emitted = [];
      editor.addEventListener('config-changed', event => {
        emitted.push(event.detail.config);
        editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
      });
      const hass = {locale: {language: 'de'}, states: {}, entities: {}, devices: {}};
      editor.hass = hass;
      editor.setConfig(config);
      document.querySelector('main').append(editor);
      const root = editor._filterRoot;
      const inputs = [...root.querySelectorAll('.rule-value input')];
      if (inputs.length !== 2) throw new Error('Zwei Filtereingaben erwartet');
      const [first, second] = inputs;
      editor._filterDetails.open = true;
      first.focus();
      first.value = 'light';
      first.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const immediatelySaved = emitted.at(-1)?.filter?.include?.[0]?.domain;
      const firstMounted = first.isConnected && root.activeElement === first;
      second.value = 'off';
      second.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterSecond = emitted.at(-1)?.filter?.include?.[0];
      const leaked = [];
      document.addEventListener('keydown', event => leaked.push(event.key));
      const liveInput = root.querySelector('.rule-value input');
      for (const key of ['a','e','c','d','A','E','C','D'])
        liveInput.dispatchEvent(new KeyboardEvent('keydown',
          {key, bubbles: true, composed: true, cancelable: true}));
      for (const modifier of ['ctrlKey','metaKey'])
        liveInput.dispatchEvent(new KeyboardEvent('keydown',
          {key: 'k', [modifier]: true, bubbles: true, composed: true, cancelable: true}));
      const reopened = document.createElement('busch-device-card-editor');
      reopened.hass = hass;
      reopened.setConfig(JSON.parse(JSON.stringify(emitted.at(-1))));
      document.querySelector('main').append(reopened);
      return {immediatelySaved, firstMounted, secondMounted: second.isConnected,
        afterSecond, reopenedValues: [...reopened._filterRoot.querySelectorAll('.rule-value input')]
          .map(input => input.value), leaked, incoming: config.filter.include[0].domain};
    }""")
    browser.close()

print(result)
assert result["immediatelySaved"] == "light", "Filterwert wurde nicht sofort gespeichert"
assert result["firstMounted"] is True, "Fokus ging beim Tippen verloren"
assert result["secondMounted"] is True, "Nachbarfeld wurde neu erzeugt"
assert result["afterSecond"] == {"domain": "light", "state": "off"}, "Nachbareingabe verwarf Wert"
assert result["reopenedValues"] == ["light", "off"], "Wert ging beim Wiederöffnen verloren"
assert result["leaked"] == [], "Tastaturereignis erreichte das Dokument"
assert result["incoming"] == "sensor", "Eingehende Konfiguration wurde verändert"
