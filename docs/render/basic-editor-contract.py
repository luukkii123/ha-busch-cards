"""Local browser contract for schedule, calendar and map editors.

Run: python3 basic-editor-contract.py <dist/busch-cards.js>
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright


source = pathlib.Path(sys.argv[1]).read_text()
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page()
    page.set_content("<main></main>")
    page.add_script_tag(content="""
      customElements.define('ha-form', class extends HTMLElement {
        set data(value) { this._data = value; this.replaceChildren(document.createElement('input')); }
        get data() { return this._data; }
      });
      customElements.define('fake-map-editor', class extends HTMLElement {
        setConfig(config) { this.config = config; }
        set hass(value) { this._hass = value; }
      });
      window.loadCardHelpers = async () => ({createCardElement: async () => ({
        constructor: {getConfigElement: () => document.createElement('fake-map-editor')}
      })});
    """)
    page.add_script_tag(content=source)
    result = page.evaluate("""async () => {
      const hass = {locale: {language: 'de'}, states: {
        'calendar.a': {attributes: {friendly_name: 'A'}},
        'calendar.b': {attributes: {friendly_name: 'B'}},
      }};
      const cases = [
        ['busch-schedule-card-editor', {type:'custom:busch-schedule-card', entity:'schedule.example'},
          [{step:20}, {first_day:'monday'}]],
        ['busch-calendar-card-editor', {type:'custom:busch-calendar-card',
          entities:['calendar.a','calendar.b']}, [{month_offset:1}, {show_total:true}]],
        ['busch-map-card-editor', {type:'custom:busch-map-card', entities:['zone.home']},
          [{map_style:'custom'}, {tile_attribution:'Example'}]],
      ];
      const output = {};
      for (const [tag,incoming,changes] of cases) {
        const editor=document.createElement(tag), emitted=[];
        editor.addEventListener('config-changed',event=>{
          emitted.push(event.detail.config);
          editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
        });
        editor.setConfig(incoming);editor.hass=hass;document.querySelector('main').append(editor);
        const form=editor._form, field=form.querySelector('input');
        field.focus();
        for(const value of changes)form.dispatchEvent(new CustomEvent('value-changed',
          {detail:{value},bubbles:true,composed:true}));
        const leaked=[];document.addEventListener('keydown',event=>leaked.push(event.key),{once:true});
        field.dispatchEvent(new KeyboardEvent('keydown',
          {key:'a',bubbles:true,composed:true,cancelable:true}));
        output[tag]={config:emitted.at(-1),formMounted:form===editor._form,
          focusKept:field.isConnected&&document.activeElement===field,
          incoming:JSON.parse(JSON.stringify(incoming)),leaked};
        if(tag==='busch-calendar-card-editor'){
          const color=editor.querySelector('input[type=color]');
          color.value='#ff0000';color.dispatchEvent(new Event('input',{bubbles:true}));
          output[tag].color=emitted.at(-1).entities.find(item=>item.entity==='calendar.a')?.color;
          output[tag].colorFieldMounted=color.isConnected;
        }
        if(tag==='busch-map-card-editor'){
          await new Promise(resolve=>setTimeout(resolve,0));
          editor._innen.dispatchEvent(new CustomEvent('config-changed',
            {detail:{config:{type:'map',entities:['zone.home','zone.work']}},bubbles:true}));
          output[tag].nested=emitted.at(-1);
        }
      }
      return output;
    }""")
    browser.close()

print(result)
schedule = result["busch-schedule-card-editor"]
calendar = result["busch-calendar-card-editor"]
map_card = result["busch-map-card-editor"]
assert schedule["config"]["step"] == 20 and schedule["config"]["first_day"] == "monday"
assert calendar["config"]["month_offset"] == 1 and calendar["config"]["show_total"] is True
assert calendar["color"] == "#ff0000" and calendar["colorFieldMounted"] is True
assert map_card["config"]["map_style"] == "custom"
assert map_card["config"]["tile_attribution"] == "Example"
assert map_card["nested"]["entities"] == ["zone.home", "zone.work"]
assert map_card["nested"]["map_style"] == "custom"
assert schedule["incoming"] == {"type": "custom:busch-schedule-card", "entity": "schedule.example"}
assert calendar["incoming"]["entities"] == ["calendar.a", "calendar.b"]
assert map_card["incoming"]["entities"] == ["zone.home"]
for item in result.values():
    assert item["formMounted"] and item["focusKept"] and item["leaked"] == []
