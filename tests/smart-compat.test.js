'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { ladeKarte } = require('./laden');
const names = ['buschSmartMatch', 'buschSmartFilter', 'buschSmartResult'];
const api = process.env.BUSCH_SMART_FRAGMENT
  ? vm.runInNewContext(fs.readFileSync(process.env.BUSCH_SMART_FRAGMENT, 'utf8') + '\n;({' + names.join(',') + '})')
  : ladeKarte(names);
const clean = x => JSON.parse(JSON.stringify(x));
const now = Date.parse('2026-09-21T12:00:00Z');
function fixture() {
  const devices = [{id:'d1',name:'Device A',manufacturer:'Acme',model:'M1',area_id:'a1',labels:['l1']}];
  const areas = [{area_id:'a1',name:'Kitchen',floor_id:'f1'},{area_id:'a2',name:'Hall',floor_id:'f1'}];
  const floors = [{floor_id:'f1',name:'Ground',level:0}];
  const labels = [{label_id:'l1',name:'Energy'}];
  const registries = ['sensor.a','sensor.b','light.c'].map((entity_id,i)=>({entity_id,device_id:'d1',area_id:i===1?'a2':null,platform:'demo',config_entry_id:'entry',entity_category:i===1?'diagnostic':null,hidden_by:null,labels:[]}));
  const states = Object.fromEntries(registries.map((r,i)=>[r.entity_id,{entity_id:r.entity_id,state:['10','2','on'][i],last_changed:'2026-09-21T11:30:00Z',last_updated:'2026-09-21T11:40:00Z',attributes:{friendly_name:['Zulu','alpha','Lamp'][i],nested:{value:[0,false,''][i]},last_triggered:'2026-09-21T10:00:00Z',obj:{a:1,b:2},ip:['1.2.3.10','1.2.3.2','1.2.3.1'][i]}}]));
  states['group.demo']={entity_id:'group.demo',state:'on',attributes:{entity_id:['sensor.a']}};
  const hass={states,formatEntityState:s=>s.state==='on'?'An':s.state,callWS:async ({type})=>({'config/entity_registry/list':registries,'config/device_registry/list':devices,'config/area_registry/list':areas,'config/floor_registry/list':floors,'config/label_registry/list':labels}[type])};
  return {hass,index:{states:new Map(Object.entries(states))},entities:new Map(Object.values(states).map(s=>[s.entity_id,{registry:registries.find(r=>r.entity_id===s.entity_id),stateObject:s,attributes:s.attributes}])),devices:new Map(devices.map(x=>[x.id,x])),areas:new Map(areas.map(x=>[x.area_id,x])),floors:new Map(floors.map(x=>[x.floor_id,x])),labels:new Map(labels.map(x=>[x.label_id,x]))};
}
test('Smart matcher erhält Zahlen, null, $$ und exakte Altersgrenzen',()=>{
  for(const [v,p,expected] of [[0,0,true],[false,false,true],[undefined,undefined,false],[null,null,true],['12','>= 12',true],['x','!= 12',true],['sensorXa','sensor.*',true],[{a:1},'$$/"a":1/',true],['2026-09-21T11:30:00Z','== 30 m ago',true]]) assert.equal(api.buschSmartMatch(v,p,now),expected,JSON.stringify([v,p]));
});
const rules=[{domain:'sensor'},{entity_id:'sensor.*'},{state:'An'},{name:'/alpha/'},{group:'group.demo'},{attributes:{'nested:value':false}},{'state 1':'> 1','state 2':'< 11'},{not:{domain:'light'}},{and:[{domain:'sensor'},{state:'2'}]},{or:[{state:'on'},{state:'2'}]},{device:'Device A'},{device_manufacturer:'Acme'},{device_model:'M1'},{area:'Kitchen'},{floor:'Ground'},{level:0},{entity_category:'diagnostic'},{integration:'entry'},{hidden_by:null},{label:'Energy'},{last_changed:'>= 30'},{last_updated:'< 1 h ago'},{last_triggered:'>= 2 h ago'},{unknown:true},{options:{name:'x'}},{}];
test('Smart Filter: Registry, Gruppenzugehörigkeit und unbekannte Regeln',()=>{
 const c=fixture(); assert.equal(api.buschSmartFilter(c,{area:'Kitchen'},'sensor.a',now),true); assert.equal(api.buschSmartFilter(c,{area:'Kitchen'},'sensor.b',now),false); assert.equal(api.buschSmartFilter(c,{group:'group.demo'},'sensor.b',now),false); assert.equal(api.buschSmartFilter(c,{unknown:true},'sensor.a',now),false); assert.equal(api.buschSmartFilter(c,{},'sensor.a',now),false);
});
test('Originalreihenfolge: Optionen, lokale Pagination, Exclude, globale Unique',()=>{
 const c=fixture(); const cfg={entities:['sensor.a'],filter:{include:[{domain:'sensor',sort:{method:'state',numeric:true,count:1},options:{name:'this.entity_id'}},{type:'section',label:'Extra'},{entity_id:'sensor.a',options:{name:'other'}}]}};
 assert.deepEqual(clean(api.buschSmartResult(c,cfg)),[{entity:'sensor.a'},{entity:'sensor.b',name:'sensor.b'},{type:'section',label:'Extra'},{entity:'sensor.a',name:'other'}]);
 assert.equal(api.buschSmartResult(c,{...cfg,unique:true}).length,4); assert.equal(api.buschSmartResult(c,{...cfg,unique:'entity'}).length,3);
 assert.equal(api.buschSmartResult(c,{filter:{include:[{domain:'sensor'}]},sort:{count:0}}).length,2);
});
test('Wertausgabe erhält false/0/Leerstring, strukturelles Unique und Missing-Policy',()=>{
 const c=fixture();const base={filter:{include:[{device:'d1'}]},value:{type:'attribute',attribute:'nested:value'}};
 assert.deepEqual(clean(api.buschSmartResult(c,base)),[0,false,'']);
 assert.deepEqual(clean(api.buschSmartResult(c,{...base,value:{type:'attribute',attribute:'missing'}})),[]);
 assert.deepEqual(clean(api.buschSmartResult(c,{...base,value:{type:'attribute',attribute:'missing',missing:'null'},unique_values:true})),[null]);
 assert.deepEqual(clean(api.buschSmartResult(c,{...base,value:{type:'attribute',attribute:'obj'},unique_values:true})),[{a:1,b:2}]);
 assert.deepEqual(clean(api.buschSmartResult(c,{...base,value:{type:'device_id'},unique_values:true})),['d1']);
});
const upstream=process.env.BUSCH_AUTO_ENTITIES_SOURCE;
test('Wert-Unique bleibt typgerecht und behält den ersten Sortierkontext',()=>{
 const c=fixture();const base={filter:{include:[{domain:'sensor'}]},value:{type:'attribute',attribute:'obj'},unique_values:true,sort:{method:'name'}};
 c.index.states.get('sensor.b').attributes.obj={b:2,a:1};
 assert.deepEqual(clean(api.buschSmartResult(c,base)),[{a:1,b:2}]);
 c.index.states.get('sensor.a').attributes.obj=2;
 c.index.states.get('sensor.b').attributes.obj='2';
 assert.deepEqual(clean(api.buschSmartResult(c,base)),['2',2]);
 c.index.states.get('sensor.a').attributes.obj='duplicate';
 c.index.states.get('sensor.b').attributes.obj='different';
 c.index.states.get('sensor.b').attributes.friendly_name='Tango';
 c.index.states.get('light.c').attributes.obj='duplicate';
 // The duplicate's first entity has Zulu as its name; retaining Lamp instead
 // would place the duplicate after Tango in reverse ordering.
 assert.deepEqual(clean(api.buschSmartResult(c,{...base,filter:{include:[{device:'d1'}]},sort:{method:'name',reverse:true}})),['duplicate','different']);
});
test('Treffercache und erneute Suche liefern identische Optionszeilen',()=>{
 const c=fixture(),config={filter:{include:[{domain:'sensor',sort:{method:'state',numeric:true,first:1,count:1},options:{name:'this.entity_id',tap_action:{entity:'this.entity_id'}}},{type:'section',label:'Tail'}]}};
 assert.deepEqual(clean(api.buschSmartResult(c,config,[],[['sensor.a','sensor.b'],[]])),clean(api.buschSmartResult(c,config)));
});
test('Globale Pagination folgt Wert-Unique, lokale Pagination bleibt davor',()=>{
 const c=fixture();const config={filter:{include:[{device:'d1',sort:{method:'name',first:1,count:2}}]},value:{type:'device_id'},unique_values:true,sort:{first:1,count:1}};
 assert.deepEqual(clean(api.buschSmartResult(c,config)),[]);
});
test('Options-Entity ersetzt im Wertpfad nicht den ursprünglichen Trefferkontext',()=>{
 const c=fixture();const config={filter:{include:[{entity_id:'sensor.a',options:{entity:'sensor.b'}}]},value:{type:'attribute',attribute:'nested:value'}};
 assert.deepEqual(clean(api.buschSmartResult(c,config)),[0]);
 assert.deepEqual(clean(api.buschSmartResult(c,{...config,value:undefined})),[{entity:'sensor.b'}]);
});
test('Differenztest gegen unveränderte auto-entities 1.16.1 Module', {skip:!upstream},async(t)=>{
 const {stripTypeScriptTypes}=require('node:module');const c=fixture();
 class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return now;}}
 const ctx=vm.createContext({window:{},Date:FixedDate,console});
 for(const file of ['helpers','match','filter','sort','process_entity']) {
   let src=fs.readFileSync(path.join(upstream,file+'.ts'),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/^export /gm,'');
   const exports={helpers:['getAreas','getDevices','getEntities','getLabels','getFloors','compare_deep'],match:['matcher'],filter:['get_filter'],sort:['get_sorter'],process_entity:['process_entity']}[file];
   vm.runInContext('Object.assign(globalThis,(()=>{'+stripTypeScriptTypes(src)+';return {'+exports.join(',')+'}})())',ctx);
 }
 const main=fs.readFileSync(path.join(upstream,'main.ts'),'utf8');
 const body=main.slice(main.indexOf('  async update_entities()'),main.indexOf('  async updated('));
 vm.runInContext(stripTypeScriptTypes('globalThis.reference = ({'+body+'}).update_entities'),ctx);
 for(const rule of rules) await t.test('Filter '+JSON.stringify(rule),async()=>{const ref=await ctx.get_filter(c.hass,rule);for(const id of c.index.states.keys()) assert.equal(api.buschSmartFilter(c,rule,id,now),ref(id),JSON.stringify([rule,id]));});
 await t.test('Matcher: Wildcards, Regex, $$, Vergleichsoperatoren, Alter und Typen',async()=>{for(const pattern of ['*','sensor.*','/^sensor\\./','< 10','<= 2','>=2','>2','!= 2','!2','=2','==2','$$/a/','> 20 m ago','<= 1 H ago',null,false,2])for(const value of ['sensor.a','2','x',2,null,undefined,{a:1},'2026-09-21T11:30:00Z'])assert.equal(api.buschSmartMatch(value,pattern,now),(await ctx.matcher(pattern))(value),JSON.stringify([value,pattern]));});
 const configs=[...rules.filter(x=>!Object.keys(x).some(k=>k.startsWith('last_'))).map(rule=>({filter:{include:[rule]}})),...['none','domain','entity_id','friendly_name','name','device','area','state','attribute','last_changed','last_updated','last_triggered','unknown'].flatMap(method=>[false,true].map(reverse=>({entities:['sensor.b'],filter:{include:[{domain:'sensor',options:{name:'this.entity_id'}},{domain:'light'}]},sort:{method,attribute:'ip',reverse,numeric:method==='state'}}))),{entities:['sensor.a','sensor.a',{entity:'sensor.a',name:'different'}],unique:true},{entities:['sensor.a','sensor.a',{entity:'sensor.a',name:'different'}],unique:'entity'},{filter:{include:[{domain:'sensor',options:{name:'${device}',eval_js:true},sort:{method:'state',numeric:true,count:1}},{domain:'sensor'}],exclude:[{state:'10'}]},sort:{method:'entity_id',first:1,count:1}}];
 configs.push(...[{method:'attribute',attribute:'ip',ip:true},{method:'attribute',attribute:'nested:value',numeric:true},{method:'name',ignore_case:true},{method:'name',ignore_case:true,reverse:true},{count:0},{first:1,count:0}].map(sort=>({filter:{include:[{device:'d1'}]},sort})));
 for(const [index,config] of configs.entries()) await t.test('Ergebnis '+index+' '+JSON.stringify(config),async()=>{const original=await ctx.reference.call({_config:config,hass:c.hass,_template:[{entity:'sensor.b',name:'Template'}]});assert.deepEqual(clean(api.buschSmartResult(c,config,[{entity:'sensor.b',name:'Template'}])),clean(original),JSON.stringify(config));});
});
test('Wertausgabe unterstützt Punktpfade, Filter behalten den originalen Doppelpunktvertrag',()=>{const c=fixture();assert.deepEqual(clean(api.buschSmartResult(c,{filter:{include:[{entity_id:'sensor.a'}]},value:{type:'attribute',attribute:'nested.value'}})),[0]);});
