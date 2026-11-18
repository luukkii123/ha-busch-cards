'use strict';
// M17 (#1281, S3): optional admin boundary for router actions and optional Wi-Fi confirmation.
// Both options default to off (E1), so the first test pins today's behaviour.
const {test,afterEach}=require('node:test');const assert=require('node:assert/strict');const {load,fixture}=require('./network-fixture');
const descend=node=>[node,...(node.children||[]).flatMap(descend)];
const ROUTER=['reboot','reconnect','update'];
const cards=[];
// Release the shared Core uptime clock, otherwise its timer keeps the test process alive.
afterEach(()=>{for(const c of cards.splice(0))c.disconnectedCallback();});

function setup({config={},admin=true,kind='fritz'}={}){
 const l=load(),f=fixture(l),calls=[],confirms=[];
 f.add('button.reconnect','router','box-key-reconnect','unknown');f.refresh();
 l.window.confirm=text=>{confirms.push(text);return true;};
 const c=kind==='fritz'?new l.BuschFritzDeviceCard():new l.BuschNetworkCard();
 cards.push(c);c._core=f.core;c._hass={...f.hass,user:{is_admin:admin},callService:async(...a)=>calls.push(a)};
 c.setConfig({...(kind==='fritz'?{device_id:'router'}:{}),...config});
 const t=l.BUSCH_NETWORK_TEXT.en;
 const buttons=()=>descend(c.shadowRoot).filter(n=>n.tagName==='BUTTON');
 const labels=()=>buttons().map(n=>n.attributes['aria-label']);
 const button=label=>buttons().find(n=>n.attributes['aria-label']===label);
 const wlanLabel=state=>'switch.radio · '+(state==='on'?t.yes:t.no);
 return {l,f,c,calls,confirms,t,labels,button,wlanLabel,services:()=>calls.map(a=>a[0]+'.'+a[1]+' '+a[2].entity_id)};
}
async function runAll(s){for(const kind of ROUTER)await s.c._nativeAction(kind);await s.c._nativeAction('internet','device_tracker.renamed');await s.c._wlanAction('switch.radio');}

test('without admin_actions a non-admin keeps every router button and action (default unchanged)',async()=>{
 const s=setup({admin:false});assert.equal(s.c._config.admin_actions,false);assert.equal(s.c._config.confirm_wlan,false);
 const labels=s.labels();for(const role of ROUTER)assert.ok(labels.includes(s.t[role]),role);assert.ok(labels.includes(s.wlanLabel('on')));assert.ok(labels.includes(s.t.internet_on));
 await runAll(s);assert.deepEqual(s.services(),['button.press button.renamed','button.press button.reconnect','update.install update.native','switch.turn_on switch.internet','switch.turn_off switch.radio']);
});

test('admin_actions: a non-admin sees no router buttons and makes zero callService for reboot, reconnect, update, internet, WLAN',async()=>{
 const s=setup({admin:false,config:{admin_actions:true}});const labels=s.labels();
 for(const role of ROUTER)assert.equal(labels.includes(s.t[role]),false,role);
 assert.equal(labels.includes(s.wlanLabel('on')),false);assert.equal(labels.includes(s.t.internet_on),false);assert.equal(labels.includes(s.t.internet_off),false);
 assert.ok(labels.includes(s.t.wol),'WOL stays a user action');
 const text=descend(s.c.shadowRoot).map(n=>n.textContent||'').join('|');assert.ok(text.includes(s.wlanLabel('on')),'WLAN state stays visible as text');
 await runAll(s);assert.deepEqual(s.calls,[]);
 await s.c._nativeAction('wol','device_tracker.renamed');assert.deepEqual(s.services(),['button.press button.wake']);
});

test('admin_actions on the network card hides and blocks internet access for a non-admin',async()=>{
 const s=setup({kind:'network',admin:false,config:{admin_actions:true}});const labels=s.labels();
 assert.equal(labels.includes(s.t.internet_on),false);assert.ok(labels.includes(s.t.wol));
 await s.c._nativeAction('internet','device_tracker.renamed');assert.deepEqual(s.calls,[]);
});

test('admin_actions: an admin keeps every router button and action',async()=>{
 const s=setup({admin:true,config:{admin_actions:true}});const labels=s.labels();
 for(const role of ROUTER)assert.ok(labels.includes(s.t[role]),role);assert.ok(labels.includes(s.wlanLabel('on')));assert.ok(labels.includes(s.t.internet_on));
 await runAll(s);assert.equal(s.calls.length,5);
});

test('admin_actions: a button rendered for an admin does nothing after the user is no longer admin',async()=>{
 const s=setup({admin:true,config:{admin_actions:true}});
 const stale=[...ROUTER.map(r=>s.button(s.t[r])),s.button(s.wlanLabel('on')),s.button(s.t.internet_on)];assert.ok(stale.every(Boolean));
 s.c._hass.user={is_admin:false};
 for(const node of stale)node.listeners.click({stopPropagation(){}});await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(s.calls,[]);
});

test('confirm_wlan: WLAN switches only after confirmation; without the option no prompt',async()=>{
 let s=setup({config:{confirm_wlan:true}});s.l.window.confirm=text=>{s.confirms.push(text);return false;};
 await s.c._wlanAction('switch.radio');assert.deepEqual(s.calls,[]);assert.equal(s.confirms.length,1);
 s.l.window.confirm=text=>{s.confirms.push(text);return true;};await s.c._wlanAction('switch.radio');assert.deepEqual(s.services(),['switch.turn_off switch.radio']);
 s=setup();await s.c._wlanAction('switch.radio');assert.equal(s.confirms.length,0);assert.equal(s.calls.length,1);
});

test('editor offers admin_actions on both cards and confirm_wlan on the FRITZ card',()=>{
 const l=load(),f=fixture(l),names=kind=>l.buschNetworkSchema(f.core,{device_id:'router'},kind).map(s=>s.name);
 assert.ok(names('network').includes('admin_actions'));assert.equal(names('network').includes('confirm_wlan'),false);
 assert.ok(names('fritz').includes('admin_actions'));assert.ok(names('fritz').includes('confirm_wlan'));
 for(const lang of ['de','en'])for(const key of ['admin_actions','confirm_wlan'])assert.match(l.BUSCH_NETWORK_TEXT[lang].helpers[key],/(Vorgabe aus|Default off)\.$/);
});
