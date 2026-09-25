"""Browser regression for Smart Entities editor input persistence and key isolation.

Run: python3 smart-editor-contract.py <dist/busch-cards.js>
The small ha-form stand-in leaves native filter inputs under the real editor.
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
      const editor = document.createElement('busch-smart-entities-editor');
      const config = {
        type: 'custom:busch-smart-entities',
        card: {type: 'entities'},
        filter: {include: [{domain: 'sensor', state: 'on'}]},
      };
      const emitted = [];
      editor.addEventListener('config-changed', event => {
        emitted.push(event.detail.config);
        editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
      });
      editor.hass = {locale: {language: 'de'}, states: {}};
      editor.setConfig(config);
      document.querySelector('main').append(editor);
      const input = editor.shadowRoot.querySelector('.rule-value input');
      if (!input) throw new Error('Filterwert-Eingabe fehlt');
      input.value = 'light';
      input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterInput = emitted.at(-1)?.filter?.include?.[0]?.domain ?? null;
      const stateInput = editor.shadowRoot.querySelectorAll('.rule-value input')[1];
      stateInput.value = 'off';
      stateInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterSecondInput = emitted.at(-1)?.filter?.include?.[0] ?? null;
      const leakedKeys = [];
      document.addEventListener('keydown', event => leakedKeys.push(event.key));
      for (const key of ['a', 'e', 'c', 'd', 'A', 'E', 'C', 'D']) {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key, bubbles: true, composed: true, cancelable: true,
        }));
      }
      for (const modifier of ['ctrlKey', 'metaKey']) {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k', [modifier]: true, bubbles: true, composed: true, cancelable: true,
        }));
      }
      const remainedMounted = input.isConnected;
      editor._emit({...editor._config, debug: true});
      const reopened = document.createElement('busch-smart-entities-editor');
      reopened.hass = {locale: {language: 'de'}, states: {}};
      reopened.setConfig(JSON.parse(JSON.stringify(emitted.at(-1))));
      document.querySelector('main').append(reopened);
      const reopenedValues = [...reopened.shadowRoot.querySelectorAll('.rule-value input')]
        .map(element => element.value);
      const second = document.createElement('busch-smart-entities-editor');
      second.hass = {locale: {language: 'de'}, states: {}};
      second.setConfig({type: 'custom:busch-smart-entities', card: {type: 'entities'},
        filter: {include: [{domain: 'sensor'}, {state: 'on'}]}});
      document.querySelector('main').append(second);
      const [firstRule, secondRule] = second.shadowRoot.querySelectorAll('.rule-value input');
      firstRule.value = 'light';
      firstRule.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      secondRule.value = 'off';
      secondRule.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterTwoRules = second._config.filter.include;
      const third = document.createElement('busch-smart-entities-editor');
      third.hass = {locale: {language: 'de'}, states: {}};
      third.setConfig({type: 'custom:busch-smart-entities', card: {type: 'entities'},
        filter: {include: [{attributes: {friendly_name: 'old'}}]}});
      document.querySelector('main').append(third);
      const objectInput = third.shadowRoot.querySelector('.rule-row').parentElement.querySelector('input[aria-label="Wert"]');
      if (!objectInput) throw new Error('Objektwert-Eingabe fehlt');
      objectInput.value = 'new';
      objectInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterObjectInput = third._config.filter.include[0].attributes.friendly_name;
      const fourth = document.createElement('busch-smart-entities-editor');
      fourth.hass = {locale: {language: 'de'}, states: {}};
      fourth.setConfig({type: 'custom:busch-smart-entities', card: {type: 'entities'},
        filter: {include: [{and: [{domain: 'sensor'}, {state: 'on'}]}]}});
      document.querySelector('main').append(fourth);
      const [andFirst, andSecond] = fourth.shadowRoot.querySelectorAll('.rule-value input');
      andFirst.value = 'light';
      andFirst.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const nestedFieldRemainedMounted = andFirst.isConnected;
      andSecond.value = 'off';
      andSecond.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterAndInput = fourth._config.filter.include[0].and;
      const fifth = document.createElement('busch-smart-entities-editor');
      fifth.hass = {locale: {language: 'de'}, states: {}};
      fifth.setConfig({type: 'custom:busch-smart-entities', card: {type: 'entities'},
        entities: ['sensor.a'], filter: {include: []}});
      document.querySelector('main').append(fifth);
      const entityInput = [...fifth.shadowRoot.querySelectorAll('input')]
        .find(element => element.value === 'sensor.a');
      if (!entityInput) throw new Error('Statische Entitäts-Eingabe fehlt');
      entityInput.value = 'sensor.b';
      entityInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const staticFieldRemainedMounted = entityInput.isConnected;
      const afterStaticInput = fifth._config.entities[0];
      return {
        afterInput,
        afterSecondInput,
        afterRerender: editor.shadowRoot.querySelector('.rule-value input')?.value,
        reopenedValues,
        remainedMounted,
        afterTwoRules,
        afterObjectInput,
        nestedFieldRemainedMounted,
        afterAndInput,
        staticFieldRemainedMounted,
        afterStaticInput,
        leakedKeys,
        incomingConfig: config.filter.include[0].domain,
      };
    }""")
    browser.close()

print(result)
assert result["afterInput"] == "light", "Eingabe wurde nicht sofort persistiert"
assert result["afterSecondInput"] == {"domain": "light", "state": "off"}, "Nachbareingabe verwarf einen persistierten Wert"
assert result["afterRerender"] == "light", "Eingabe ging beim Re-Render verloren"
assert result["reopenedValues"] == ["light", "off"], "Gespeicherte Filterwerte fehlen nach erneutem Öffnen"
assert result["remainedMounted"] is True, "Eingabefeld wurde beim Tippen neu erzeugt"
assert result["afterTwoRules"] == [{"domain": "light"}, {"state": "off"}], "Nachbarregel verwarf einen persistierten Wert"
assert result["afterObjectInput"] == "new", "Verschachtelter Objektwert wurde nicht sofort persistiert"
assert result["nestedFieldRemainedMounted"] is True, "AND-Eingabe verlor beim Tippen den Fokus"
assert result["afterAndInput"] == [{"domain": "light"}, {"state": "off"}], "AND-Nachbarregel verwarf einen Wert"
assert result["staticFieldRemainedMounted"] is True, "Statische Eingabe verlor beim Tippen den Fokus"
assert result["afterStaticInput"] == "sensor.b", "Statische Eingabe wurde nicht sofort persistiert"
assert result["leakedKeys"] == [], "Editor-Tastendruck erreichte das Dokument"
assert result["incomingConfig"] == "sensor", "setConfig-Eingabe wurde mutiert"
