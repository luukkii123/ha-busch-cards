'use strict';
// M31 (#1311, W7): Smart editor shows dictionary texts instead of raw values, a whole "add rule" label,
// one-line tabs and captions above their fields. Include/Exclude/Template stay as terms (E8).
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const kit=require('./_testkit.cjs');
const BUNDLE=path.join(__dirname,'..','dist','busch-cards.js');

async function open(language,config){
 const clock=kit.createClock(),env=kit.createEnvironment({clock,language,globals:{performance:{now:()=>clock.now}}});
 class Form extends env.HTMLElement {}
 env.customElements.define('ha-form',Form);kit.loadScript(BUNDLE,{globals:env});
 const ha=kit.createHass({clock,states:{'sensor.a':{state:'5',attributes:{friendly_name:'A',device_class:'battery'}}}});
 const editor=env.document.createElement('busch-smart-entities-editor');editor.dispatchEvent=()=>true;
 editor.hass={...ha.hass,language,locale:{...(ha.hass.locale||{}),language}};editor.setConfig(config);env.document.body.appendChild(editor);await clock.advance(50);
 const all=()=>editor.shadowRoot.descendants();
 return {editor,all,forms:()=>all().filter(n=>n.tagName==='HA-FORM'),buttons:()=>all().filter(n=>n.tagName==='BUTTON')};
}
const CONFIG={type:'custom:busch-smart-entities',card:{type:'entities'},item:{type:'tile'},item_param:'entity',value:{type:'attribute',attribute:'device_class'},
 filter:{include:[{domain:'sensor',attributes:{flag:true}}]},unique:'entity',sort:{method:'last_changed'}};

for(const language of ['de','en'])test(`M31 ${language}: every select option of the Smart editor shows a dictionary text, never its raw value`,async()=>{
 const {forms}=await open(language,CONFIG),raw=[];let options=0;
 for(const form of forms())for(const field of form.schema||[])for(const option of field.selector?.select?.options||[]){
  options++;const value=typeof option==='string'?option:option.value,label=typeof option==='string'?option:option.label;
  // Custom card types and attribute paths (entity data) are technical identifiers that HA itself shows as such.
  if(String(value).startsWith('custom:')||field.name==='attribute')continue;
  if(label===value)raw.push(field.name+'='+value);
 }
 assert.ok(options>=20,'value_type, missing, unique, method, card_type and item_type are rendered: '+options);
 assert.deepEqual(raw,[]);
});

test('M31: typed booleans read Ja/Nein (de) and Yes/No (en) while keeping true/false as values',async()=>{
 for(const [language,yes,no] of [['de','Ja','Nein'],['en','Yes','No']]){
  const {all}=await open(language,CONFIG),select=all().find(n=>n.tagName==='SELECT'&&n.value==='true');assert.ok(select,'boolean select for attributes.flag');
  assert.deepEqual(select.children.map(o=>[o.value,o.textContent]),[['true',yes],['false',no]]);
 }
});

test('M31: the add-rule button says "Regel hinzufügen" / "Add rule"; no button label is a "·" fragment',async()=>{
 for(const [language,text] of [['de','Regel hinzufügen'],['en','Add rule']]){
  const {buttons}=await open(language,CONFIG),labels=buttons().map(b=>b.getAttribute('aria-label'));
  assert.ok(labels.includes(text),labels.join(' | '));assert.deepEqual(labels.filter(l=>/·/.test(l||'')),[]);
  assert.ok(labels.includes(language==='de'?'Entfernen':'Remove'),'the remove pair stays');
 }
});

test('M31: tabs carry one-line short labels and the tab CSS truncates instead of wrapping',async()=>{
 for(const [language,expected] of [['de',['Filter','Zielkarte','Optionen']],['en',['Filters','Target card','Options']]]){
  const {all}=await open(language,CONFIG),tabs=all().filter(n=>n.getAttribute('role')==='tab');
  assert.deepEqual(tabs.map(t=>t.textContent),expected);assert.deepEqual(tabs.map(t=>t.getAttribute('aria-label')),expected);
 }
 const {BUSCH_SMART_EDITOR_CSS}=kit.loadScript(BUNDLE,{globals:kit.createEnvironment(),expose:['BUSCH_SMART_EDITOR_CSS']}).exposed;
 const rule=/\.tabs button\{([^}]*)\}/.exec(BUSCH_SMART_EDITOR_CSS)?.[1]||'';
 for(const part of ['white-space:nowrap','overflow:hidden','text-overflow:ellipsis','min-width:0'])assert.ok(rule.includes(part),part+' in .tabs button');
 assert.equal(rule.includes('overflow-wrap:anywhere'),false);
});

test('M31: a typed value caption sits on its own line above the controls',async()=>{
 const {all}=await open('de',CONFIG),captions=all().filter(n=>n.tagName==='SPAN'&&n.className==='field-caption');
 assert.ok(captions.length>=3,'object editor captions: '+captions.length);
 for(const caption of captions){const row=caption.parentNode;assert.equal(row.className,'row');assert.equal(row.children[0],caption,'caption first in its row');}
 const {BUSCH_SMART_EDITOR_CSS}=kit.loadScript(BUNDLE,{globals:kit.createEnvironment(),expose:['BUSCH_SMART_EDITOR_CSS']}).exposed;
 assert.match(BUSCH_SMART_EDITOR_CSS,/\.row>\.field-caption\{[^}]*flex-basis:100%/);
});
