'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ladeKarte}=require('./laden');
function fixture(dirty=false){
 let backs=0,closes=0,accepted=false;
 const window={customCards:[],confirm:()=>accepted};
 const {BuschScheduleCard}=ladeKarte(['BuschScheduleCard'],{window,history:{state:{busch_schedule_dialog:'busch-schedule-card:block'},back(){backs++;}},setTimeout(){},navigator:{language:'de'}});
 const card=Object.create(BuschScheduleCard.prototype),dialog={open:true,_buschPop(){},querySelector(){return {textContent:''}},close(){closes++;this.open=false}};
 card._els={blockDialog:dialog};card._dialogTarget={day:'monday',index:0};card._blockGeaendert=()=>dirty;card._wackeln=()=>{};
 return {card,dialog,get backs(){return backs},get closes(){return closes},accept(){accepted=true}};
}
test('clean edit dialog ignores backdrop clicks',()=>{const f=fixture();f.card._resolveBlockDialog('scrim');assert.equal(f.backs,0);assert.equal(f.dialog.open,true);assert.ok(f.card._dialogTarget);});
test('two native cancel events spend exactly one history entry',()=>{const f=fixture();f.card._resolveBlockDialog('escape');f.card._resolveBlockDialog('escape');assert.equal(f.backs,1);assert.equal(f.dialog.open,true);});
test('dirty Escape and rejected explicit cancellation preserve target',()=>{const f=fixture(true);f.card._resolveBlockDialog('escape');f.card._resolveBlockDialog('cancel');assert.equal(f.backs,0);assert.ok(f.card._dialogTarget);f.accept();f.card._resolveBlockDialog('cancel');assert.equal(f.backs,1);assert.equal(f.card._dialogTarget,null);});
