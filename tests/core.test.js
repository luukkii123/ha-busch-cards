'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ladeKarte}=require('./laden');
const {baueHass}=require('./geraet-attrappe');
function load(extra={}) {return ladeKarte(['ensureBuschCore','BuschCardsCore','BuschRegistryCache','BuschEntityIndex'],{setTimeout,clearTimeout,queueMicrotask,performance,...extra});}
function fresh(){const {BuschCardsCore}=load();return new BuschCardsCore();}
test('core singleton and incompatible major fail explicitly',()=>{
 const {ensureBuschCore}=load();assert.equal(ensureBuschCore(1),ensureBuschCore('1.0'));assert.equal(ensureBuschCore(1).apiVersion,'1.0');assert.throws(()=>ensureBuschCore(2),/API/);
});
test('registry promises are shared and failed requests can retry',async()=>{
 const c=fresh(),h=baueHass();c.attach(h);await c.ready;
 assert.equal(c.registry.load('entity'),c.registry.load('entity'));
 await Promise.all(Array.from({length:25},()=>c.registry.load('label')));
 assert.equal(h.aufrufe.filter(x=>x==='config/label_registry/list').length,1);
 let calls=0;c.registry.hass={callWS:async()=>{if(++calls===1)throw Error('denied');return [];}};
 c.registry.invalidate('label');await assert.rejects(c.registry.load('label'),/denied/);await c.registry.load('label');assert.equal(calls,2);c.dispose();
});
test('index covers metadata, inherited area/floor/labels and device relationships',()=>{
 const c=fresh(),h=baueHass();h.devices.d1.labels=['device-label'];h.devices.d1.config_entries=['entry'];h.devices.d2.via_device_id='d1';h.areas.wohnzimmer.floor_id='floor';h.floors={floor:{floor_id:'floor'}};
 c.seed(h);assert.equal(c.getDevice('d1').model,'Plus 1PM');assert.ok(c.getDeviceEntities('d1').some(e=>e.entity_id==='light.decke'));
 for(const [field,key] of [['domain','light'],['state','on'],['integration','shelly'],['device','d1'],['area','wohnzimmer'],['floor','floor'],['label','device-label'],['manufacturer','Shelly'],['model','Plus 1PM']])assert.ok(c.index.indices[field].get(key).has('light.decke'),field);
 assert.ok(c.index.deviceIndices.via_device_id.get('d1').has('d2'));assert.ok(c.index.deviceIndices.config_entry_id.get('entry').has('d1'));
 assert.equal(c.getEntity('sensor.decke_leistung').attributes.friendly_name,'Wohnzimmer Deckenlampe Leistung');
 c.updateState('light.decke',null);assert.equal(c.getEntity('light.decke').state,undefined);assert.ok(!c.index.indices.state.get('on')?.has('light.decke'));c.dispose();
});
test('state updates are incremental and leave unrelated entity objects stable',()=>{
 const c=fresh(),h=baueHass();c.seed(h);const other=c.getEntity('sensor.anderes');c.updateState('light.decke',{...h.states['light.decke'],state:'off'});assert.equal(c.getEntity('sensor.anderes'),other);assert.equal(c.getEntity('light.decke').state,'off');c.dispose();
});
test('late registry answers cannot overwrite a new connection',async()=>{
 const c=fresh();const releases=[];const a=baueHass();a.connection={};a.callWS=()=>new Promise(r=>releases.push(r));c.attach(a);const old=c.ready;
 await Promise.resolve();const b=baueHass();b.connection={};b.callWS=async()=>[];c.attach(b);await c.ready;
 releases.forEach(release=>release([{entity_id:'sensor.old',device_id:'old'}]));await old;assert.equal(c.getEntity('sensor.old'),undefined);c.dispose();
});
module.exports={load,fresh};
test('stream registration is followed by a fresh state snapshot',async()=>{
 const c=fresh(),h=baueHass(),callbacks={};h.connection={subscribeEvents:async(fn,type)=>{callbacks[type]=fn;return ()=>{};}};
 const original=h.callWS.bind(h);h.callWS=async msg=>msg.type==='get_states'?[{entity_id:'light.decke',state:'off',attributes:{},last_updated:'2026-01-01T00:00:02Z'}]:original(msg);
 c.attach(h);await c.ready;await new Promise(r=>setImmediate(r));assert.equal(c.getEntity('light.decke').state,'off');c.dispose();
});
test('registry changes notify every attached consumer and failures stay inspectable',async()=>{
 const c=fresh(),h=baueHass();c.attach(h);await c.ready;let count=0;const unwatch=c.watch(()=>count++);
 h.devices={...h.devices,d1:{...h.devices.d1,name_by_user:'Renamed'}};await c.refreshRegistries(['device']);await Promise.resolve();assert.equal(c.getDevice('d1').name_by_user,'Renamed');assert.equal(count,1);unwatch();c.dispose();
});
test('stream is cleaned up and ready event resynchronizes',async()=>{
 const c=fresh(),h=baueHass();let unsubscribed=0;const events={};h.connection={subscribeEvents:async()=>()=>unsubscribed++,addEventListener:(n,fn)=>events[n]=fn,removeEventListener:(n)=>delete events[n]};
 const original=h.callWS.bind(h);let newState='on';h.callWS=async msg=>msg.type==='get_states'?[{entity_id:'light.decke',state:newState,attributes:{}}]:original(msg);
 c.attach(h);await c.ready;await new Promise(r=>setImmediate(r));assert.equal(typeof events.ready,'function');newState='off';await events.ready();await new Promise(r=>setImmediate(r));assert.equal(c.getEntity('light.decke').state,'off');c.dispose();assert.equal(unsubscribed,6);assert.equal(events.ready,undefined);
});
test('two resource evaluations share the core without duplicate element registration',()=>{
 const vm=require('node:vm');const {quelle}=require('./laden');const registered=new Map();const ctx={console:{info(){},warn(){}},HTMLElement:class{},window:{customCards:[]},customElements:{get:n=>registered.get(n),define:(n,c)=>{if(registered.has(n))throw Error('duplicate '+n);registered.set(n,c);}}};vm.createContext(ctx);
 vm.runInContext('(function(){'+quelle()+';globalThis.first=ensureBuschCore(1);})()',ctx);
 vm.runInContext('(function(){'+quelle()+';globalThis.second=ensureBuschCore(1);})()',ctx);
 assert.equal(ctx.first,ctx.second);assert.equal(new Set(ctx.window.customCards.map(c=>c.type)).size,ctx.window.customCards.length);
});
test('registry events during a request queue a fresh snapshot',async()=>{
 const c=fresh(),h=baueHass();c.attach(h);await c.ready;const pending=[];let calls=0;
 h.callWS=()=>{calls++;return new Promise(resolve=>pending.push(resolve));};
 const first=c.refreshRegistries(['device']);await Promise.resolve();
 const second=c.refreshRegistries(['device'],true);pending.shift()([{id:'d1',name:'Old'}]);
 for(let i=0;i<10;i++)await Promise.resolve();assert.equal(calls,2);
 pending.shift()([{id:'d1',name:'New'}]);await Promise.all([first,second]);assert.equal(c.getDevice('d1').name,'New');c.dispose();
});
test('snapshot overlays buffered newer events without replacing newer snapshot state',async()=>{
 const c=fresh(),h=baueHass(),events={};let release;
 h.connection={subscribeEvents:async(fn,type)=>{events[type]=fn;return ()=>{};}};
 const original=h.callWS.bind(h);h.callWS=msg=>msg.type==='get_states'?new Promise(r=>release=r):original(msg);
 c.attach(h);for(let i=0;i<15;i++)await Promise.resolve();
 const state=(id,time,value)=>({entity_id:id,state:value,attributes:{},last_updated:time});
 events.state_changed({data:{entity_id:'sensor.newer',new_state:state('sensor.newer','2026-01-01T00:00:03Z','event')}});
 events.state_changed({data:{entity_id:'sensor.older',new_state:state('sensor.older','2026-01-01T00:00:01Z','event')}});
 release([state('sensor.newer','2026-01-01T00:00:02Z','snapshot'),state('sensor.older','2026-01-01T00:00:02Z','snapshot')]);
 await c.ready;assert.equal(c.getEntity('sensor.newer').state,'event');assert.equal(c.getEntity('sensor.older').state,'snapshot');c.dispose();
});
test('a new connection cannot inherit labels when its registry is denied',async()=>{const c=fresh(),a=baueHass();c.attach(a);await c.ready;assert.equal(c.labels.size,2);const b=baueHass(),original=b.callWS.bind(b);b.callWS=msg=>msg.type==='config/label_registry/list'?Promise.reject(Error('denied')):original(msg);c.attach(b);await c.ready;assert.equal(c.labels.size,0);assert.ok(c.lastErrors.has('label'));c.dispose();});
test('reconnect replaces an in-flight state snapshot and rejects its late answer',async()=>{
 const c=fresh(),h=baueHass(),events={},pending=[];h.connection={subscribeEvents:async()=>()=>{},addEventListener:(n,fn)=>events[n]=fn,removeEventListener:()=>{}};
 const original=h.callWS.bind(h);h.callWS=msg=>msg.type==='get_states'?new Promise(r=>pending.push(r)):original(msg);
 c.attach(h);const old=c.ready;for(let i=0;i<15;i++)await Promise.resolve();assert.equal(pending.length,1);
 const current=events.ready();for(let i=0;i<15;i++)await Promise.resolve();assert.equal(pending.length,2);
 pending[1]([{entity_id:'light.decke',state:'new',attributes:{}}]);await current;
 pending[0]([{entity_id:'light.decke',state:'old',attributes:{}}]);await old;assert.equal(c.getEntity('light.decke').state,'new');c.dispose();
});
test('device watchers batch relevant stream updates and ignore unrelated devices',async()=>{const c=fresh(),h=baueHass();c.seed(h);let calls=0;const off=c.watchDevice('d1',()=>calls++);c.updateState('sensor.anderes',{...h.states['sensor.anderes'],state:'9'});await Promise.resolve();assert.equal(calls,0);c.updateState('light.decke',{...h.states['light.decke'],state:'off'});c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'8'});await Promise.resolve();assert.equal(calls,1);off();c.updateState('light.decke',h.states['light.decke']);await Promise.resolve();assert.equal(calls,1);c.dispose();});
