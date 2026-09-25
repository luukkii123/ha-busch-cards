#!/usr/bin/env python3
"""Prueft den neuen Smart-Editor mit echtem ha-form im laufenden HA-Frontend.

Aufruf im Playwright-Container:
  python3 live-ha-smart-editor.py /cards/dist/busch-cards.js /run/ha-test.json

Die private JSON-Datei liegt AUSSERHALB des Repositories und enthaelt
{"base_url": "...", "token": "..."}. Nur Boolesche Ergebnisse und Masse
werden ausgegeben. Es werden keine Dashboards oder Entitaeten geaendert.
"""

import json
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


def run(bundle: Path, credentials: Path) -> dict:
    private = json.loads(credentials.read_text(encoding="utf-8"))
    base = private["base_url"].rstrip("/")
    auth = {
        "hassUrl": base,
        "clientId": base + "/",
        "expires": 4102444800000,
        "expires_in": 315360000,
        "refresh_token": "",
        "access_token": private["token"],
    }
    # Die installierte Version der Karte ist im Frontend bereits registriert.
    # Ein privater Test-Praefix isoliert das neue Bundle in diesem Browsertab.
    source = bundle.read_text(encoding="utf-8").replace("busch-", "codex-busch-")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True,
                                      viewport={"width": 320, "height": 900})
        context.add_init_script(script=
            "localStorage.setItem('hassTokens', JSON.stringify(%s));" % json.dumps(auth))
        page = context.new_page()
        page.goto(base + "/profile", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_function(
            "() => !!document.querySelector('home-assistant')?.hass && "
            "!!customElements.get('ha-form')", timeout=30000)
        page.add_script_tag(content="(function(){\n" + source + "\n})();")
        page.evaluate("""() => {
            const host = document.createElement('main');
            host.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px';
            const editor = document.createElement('codex-busch-smart-entities-editor');
            editor.style.cssText = 'display:block;width:100%;box-sizing:border-box';
            editor.hass = document.querySelector('home-assistant').hass;
            editor.setConfig({type:'custom:codex-busch-smart-entities',
                card:{type:'entities'},filter:{include:[{domain:'sensor'}]}});
            host.append(editor);
            document.body.append(host);
            editor.shadowRoot.querySelector('[data-group=card]').click();
            window.__codexProbe = {editor, host, emitted:[], leaked:[]};
            editor.addEventListener('config-changed', event => {
                window.__codexProbe.emitted.push(event.detail.config);
                editor.setConfig(JSON.parse(JSON.stringify(event.detail.config)));
            });
            document.addEventListener('keydown', event =>
                window.__codexProbe.leaked.push(event.key));
        }""")
        page.wait_for_function("""() => {
            const editor=window.__codexProbe?.editor;
            if(!editor) return false;
            const form=[...editor.shadowRoot.querySelectorAll('ha-form')]
                .find(f => (f.schema||[]).some(x => x.name === 'card_param'));
            if(!form?.shadowRoot) return false;
            const deep=(root, tag) => {
                for(const el of root.querySelectorAll('*')) {
                    if(el.matches(tag)) return el;
                    if(el.shadowRoot) {const found=deep(el.shadowRoot,tag);if(found)return found;}
                }
                return null;
            };
            const input=deep(form.shadowRoot,'input');
            if(!input) return false;
            window.__codexProbe.input=input;
            window.__codexProbe.form=form;
            return true;
        }""", timeout=20000)
        page.evaluate("""() => {
            const input=window.__codexProbe.input;
            input.focus();
            input.select();
        }""")
        page.keyboard.type("aecdk", delay=20)
        page.wait_for_timeout(300)
        result = page.evaluate("""() => {
            const p=window.__codexProbe, config=p.emitted.at(-1);
            const reopened=document.createElement('codex-busch-smart-entities-editor');
            reopened.hass=document.querySelector('home-assistant').hass;
            if(config) reopened.setConfig(JSON.parse(JSON.stringify(config)));
            const widths=[320,480,960].map(width=>{
                p.host.style.width=width+'px';
                return {width, overflow:p.editor.scrollWidth>p.editor.clientWidth+1};
            });
            for(const modifier of ['ctrlKey','metaKey'])
                p.input.dispatchEvent(new KeyboardEvent('keydown',
                    {key:'k',[modifier]:true,bubbles:true,composed:true,cancelable:true}));
            return {
                realForm:p.form.constructor!==HTMLElement,
                emissions:p.emitted.length,
                complete:!!config?.card && !!config?.filter,
                saved:config?.card_param==='aecdk',
                inputPreserved:p.input.isConnected && p.input.value==='aecdk',
                reopened:reopened._config?.card_param==='aecdk',
                leakedKeys:p.leaked.length,
                widths,
            };
        }""")
        browser.close()
    return result


def main() -> int:
    stage = "start"
    try:
        stage = "browser"
        result = run(Path(sys.argv[1]), Path(sys.argv[2]))
        print(json.dumps(result, ensure_ascii=False))
        good = (result["realForm"] and result["emissions"] >= 5
                and result["complete"] and result["saved"]
                and result["inputPreserved"] and result["reopened"]
                and result["leakedKeys"] == 0
                and not any(item["overflow"] for item in result["widths"]))
        return 0 if good else 1
    except Exception as error:
        # Fehlermeldungen von Browser/Netz koennen private URLs enthalten.
        print("Live-Editor-Probe fehlgeschlagen:", stage, type(error).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
