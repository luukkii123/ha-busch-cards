'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ladeKarte}=require('./laden');
test('Smart add-card example selects a small real integration and caps results',()=>{
 const {BuschSmartEntities,BuschCardsCore}=ladeKarte(['BuschSmartEntities','BuschCardsCore'],{performance,setTimeout,clearTimeout});const states={},entities={};
 for(let i=0;i<1000;i++){const id='sensor.other_'+i;states[id]={entity_id:id,state:'1',attributes:{}};entities[id]={entity_id:id,platform:'mqtt'};}
 for(let i=0;i<9;i++){const id='sensor.sun_'+i;states[id]={entity_id:id,state:'1',attributes:{}};entities[id]={entity_id:id,platform:'sun'};}
 const hass={states,entities,devices:{},areas:{}};const config=BuschSmartEntities.getStubConfig(hass);assert.equal(config.filter.include[0].integration,'sun');assert.equal(config.sort.count,6);
 const core=new BuschCardsCore();core.hass=hass;core.seed(hass);const q=core.smartQuery(config);assert.equal(q.result.length,6);assert.ok(q.result.every(r=>r.entity.startsWith('sensor.sun_')));core.dispose();
});
test('Smart example uses the smallest available integration when sun is absent',()=>{const {BuschSmartEntities}=ladeKarte(['BuschSmartEntities']);const c=BuschSmartEntities.getStubConfig({states:{'sensor.a':{},'sensor.b':{},'sensor.c':{}},entities:{'sensor.a':{platform:'mqtt'},'sensor.b':{platform:'mqtt'},'sensor.c':{platform:'time_date'}}});assert.equal(c.filter.include[0].integration,'time_date');});
test('Smart example without hass remains bounded and never defaults to all sensors',()=>{const {BuschSmartEntities}=ladeKarte(['BuschSmartEntities']);const c=BuschSmartEntities.getStubConfig();assert.equal(c.filter.include[0].integration,'sun');assert.equal(c.sort.count,6);});
test('calendar preview and legacy editMode update the same layout flag without reloading',()=>{const {BuschCalendarCard}=ladeKarte(['BuschCalendarCard']);const c=new BuschCalendarCard(),attrs=new Map();c.toggleAttribute=(k,v)=>v?attrs.set(k,''):attrs.delete(k);c.preview=true;assert.ok(attrs.has('data-preview'));assert.equal(c.editMode,true);c.editMode=false;assert.equal(c.preview,false);assert.ok(!attrs.has('data-preview'));});
