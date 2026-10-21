'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{ladeKarte}=require('./laden');
function fixture(){
 const doc={activeElement:null,createElement(){return {children:[],dataset:{},handlers:{},setAttribute(){},addEventListener(e,f){this.handlers[e]=f},appendChild(e){this.children.push(e)},replaceChildren(){this.children=[]}}}};
 const {BuschDeviceCard,devGeraetAufloesen}=ladeKarte(['BuschDeviceCard','devGeraetAufloesen'],{document:doc});
 const card=new BuschDeviceCard(),calls=[];card._config={quick_controls:true};card._filterShowPrimary=true;card._quick=doc.createElement();
 card._hass={locale:{language:'en'},states:{},entities:{},devices:{d:{id:'d'}},config:{unit_system:{temperature:'°C'}},callService(...a){calls.push(a)}};
 return {card,calls,doc,devGeraetAufloesen};
}
const light=id=>({entity_id:id,state:'on',attributes:{supported_color_modes:['brightness'],brightness:128}});
test('I1 removed control cannot redirect its draft to a new automatic primary or a later generation',()=>{
 const {card,calls,doc,devGeraetAufloesen}=fixture();
 for(const id of ['light.a','light.b']){card._hass.states[id]=light(id);card._hass.entities[id]={entity_id:id,device_id:'d'};}
 card._entityId=devGeraetAufloesen(card._hass,'','d').entityId;card._zeichneQuick();
 const old=card._quickNodes[1];doc.activeElement=old;old.value=200;old.handlers.input();
 card._hass.states['light.a'].state='unavailable';card._entityId=devGeraetAufloesen(card._hass,'','d').entityId;card._zeichneQuick();
 const current=card._quickNodes[1];assert.equal(card._entityId,'light.b');assert.notEqual(current,old);assert.equal(Number(current.value),128);
 old.handlers.change();old.handlers.blur?.();assert.equal(calls.length,0);
 card._hass.states['light.a'].state='on';card._entityId=devGeraetAufloesen(card._hass,'','d').entityId;card._zeichneQuick();
 old.handlers.change();assert.equal(calls.length,0,'even return to same entity must reject old generation');
 card._quickNodes[1].value=130;card._quickNodes[1].handlers.change();assert.equal(calls.length,1);assert.equal(calls[0][2].entity_id,'light.a');
});
function climate(){const f=fixture();f.card._entityId='climate.test';f.card._hass.states['climate.test']={entity_id:'climate.test',state:'heat',attributes:{supported_features:1,temperature:21,min_temp:7,max_temp:35,target_temp_step:.5}};f.card._zeichneQuick();return f;}
test('I2 focus without input adopts external state without replacing focused node',()=>{
 const {card,calls,doc}=climate(),el=card._quickNodes[0];doc.activeElement=el;
 card._hass.states['climate.test'].attributes.temperature=23;card._zeichneQuick();
 assert.equal(card._quickNodes[0],el);assert.equal(Number(el.value),23);assert.equal(card._quickOutputs[0].textContent,'23 °C');assert.equal(doc.activeElement,el);
 el.value=Number(el.value)+.5;el.handlers.input();el.handlers.change();assert.equal(calls[0][2].temperature,23.5);
 card._hass.states['climate.test'].attributes.temperature=23.5;card._zeichneQuick();assert.equal(Number(el.value),23.5);
});
test('I2 actual input draft survives external updates until commit, then accepts HA echo',()=>{
 const {card,calls,doc}=climate(),el=card._quickNodes[0];doc.activeElement=el;el.value=22;el.handlers.input();
 card._hass.states['climate.test'].attributes.temperature=23;card._zeichneQuick();assert.equal(Number(el.value),22);assert.equal(card._quickOutputs[0].textContent,'22 °C');assert.equal(calls.length,0);
 el.handlers.change();assert.equal(calls[0][2].temperature,22);
 card._hass.states['climate.test'].attributes.temperature=22.5;card._zeichneQuick();assert.equal(Number(el.value),22.5,'echo must update even while still focused');
});
test('I2 blur and Escape abandon a draft and resync current state without another service',()=>{
 const {card,calls,doc}=climate(),el=card._quickNodes[0];doc.activeElement=el;el.value=22;el.handlers.input();card._hass.states['climate.test'].attributes.temperature=23;card._zeichneQuick();
 el.handlers.blur?.();assert.equal(Number(el.value),23);assert.equal(card._quickOutputs[0].textContent,'23 °C');assert.equal(calls.length,0);
 el.value=24;el.handlers.input();el.handlers.keydown?.({key:'Escape',preventDefault(){}});assert.equal(Number(el.value),23);assert.equal(calls.length,0);
});
test('I2 select input drafts and ordinary focus obey same sync boundaries',()=>{
 const {card,doc,calls}=fixture();card._entityId='climate.test';const attributes={supported_features:0,hvac_modes:['off','heat','cool']};card._hass.states['climate.test']={state:'heat',attributes};card._zeichneQuick();const el=card._quickNodes[0];doc.activeElement=el;card._hass.states['climate.test'].state='cool';card._zeichneQuick();assert.equal(el.value,'cool');
 el.value='heat';el.handlers.input?.();card._hass.states['climate.test'].state='off';card._zeichneQuick();assert.equal(el.value,'heat');el.handlers.change();assert.equal(calls[0][2].hvac_mode,'heat');card._zeichneQuick();assert.equal(el.value,'off');
});
