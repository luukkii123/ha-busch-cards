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
      const previousEditorConfig = editor._config;
      const input = editor.shadowRoot.querySelector('.rule-value input');
      if (!input) throw new Error('Filterwert-Eingabe fehlt');
      input.value = 'light';
      input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterInput = emitted.at(-1)?.filter?.include?.[0]?.domain ?? null;
      const previousEditorConfigUnchanged = previousEditorConfig.filter.include[0].domain === 'sensor';
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
      editor.hass = {locale: {language: 'de'}, states: {'sensor.other': {state: 'on', attributes: {}}}};
      const afterHassUpdate = input.isConnected && input.value === 'light';
      const includeSection = input.closest('details');
      includeSection.open = false;
      includeSection.open = true;
      const afterSectionToggle = input.isConnected && input.value === 'light';
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
      const propertyInput = third.shadowRoot.querySelector('.rule-row').parentElement
        .querySelector('input[aria-label="Eigenschaft"]');
      propertyInput.value = 'alias';
      propertyInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterPropertyInput = third._config.filter.include[0].attributes;
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
      const sixth = document.createElement('busch-smart-entities-editor');
      sixth.hass = {locale: {language: 'de'}, states: {}};
      sixth.setConfig({type: 'custom:busch-smart-entities', card: {type: 'entities'},
        filter: {include: [{attributes: {zero: 5, flag: true, empty: 'x'}}]}});
      document.querySelector('main').append(sixth);
      const numericInput = sixth.shadowRoot.querySelector('input[type="number"]');
      numericInput.value = '0';
      numericInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const booleanSelect = [...sixth.shadowRoot.querySelectorAll('select[aria-label="Wert"]')]
        .find(element => element.value === 'true');
      booleanSelect.value = 'false';
      booleanSelect.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
      const emptyInput = [...sixth.shadowRoot.querySelectorAll('input[aria-label="Wert"]')]
        .find(element => element.value === 'x');
      emptyInput.value = '';
      emptyInput.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      const afterFalsyInputs = sixth._config.filter.include[0].attributes;
      return {
        afterInput,
        previousEditorConfigUnchanged,
        afterSecondInput,
        afterRerender: editor.shadowRoot.querySelector('.rule-value input')?.value,
        reopenedValues,
        remainedMounted,
        afterHassUpdate,
        afterSectionToggle,
        afterTwoRules,
        afterObjectInput,
        afterPropertyInput,
        nestedFieldRemainedMounted,
        afterAndInput,
        staticFieldRemainedMounted,
        afterStaticInput,
        afterFalsyInputs,
        leakedKeys,
        incomingConfig: config.filter.include[0].domain,
      };
    }""")
    matrix = page.evaluate("""() => {
      const clone = value => JSON.parse(JSON.stringify(value));
      const hass = () => ({locale: {language: 'de'}, states: {}});
      const at = (value, path) => path.reduce((node, key) => node?.[key], value);
      const failures = [];
      const results = {};
      const mount = config => {
        const editor = document.createElement('busch-smart-entities-editor');
        editor.hass = hass();
        editor.setConfig(clone(config));
        document.querySelector('main').append(editor);
        editor.saved = [];
        editor.addEventListener('config-changed', event => {
          editor.saved.push(clone(event.detail.config));
          editor.setConfig(clone(event.detail.config));
        });
        return editor;
      };
      const base = () => ({type: 'custom:busch-smart-entities',
        card: {type: 'entities'}, filter: {include: [{domain: 'sensor'}]}});
      const sectionCycle = editor => {
        for (const section of editor.shadowRoot.querySelectorAll('.editor-section')) {
          section.open = false;
          section.open = true;
        }
      };
      const roundtrip = (editor, path, expected, label) => {
        const saved = editor.saved.at(-1);
        if (!saved) {failures.push(label + ': kein config-changed'); return;}
        if (JSON.stringify(at(saved, path)) !== JSON.stringify(expected))
          failures.push(label + ': Speicherobjekt weicht ab');
        const yaml = JSON.stringify(saved); // Visual → YAML → Visual, ohne HA-Dialogattrappe.
        editor.remove();
        const reopened = mount(JSON.parse(yaml));
        if (JSON.stringify(at(reopened._config, path)) !== JSON.stringify(expected))
          failures.push(label + ': nach erneutem Öffnen verloren');
        reopened.remove();
      };
      const textInput = (editor, value) => [...editor.shadowRoot.querySelectorAll('input')]
        .find(input => input.value === value && input.getAttribute('aria-label') === 'Wert');
      const input = (element, value) => {
        element.focus();
        element.value = value;
        element.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
      };
      const rule = (label, target, path, branch='include') => {
        const config = base();
        config.filter[branch] = [target];
        const editor = mount(config);
        sectionCycle(editor);
        const field = textInput(editor, 'old');
        const neighbor = textInput(editor, 'on');
        if (!field || !neighbor) {failures.push(label + ': Eingabe oder Nachbar fehlt');editor.remove();return;}
        const row = field.closest('.rule-row');
        const rowId = row?.dataset.uiId;
        input(field, 'edited');
        const immediate = at(editor._config, ['filter',branch,0,...path]) === 'edited';
        const mounted = field.isConnected && editor.shadowRoot.activeElement === field;
        input(neighbor, 'next');
        editor.hass = hass();
        sectionCycle(editor);
        editor.setConfig(clone(editor._config));
        const stable = field.isConnected && field.value === 'edited' &&
          (!row || row.dataset.uiId === rowId);
        results[label] = {immediate, mounted, stable, rowId: rowId || null};
        if (!immediate || !mounted || !stable) failures.push(label + ': Eingabe/Fokus/HA-Echo verloren');
        if (row && !rowId) failures.push(label + ': Filterzeile ohne stabile UI-ID');
        roundtrip(editor, ['filter',branch,0,...path], 'edited', label);
      };
      const fields = ['domain','state','entity_id','name','group','area','floor','level',
        'device','label','device_manufacturer','device_model','integration','hidden_by',
        'last_changed','last_updated','entity_category'];
      for (const field of fields) {
        const neighbor = field === 'state' ? 'domain' : 'state';
        rule(field, {[field]: 'old', [neighbor]: 'on'}, [field]);
      }
      rule('include', {domain: 'old', state: 'on'}, ['domain']);
      rule('attributes', {attributes: {friendly_name: 'old'}, state: 'on'},
        ['attributes','friendly_name']);
      rule('nested attributes', {attributes: {network: {details: {interface: 'old'}}}, state: 'on'},
        ['attributes','network','details','interface']);
      for (const type of ['and','or'])
        rule(type.toUpperCase(), {[type]: [{domain: 'old'}, {state: 'on'}]}, [type,0,'domain']);
      rule('NOT', {not: {domain: 'old', state: 'on'}}, ['not','domain']);
      rule('exclude', {domain: 'old', state: 'on'}, ['domain'], 'exclude');

      const form = (editor, name) => [...editor.shadowRoot.querySelectorAll('ha-form')]
        .find(item => item.schema?.some(field => field.name === name));
      const change = (editor, name, value) => {
        const item = form(editor, name);
        if (!item) throw new Error('ha-form-Feld fehlt: ' + name);
        item.data = {...item.data, [name]: value};
        item.dispatchEvent(new CustomEvent('value-changed',
          {detail: {value: clone(item.data)}, bubbles: true, composed: true}));
        return item;
      };
      const formCase = (label, config, name, value, path, neighbor, neighborValue,
        structural=false) => {
        const editor = mount(config);
        const item = change(editor, name, value);
        const immediate = JSON.stringify(at(editor._config,path)) === JSON.stringify(value);
        const mounted = item.isConnected;
        change(editor, neighbor, neighborValue);
        editor.hass = hass();
        sectionCycle(editor);
        editor.setConfig(clone(editor._config));
        const stable = item.isConnected;
        results[label] = {immediate,mounted,stable};
        if (!immediate || (!structural && (!mounted || !stable)))
          failures.push(label + ': Eingabe/HA-Echo oder Fokus verloren');
        roundtrip(editor,path,value,label);
      };
      formCase('sort', {...base(),sort:{method:'name',count:6}}, 'sort_attribute',
        'network.interface', ['sort','attribute'], 'count', 3);
      formCase('template', base(), 'template', '{{ states.sensor.test.state }}',
        ['filter','template'], 'sort_attribute', 'network.details');
      formCase('card_param', base(), 'card_param', 'cards', ['card_param'],
        'show_empty', false);
      formCase('show_empty', base(), 'show_empty', false, ['show_empty'], 'unique', 'entity');
      formCase('unique', base(), 'unique', 'entity', ['unique'], 'show_empty', false);
      formCase('unique_values', base(), 'unique_values', true, ['unique_values'],
        'missing', 'null');
      for (const type of ['entity_id','device_id','attribute']) {
        const config = base();
        config.value = {type:'entity_id',missing:'skip'};
        formCase('value='+type, config, 'value_type', type, ['value','type'],
          'unique_values', true, true);
      }
      formCase('value attribute path', {...base(),value:{type:'attribute',attribute:'old',missing:'skip'}},
        'attribute', 'network.details.interface', ['value','attribute'],
        'unique_values', true);
      const objectCase = (label, config, before, path, neighbor, neighborValue) => {
        const editor = mount(config);
        const field = textInput(editor,before);
        if (!field) {failures.push(label + ': Objektfeld fehlt');editor.remove();return;}
        input(field,'edited');
        const immediate = at(editor._config,path)==='edited';
        const mounted = field.isConnected;
        change(editor,neighbor,neighborValue);
        editor.hass=hass();sectionCycle(editor);editor.setConfig(clone(editor._config));
        const stable = field.isConnected;
        results[label]={immediate,mounted,stable};
        if (!immediate || !mounted || !stable) failures.push(label + ': Objektwert/Fokus verloren');
        roundtrip(editor,path,'edited',label);
      };
      objectCase('card', {...base(),card:{type:'entities',title:'old'}},
        'old',['card','title'],'card_param','cards');
      objectCase('else', {...base(),else:{type:'markdown',content:'old'}},
        'old',['else','content'],'show_empty',false);

      const reorder = mount({...base(),filter:{include:[{domain:'one'},{domain:'two'}]}});
      const rows = () => [...reorder.shadowRoot.querySelectorAll('.rule-row')]
        .filter(row => row.querySelector('.rule-value input'))
        .map(row => ({value:row.querySelector('.rule-value input').value,id:row.dataset.uiId}));
      const [firstInput,secondInput] = [...reorder.shadowRoot.querySelectorAll('.rule-value input')];
      const secondId = secondInput.closest('.rule-row').dataset.uiId;
      input(firstInput,'one-edited');
      const neighborMounted = secondInput.isConnected &&
        secondInput.closest('.rule-row').dataset.uiId === secondId;
      const before = rows();
      reorder.setConfig({...reorder._config,filter:{include:[...reorder._config.filter.include].reverse()}});
      const after = rows();
      results['UI-ID reorder']={before,after,neighborMounted};
      if (!neighborMounted || JSON.stringify(reorder._config).includes('smart-rule-') ||
          before.some(row=>!row.id) || after.some(row=>!row.id) ||
          before.some(row=>after.find(other=>other.value===row.value)?.id!==row.id))
        failures.push('UI-ID reorder: ID folgt der Regel nicht');
      reorder.remove();
      return {results,failures};
    }""")
    browser.close()

print(result)
assert result["afterInput"] == "light", "Eingabe wurde nicht sofort persistiert"
assert result["previousEditorConfigUnchanged"] is True, "Interne Konfiguration wurde mutiert"
assert result["afterSecondInput"] == {"domain": "light", "state": "off"}, "Nachbareingabe verwarf einen persistierten Wert"
assert result["afterRerender"] == "light", "Eingabe ging beim Re-Render verloren"
assert result["reopenedValues"] == ["light", "off"], "Gespeicherte Filterwerte fehlen nach erneutem Öffnen"
assert result["remainedMounted"] is True, "Eingabefeld wurde beim Tippen neu erzeugt"
assert result["afterHassUpdate"] is True, "HASS-Update verwarf den Filterwert"
assert result["afterSectionToggle"] is True, "Sektionstoggle verwarf den Filterwert"
assert result["afterTwoRules"] == [{"domain": "light"}, {"state": "off"}], "Nachbarregel verwarf einen persistierten Wert"
assert result["afterObjectInput"] == "new", "Verschachtelter Objektwert wurde nicht sofort persistiert"
assert result["afterPropertyInput"] == {"alias": "new"}, "Eigenschaftsname wurde nicht sofort persistiert"
assert result["nestedFieldRemainedMounted"] is True, "AND-Eingabe verlor beim Tippen den Fokus"
assert result["afterAndInput"] == [{"domain": "light"}, {"state": "off"}], "AND-Nachbarregel verwarf einen Wert"
assert result["staticFieldRemainedMounted"] is True, "Statische Eingabe verlor beim Tippen den Fokus"
assert result["afterStaticInput"] == "sensor.b", "Statische Eingabe wurde nicht sofort persistiert"
assert result["afterFalsyInputs"] == {"zero": 0, "flag": False, "empty": ""}, "Gültige Falsy-Werte gingen verloren"
assert result["leakedKeys"] == [], "Editor-Tastendruck erreichte das Dokument"
assert result["incomingConfig"] == "sensor", "setConfig-Eingabe wurde mutiert"
print('Featuretyp-Matrix:', len(matrix["results"]), 'Fälle,', len(matrix["failures"]), 'Fehler')
if matrix["failures"]:
    print(matrix)
assert not matrix["failures"], "Featuretyp-Persistenzmatrix: " + "; ".join(matrix["failures"])
