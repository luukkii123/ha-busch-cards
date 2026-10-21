#!/usr/bin/env python3
"""Seven-card native Lovelace editor roundtrip on a disposable dashboard.

The caller creates an admin-only hidden dashboard with seven synthetic views
named probe-1..probe-7 and deletes it after this probe. The credential JSON
and dashboard path are supplied at runtime. No real entity is referenced and
the script never invokes a Home Assistant service.
"""

import json
from pathlib import Path
import sys
import time

from playwright.sync_api import sync_playwright


CASES = [
    ("schedule-card", "title", "Codex Schedule"),
    ("calendar-card", "title", "Codex Calendar"),
    ("map-card", "tile_attribution", "Codex Map"),
    ("device-card", "title", "Codex Device"),
    ("smart-entities", "card_param", "codex_entities"),
    ("unraid-stack-card", "title", "Codex Stack"),
    ("unraid-container-card", "title", "Codex Container"),
]

WALK = """const walk=(root,selector)=>{
  for(const element of root.querySelectorAll('*')){
    if(element.matches(selector))return element;
    if(element.shadowRoot){const child=walk(element.shadowRoot,selector);if(child)return child;}
  }
  return null;
};"""


def run(bundle: Path, credentials: Path, dashboard: str) -> dict:
    private = json.loads(credentials.read_text(encoding="utf-8"))
    base = private["base_url"].rstrip("/")
    auth = {"hassUrl": base, "clientId": base + "/", "expires": 4102444800000,
            "expires_in": 315360000, "refresh_token": "", "access_token": private["token"]}
    source = bundle.read_text(encoding="utf-8").replace("busch-", "codex-busch-")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True,
                                      viewport={"width": 960, "height": 900})
        context.add_init_script(script="localStorage.setItem('hassTokens', JSON.stringify(%s));"
                                % json.dumps(auth))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(type(error).__name__))

        def enter_dashboard(view: int, fresh: bool = False) -> None:
            if fresh:
                page.goto(base + "/profile", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_function("() => !!document.querySelector('home-assistant')?.hass && "
                                       "!!customElements.get('ha-form')", timeout=30000)
                page.add_script_tag(content="(function(){\n" + source + "\n})();")
            page.evaluate("""([path,view])=>{history.pushState({},'',`/${path}/probe-${view}`);
                window.dispatchEvent(new CustomEvent('location-changed',
                {detail:{replace:false},bubbles:true,composed:true}));}""",
                          [dashboard, view])
            page.wait_for_function("""tag=>{const walk=(r)=>{for(const x of r.querySelectorAll('*')){
                if(x.tagName===tag)return true;if(x.shadowRoot&&walk(x.shadowRoot))return true;}return false;};
                return walk(document);}""", arg="CODEX-BUSCH-" + CASES[view - 1][0].upper(), timeout=15000)

        def open_editor(card: str) -> None:
            page.evaluate("""() => {""" + WALK + """
                const wrapper=walk(document,'hui-card-edit-mode');
                if(!wrapper)throw new Error('Card wrapper missing');
                wrapper.shadowRoot.querySelector('.control').click();}""")
            page.wait_for_function("""tag=>{const walk=(r)=>{for(const x of r.querySelectorAll('*')){
                if(x.tagName===tag)return true;if(x.shadowRoot&&walk(x.shadowRoot))return true;}return false;};
                return walk(document);}""", arg="CODEX-BUSCH-" + card.upper() + "-EDITOR", timeout=15000)

        def editor_value(card: str, field: str):
            return page.evaluate("""([tag,field])=>{""" + WALK + """
                const editor=walk(document,tag);return editor?editor._config?.[field]:null;}""",
                                 ["codex-busch-" + card + "-editor", field])

        enter_dashboard(5, True)
        page.get_by_label("Dashboard bearbeiten").first.click()
        results = []
        marker = str(time.time_ns() % 1_000_000_000)
        for index, (card, field, base_value) in enumerate(CASES, start=1):
            value = base_value + "_" + marker
            page.get_by_label("Probe " + str(index), exact=True).first.click()
            page.wait_for_function("""tag=>{const walk=(r)=>{for(const x of r.querySelectorAll('*')){
                if(x.tagName===tag)return true;if(x.shadowRoot&&walk(x.shadowRoot))return true;}return false;};
                return walk(document);}""", arg="CODEX-BUSCH-" + card.upper(), timeout=15000)
            open_editor(card)
            emitted = page.evaluate("""([tag,field,value])=>{""" + WALK + """
                const editor=walk(document,tag);
                if(!editor)throw new Error('Editor missing');
                let count=0;editor.addEventListener('config-changed',event=>{
                    if(event.detail.config?.type&&event.detail.config?.[field]===value)count++;
                });
                const form=[...(editor.shadowRoot||editor).querySelectorAll('ha-form')]
                    .find(item=>item.schema?.some(schema=>schema.name===field));
                if(!form)throw new Error('Form field missing');
                form.data={...form.data,[field]:value};
                form.dispatchEvent(new CustomEvent('value-changed',
                    {detail:{value:{...form.data}},bubbles:true,composed:true}));
                return {count,immediate:editor._config?.[field]===value};}""",
                                    ["codex-busch-" + card + "-editor", field, value])
            page.get_by_role("button", name="Code-Editor anzeigen").click()
            page.wait_for_function("""() => {const walk=(r)=>{for(const x of r.querySelectorAll('*')){
                if(x.tagName==='HA-YAML-EDITOR')return true;
                if(x.shadowRoot&&walk(x.shadowRoot))return true;}return false;};return walk(document);}""")
            page.get_by_role("button", name="Visuellen Editor anzeigen").click()
            page.wait_for_function("""tag=>{const walk=(r)=>{for(const x of r.querySelectorAll('*')){
                if(x.tagName===tag)return true;if(x.shadowRoot&&walk(x.shadowRoot))return true;}return false;};
                return walk(document);}""", arg="CODEX-BUSCH-" + card.upper() + "-EDITOR", timeout=15000)
            visual = editor_value(card, field) == value
            page.get_by_role("button", name="Speichern").click()
            results.append({"card": card, "emissions": emitted["count"],
                            "immediate": emitted["immediate"], "visualRoundtrip": visual})

        page.get_by_role("button", name="Fertig").last.click()
        page.wait_for_timeout(500)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => !!document.querySelector('home-assistant')?.hass && "
                               "!!customElements.get('ha-form')", timeout=30000)
        page.add_script_tag(content="(function(){\n" + source + "\n})();")
        page.get_by_label("Dashboard bearbeiten").first.click()
        for index, (card, field, base_value) in enumerate(CASES, start=1):
            value = base_value + "_" + marker
            page.get_by_label("Probe " + str(index), exact=True).first.click()
            page.wait_for_function("""tag=>{const walk=(r)=>{for(const x of r.querySelectorAll('*')){
                if(x.tagName===tag)return true;if(x.shadowRoot&&walk(x.shadowRoot))return true;}return false;};
                return walk(document);}""", arg="CODEX-BUSCH-" + card.upper(), timeout=15000)
            open_editor(card)
            results[index - 1]["reopened"] = editor_value(card, field) == value
            page.get_by_role("button", name="Abbrechen").click()
        browser.close()
    return {"cases": results, "pageErrors": len(errors)}


def main() -> int:
    try:
        result = run(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["pageErrors"] == 0 and all(
            case["emissions"] and case["immediate"] and
            case["visualRoundtrip"] and case["reopened"]
            for case in result["cases"]) else 1
    except Exception as error:
        # Tool exceptions may contain private HA names, addresses, or URLs.
        print(json.dumps({"error_type": type(error).__name__}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
