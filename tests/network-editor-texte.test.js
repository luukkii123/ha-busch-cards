'use strict';
// M31 remainder (#1311, W7): the network/FRITZ rule editor says "Regel hinzufügen" / "Add rule" like the Smart editor,
// never the fragment "Hinzufügen · Regel".
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const kit=require('./_testkit.cjs');
const BUNDLE=path.join(__dirname,'..','dist','busch-cards.js');

function render(language,kind){
 const env=kit.createEnvironment({language});
 const {buschNetworkRuleEditor,TEXTE_BUSCH_NETWORK_CARD,TEXTE_BUSCH_FRITZ_DEVICE_CARD}=kit.loadScript(BUNDLE,{globals:env,expose:['buschNetworkRuleEditor','TEXTE_BUSCH_NETWORK_CARD','TEXTE_BUSCH_FRITZ_DEVICE_CARD']}).exposed;
 const t=(kind==='fritz'?TEXTE_BUSCH_FRITZ_DEVICE_CARD:TEXTE_BUSCH_NETWORK_CARD)[language];
 const parent=env.document.createElement('div');env.document.body.appendChild(parent);
 buschNetworkRuleEditor(parent,{domain:'device_tracker',or:[{state:'home'}]},()=>{},t);
 return parent.descendants().filter(n=>n.tagName==='BUTTON').map(b=>[b.getAttribute('aria-label'),b.textContent]);
}

for(const kind of ['network','fritz'])test(`M31 ${kind}: the rule editor's add-rule button reads "Regel hinzufügen" / "Add rule", no "·" fragment`,()=>{
 for(const [language,text,remove] of [['de','Regel hinzufügen','Entfernen'],['en','Add rule','Remove']]){
  const buttons=render(language,kind),labels=buttons.map(([aria])=>aria);
  assert.ok(buttons.some(([aria,shown])=>aria===text&&shown===text),labels.join(' | '));
  assert.deepEqual(labels.filter(l=>/·/.test(l||'')),[]);
  assert.ok(labels.includes(remove),'the remove pair stays');
 }
});
