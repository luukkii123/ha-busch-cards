'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {ladeKarte}=require('./laden');const {baueHass}=require('./geraet-attrappe');
const {devGeraetAufloesen,devNormalisiereKonfig,SCHEMA_BUSCH_DEVICE_CARD,BuschDeviceCardEditor}=ladeKarte(['devGeraetAufloesen','devNormalisiereKonfig','SCHEMA_BUSCH_DEVICE_CARD','BuschDeviceCardEditor']);
test('device_id alone resolves actual registry device and a usable entity',()=>{const h=baueHass(),r=devGeraetAufloesen(h,'','d1');assert.equal(r.geraet.id,'d1');assert.equal(r.entityId,'light.decke');});
test('a missing device gives an explicit error without throwing',()=>{assert.equal(devGeraetAufloesen(baueHass(),'','missing').fehler,'geraetFehlt');});
test('a device with no entities remains a valid device',()=>{const h=baueHass();h.devices.empty={id:'empty',name:'Empty'};const r=devGeraetAufloesen(h,'','empty');assert.equal(r.geraet.id,'empty');assert.equal(r.entityId,'');});
test('a primary entity from another device cannot override device_id',()=>{const r=devGeraetAufloesen(baueHass(),'sensor.anderes','d1');assert.equal(r.geraet.id,'d1');assert.equal(r.entityId,'light.decke');});
test('legacy entity config keeps the selected entity',()=>{const r=devGeraetAufloesen(baueHass(),'sensor.decke_energie');assert.equal(r.geraet.id,'d1');assert.equal(r.entityId,'sensor.decke_energie');});
test('device-only configuration and editor preserve the stable id',()=>{const cfg=devNormalisiereKonfig({device_id:'d1'});assert.equal(cfg.device_id,'d1');assert.equal(cfg.entity,'');const field=SCHEMA_BUSCH_DEVICE_CARD.find(f=>f.name==='device_id');assert.ok(field.selector.device);assert.ok(!SCHEMA_BUSCH_DEVICE_CARD.find(f=>f.name==='entity').required);const editor=new BuschDeviceCardEditor();editor._config={type:'custom:busch-device-card'};let saved;editor._emit=c=>saved=c;editor._uebernehmen({device_id:'d1'});assert.equal(saved.device_id,'d1');assert.ok(!saved.entity);});
test('automatic primary requires an available control',()=>{const h=baueHass();h.states['light.decke'].state='unavailable';const r=devGeraetAufloesen(h,'','d1');assert.notEqual(r.entityId,'light.decke');assert.ok(!r.entityId || r.entityId.startsWith('switch.'));assert.equal(devGeraetAufloesen(h,'','d2').entityId,'');});
test('late labels from an old connection cannot overwrite card labels',async()=>{
 const {BuschDeviceCard}=ladeKarte(['BuschDeviceCard'],{setTimeout,clearTimeout,performance});
 const card=new BuschDeviceCard();card._render=()=>{};card._zeichneChips=()=>{};
 const a=baueHass(),pending=[];a.callWS=()=>new Promise(resolve=>pending.push(resolve));card.hass=a;const old=card._core.ready;await Promise.resolve();
 const b=baueHass();card.hass=b;await card._core.ready;assert.equal(card._labels.size,2);
 pending.forEach(resolve=>resolve([]));await old;await Promise.resolve();assert.equal(card._labels.size,2);card.disconnectedCallback();
});
