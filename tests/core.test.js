'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ladeKarte}=require('./laden');
const {baueHass}=require('./geraet-attrappe');
const kit=require('./_testkit.cjs');
function load(extra={}) {return ladeKarte(['ensureBuschCore','BuschCardsCore','BuschRegistryCache','BuschEntityIndex'],{setTimeout,clearTimeout,queueMicrotask,performance,...extra});}
function fresh(){const {BuschCardsCore}=load();return new BuschCardsCore();}
// M10: server side of subscribe_entities for the kit hass (compressed format of home-assistant-js-websocket).
const plain=value=>JSON.parse(JSON.stringify(value));
const seconds=iso=>Date.parse(iso)/1000;
const compressed=state=>({s:state.state,a:state.attributes,c:state.context?.id,lc:seconds(state.last_changed),...(state.last_updated!==state.last_changed?{lu:seconds(state.last_updated)}:{})});
function entityStream(ha){
 const push=message=>ha.pushMessage('subscribe_entities',message);
 return {push,full:()=>push({a:Object.fromEntries(Object.entries(ha.server.states).map(([id,state])=>[id,compressed(state)]))}),
  change(id,patch){const hass=ha.patchState(id,patch),state=ha.server.states[id];push({c:{[id]:{'+':{s:state.state,...(patch.attributes?{a:patch.attributes}:{}),c:state.context.id}}}});return hass;}};
}
function world(){const clock=kit.createClock();return kit.createHass({clock,states:{'sensor.a':{state:'1',attributes:{friendly_name:'A'}},'sensor.b':{state:'1'}},entities:{'sensor.a':{entity_id:'sensor.a',platform:'demo'},'sensor.b':{entity_id:'sensor.b',platform:'demo'}}});}
async function streamed(){const c=fresh(),ha=world(),stream=entityStream(ha);c.retain(ha.hass);ha.onUpdate(hass=>c.attach(hass));await c.ready;await kit.flush();stream.full();return {c,ha,stream};}

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
test('M10: attach takes states from hass.states and never asks for a snapshot',async()=>{
 const c=fresh(),h=baueHass();h.connection={subscribeEvents:async()=>()=>{}};
 const original=h.callWS.bind(h);h.callWS=async msg=>{if(msg.type==='get_states')throw Error('no snapshot expected');return original(msg);};
 c.attach(h);await c.ready;await new Promise(r=>setImmediate(r));assert.equal(c.getEntity('light.decke').state,'on');assert.equal(c.lastErrors.size,0);
 h.states={...h.states,'light.decke':{...h.states['light.decke'],state:'off'}};c.attach({...h});assert.equal(c.getEntity('light.decke').state,'off','next hass is synced at once');c.dispose();
});
test('a fresh full hass.states recalculates a global smart query at most once and retains real state changes',async()=>{
 const c=fresh(),states=Object.fromEntries(Array.from({length:100},(_,i)=>{
  const entity_id=`sensor.synthetic_${i}`;
  return [entity_id,{entity_id,state:i===0?'unavailable':'on',attributes:{friendly_name:`Synthetic ${i}`}}];
 }));
 const connection={},h={states,entities:{},devices:{},areas:{},floors:{},connection,formatEntityState:state=>state.state};
 c.attach(h);
 const q=c.smartQuery({filter:{include:[{state:'unavailable'}]}}),off=c.subscribe(q,()=>{});
 const ids=()=>[...q.result].map(row=>row.entity);
 assert.deepEqual(ids(),['sensor.synthetic_0']);
 // Every state object is new (as after a reconnect), but only sensor.synthetic_1 really changes.
 const copy=fn=>Object.fromEntries(Object.values(states).map(state=>[state.entity_id,fn({...state,attributes:{...state.attributes}})]));
 let before=q.metrics.calculations;
 c.attach({...h,states:copy(state=>state)});await Promise.resolve();
 assert.ok(q.metrics.calculations-before<=1,`unchanged full states recalculated ${q.metrics.calculations-before} times`);
 assert.deepEqual(ids(),['sensor.synthetic_0']);
 before=q.metrics.calculations;
 c.attach({...h,states:copy(state=>state.entity_id==='sensor.synthetic_1'?{...state,state:'unavailable'}:state)});await Promise.resolve();
 assert.ok(q.metrics.calculations-before<=1,`changed full states recalculated ${q.metrics.calculations-before} times`);
 assert.deepEqual(ids(),['sensor.synthetic_0','sensor.synthetic_1']);
 off();c.dispose();
});
test('a one-state snapshot keeps global smart queries incremental',async()=>{
 const c=fresh(),states=Object.fromEntries(Array.from({length:100},(_,i)=>{
  const entity_id=`sensor.delta_${i}`;
  return [entity_id,{entity_id,state:i===0?'unavailable':'on',attributes:{}}];
 }));
 const h={states,entities:{},devices:{},areas:{},floors:{},formatEntityState:state=>state.state};
 c.hass=h;c.seed(h);
 const q=c.smartQuery({filter:{include:[{state:'unavailable'}]}}),off=c.subscribe(q,()=>{});
 const next={...states,'sensor.delta_1':{...states['sensor.delta_1'],state:'unavailable'}};
 const before=q.metrics.evaluated;
 c.syncStates(next);await Promise.resolve();
 assert.equal(q.metrics.evaluated-before,1);
 assert.deepEqual([...q.result].map(row=>row.entity),['sensor.delta_0','sensor.delta_1']);
 off();c.dispose();
});
test('registry changes notify every attached consumer and failures stay inspectable',async()=>{
 const c=fresh(),h=baueHass();c.attach(h);await c.ready;let count=0;const unwatch=c.watch(()=>count++);
 h.devices={...h.devices,d1:{...h.devices.d1,name_by_user:'Renamed'}};await c.refreshRegistries(['device']);await Promise.resolve();assert.equal(c.getDevice('d1').name_by_user,'Renamed');assert.equal(count,1);unwatch();c.dispose();
});
test('registry subscriptions are cleaned up and a ready event reloads registries, states follow the next hass',async()=>{
 const c=fresh(),h=baueHass();let unsubscribed=0;const events={},types=[];h.connection={subscribeEvents:async(fn,type)=>{types.push(type);return ()=>unsubscribed++;},addEventListener:(n,fn)=>events[n]=fn,removeEventListener:(n)=>delete events[n]};
 const original=h.callWS.bind(h);h.callWS=async msg=>{if(msg.type==='get_states')throw Error('no snapshot expected');return original(msg);};
 c.attach(h);await c.ready;await new Promise(r=>setImmediate(r));assert.equal(typeof events.ready,'function');assert.ok(!types.includes('state_changed'));
 const lists=h.aufrufe.length;await events.ready();assert.equal(h.aufrufe.length-lists,5,'ready reloads the five registries');
 c.attach({...h,states:{...h.states,'light.decke':{...h.states['light.decke'],state:'off'}}});assert.equal(c.getEntity('light.decke').state,'off');
 c.dispose();assert.equal(unsubscribed,5);assert.equal(events.ready,undefined);
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
test('M10: without an entity stream hass.states is the source, also across a reconnect',async()=>{
 const c=fresh(),ha=kit.createHass({states:{'sensor.a':{state:'1'},'sensor.b':{state:'1'}},entities:{'sensor.a':{entity_id:'sensor.a',platform:'demo'},'sensor.b':{entity_id:'sensor.b',platform:'demo'}}});
 c.attach(ha.hass);await c.ready;
 // While the socket is down the frontend sends no hass; after ready it resubscribes and hands over the full state.
 ha.disconnect();ha.patchState('sensor.a',{state:'offline-change'});assert.equal(c.getEntity('sensor.a').state,'1');
 ha.reconnect();await kit.flush();c.attach(ha.hass);ha.onUpdate(hass=>c.attach(hass));
 assert.equal(c.getEntity('sensor.a').state,'offline-change');ha.patchState('sensor.b',{state:'2'});assert.equal(c.getEntity('sensor.b').state,'2');
 assert.equal(c.synced(ha.hass),true);assert.equal(c.synced({...ha.hass,states:{...ha.hass.states}}),false);c.dispose();
});
test('a new connection cannot inherit labels when its registry is denied',async()=>{const c=fresh(),a=baueHass();c.attach(a);await c.ready;assert.equal(c.labels.size,2);const b=baueHass(),original=b.callWS.bind(b);b.callWS=msg=>msg.type==='config/label_registry/list'?Promise.reject(Error('denied')):original(msg);c.attach(b);await c.ready;assert.equal(c.labels.size,0);assert.ok(c.lastErrors.has('label'));c.dispose();});
test('reconnect replaces an in-flight registry load and rejects its late answer',async()=>{
 const c=fresh(),h=baueHass(),events={},pending=[];h.connection={subscribeEvents:async()=>()=>{},addEventListener:(n,fn)=>events[n]=fn,removeEventListener:()=>{}};
 const original=h.callWS.bind(h);h.callWS=msg=>msg.type==='config/entity_registry/list'?new Promise(r=>pending.push(r)):original(msg);
 c.attach(h);const old=c.ready;for(let i=0;i<15;i++)await Promise.resolve();assert.equal(pending.length,1);
 const current=events.ready();for(let i=0;i<15;i++)await Promise.resolve();assert.equal(pending.length,2);
 pending[1]([{entity_id:'light.decke',device_id:'d2',platform:'new'}]);await current;
 pending[0]([{entity_id:'light.decke',device_id:'d1',platform:'old'}]);await old;await Promise.resolve();assert.equal(c.getEntity('light.decke').platform,'new');c.dispose();
});
test('device watchers batch relevant stream updates and ignore unrelated devices',async()=>{const c=fresh(),h=baueHass();c.seed(h);let calls=0;const off=c.watchDevice('d1',()=>calls++);c.updateState('sensor.anderes',{...h.states['sensor.anderes'],state:'9'});await Promise.resolve();assert.equal(calls,0);c.updateState('light.decke',{...h.states['light.decke'],state:'off'});c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'8'});await Promise.resolve();assert.equal(calls,1);off();c.updateState('light.decke',h.states['light.decke']);await Promise.resolve();assert.equal(calls,1);c.dispose();});
test('M4: changes within one microtask reach each query once as a bundle, no ID is lost',async()=>{
 const c=fresh(),states={},entities={};for(let i=0;i<10;i++){const id='sensor.n_'+i;states[id]={entity_id:id,state:'5',attributes:{}};entities[id]={entity_id:id,platform:'mqtt'};}
 c.seed({states,entities,devices:{},areas:{}});const q=c.query({filter:{include:[{domain:'sensor',state:'< 10'}]}});let calls=0,last;const off=c.subscribe(q,rows=>{calls++;last=rows;});calls=0;
 const before=q.metrics.calculations;
 for(let i=0;i<10;i++)c.updateState('sensor.n_'+i,{...states['sensor.n_'+i],state:i%2?'50':'5'});
 c.updateState('sensor.n_0',{...states['sensor.n_0'],state:'50'});c.updateState('sensor.n_0',{...states['sensor.n_0'],state:'5'});
 assert.equal(q.metrics.calculations,before,'nothing is recalculated synchronously');
 await Promise.resolve();
 assert.equal(q.metrics.calculations,before+1);assert.equal(calls,1);
 assert.deepEqual([...last],['sensor.n_0','sensor.n_2','sensor.n_4','sensor.n_6','sensor.n_8']);
 c.updateState('sensor.n_1',{...states['sensor.n_1'],state:'1'});await Promise.resolve();assert.equal(calls,2);assert.ok(last.includes('sensor.n_1'));
 off();c.dispose();
});
test('M10: building and reconnecting send neither get_states nor subscribe_events state_changed, exactly one subscribe_entities',async()=>{
 const {c,ha,stream}=await streamed();
 const counts=()=>({get_states:ha.count('get_states'),state_changed:ha.count('subscribe_events:state_changed'),subscribe_entities:ha.count('subscribe_entities'),subscribe_events:ha.count('subscribe_events'),registry_list:ha.countMatching(/^config\/\w+_registry\/list$/)});
 assert.deepEqual(counts(),{get_states:0,state_changed:0,subscribe_entities:1,subscribe_events:5,registry_list:5},'build');
 ha.resetStats();ha.reconnect();await kit.flush();stream.full();
 assert.deepEqual(counts(),{get_states:0,state_changed:0,subscribe_entities:0,subscribe_events:0,registry_list:5},'reconnect (the socket library resubscribes)');
 stream.change('sensor.a',{state:'2'});assert.equal(c.getEntity('sensor.a').state,'2');c.dispose();
});
test('M10: after a reconnect the stream alone brings correct values, removed entities go, no snapshot request',async()=>{
 const {c,ha,stream}=await streamed();
 ha.disconnect();
 ha.server.states['sensor.a']={...ha.server.states['sensor.a'],state:'offline',last_changed:'2027-01-15T08:00:01.000Z',last_updated:'2027-01-15T08:00:01.000Z',context:{id:'ctx-offline'}};
 delete ha.server.states['sensor.b'];ha.server.states['sensor.c']={entity_id:'sensor.c',state:'new',attributes:{},last_changed:'2027-01-15T08:00:02.000Z',last_updated:'2027-01-15T08:00:02.000Z',context:{id:'ctx-c'}};
 // The frontend's hass may lag behind during the reconnect: it must not become a second source.
 c.attach({...ha.hass,states:{...ha.hass.states,'sensor.a':{...ha.hass.states['sensor.a'],state:'stale'}}});assert.equal(c.getEntity('sensor.a').state,'1');
 ha.resetStats();ha.reconnect();await kit.flush();stream.full();await Promise.resolve();
 assert.equal(c.getEntity('sensor.a').state,'offline');assert.equal(c.getEntity('sensor.b').stateObject,undefined);assert.equal(c.getEntity('sensor.c').state,'new');
 assert.equal(ha.count('get_states'),0);assert.equal(ha.count('subscribe_events:state_changed'),0);c.dispose();
});
test('M10: stream messages are decoded like the frontend does (state, attributes +/-, context, times)',async()=>{
 const {c,stream}=await streamed();
 stream.push({c:{'sensor.a':{'+':{s:'7',a:{unit:'W',extra:1},c:'ctx-7',lc:1800000100}}}});
 let a=c.getEntity('sensor.a').stateObject;assert.equal(a.state,'7');assert.deepEqual(plain(a.attributes),{friendly_name:'A',unit:'W',extra:1});assert.equal(a.context.id,'ctx-7');assert.equal(a.last_changed,'2027-01-15T08:01:40.000Z');assert.equal(a.last_updated,a.last_changed);
 stream.push({c:{'sensor.a':{'+':{lu:1800000200},'-':{a:['extra']}}}});
 a=c.getEntity('sensor.a').stateObject;assert.equal(a.state,'7');assert.deepEqual(plain(a.attributes),{friendly_name:'A',unit:'W'});assert.equal(a.last_changed,'2027-01-15T08:01:40.000Z');assert.equal(a.last_updated,'2027-01-15T08:03:20.000Z');
 stream.push({a:{'sensor.n':{s:'on',a:{},c:{id:'ctx-n',parent_id:null,user_id:'u'},lc:1800000300}},r:['sensor.b'],c:{'sensor.unknown':{'+':{s:'x'}}}});
 assert.equal(c.getEntity('sensor.n').state,'on');assert.equal(c.getEntity('sensor.n').stateObject.context.user_id,'u');assert.equal(c.getEntity('sensor.b').stateObject,undefined);assert.equal(c.getEntity('sensor.unknown'),undefined);
 c.dispose();
});
test('M10: with the stream, hass.states is ignored; a full message keeps equal state objects (no second copy)',async()=>{
 const {c,ha,stream}=await streamed();
 assert.equal(c.streaming,true);assert.equal(c.index.states.get('sensor.a'),ha.hass.states['sensor.a'],'equal state keeps the frontend object');
 c.attach({...ha.hass,states:{...ha.hass.states,'sensor.a':{...ha.hass.states['sensor.a'],state:'other'}}});assert.equal(c.getEntity('sensor.a').state,'1');
 assert.equal(c.synced(c.hass),true,'stream keeps the index current');c.dispose();
});
test('M10: stream changes reach the queries bundled per microtask through changed, track/unchanged stay fed',async()=>{
 const {c,stream}=await streamed();
 const q=c.query({filter:{include:[{domain:'sensor',state:'< 10'}]}});let calls=0;const off=c.subscribe(q,()=>calls++);calls=0;
 let refreshed=0;const refresh=c.engine.refresh.bind(c.engine);c.engine.refresh=()=>{refreshed++;refresh();};
 const deps=c.track(()=>c.getEntity('sensor.b')),before=q.metrics.evaluated,calculations=q.metrics.calculations;
 stream.push({c:{'sensor.a':{'+':{s:'50'}}}});stream.push({c:{'sensor.b':{'+':{s:'60'}}}});
 assert.ok(!c.unchanged(deps),'own entity changed');assert.equal(q.metrics.calculations,calculations);
 await Promise.resolve();
 assert.equal(refreshed,0);assert.equal(q.metrics.calculations,calculations+1);assert.equal(q.metrics.evaluated-before,2);assert.equal(calls,1);assert.equal(q.result.length,0);
 off();c.dispose();
});
test('M10: a rejected subscribe_entities leaves hass.states as the source and is tried again at ready',async()=>{
 const c=fresh(),ha=world();ha.behaveOnce('subscribe_entities',{reject:Object.assign(Error('Connection lost'),{code:3})});
 c.attach(ha.hass);await c.ready;await kit.flush();ha.onUpdate(hass=>c.attach(hass));
 assert.equal(c.streaming,false);assert.ok(c.lastErrors.has('states'));
 ha.patchState('sensor.a',{state:'5'});assert.equal(c.getEntity('sensor.a').state,'5','fallback follows hass.states');
 ha.reconnect();await kit.flush();assert.equal(ha.count('subscribe_entities'),2);entityStream(ha).full();
 assert.equal(c.streaming,true);assert.ok(!c.lastErrors.has('states'));assert.equal(c.getEntity('sensor.a').state,'5');c.dispose();
});
test('M10: several changes of one hass reach the queries as one bundle through changed, not a full refresh',async()=>{
 const c=fresh(),states={},entities={};for(let i=0;i<50;i++){const id='sensor.m_'+i;states[id]={entity_id:id,state:'5',attributes:{}};entities[id]={entity_id:id,platform:'mqtt'};}
 const h={states,entities,devices:{},areas:{},floors:{},connection:{}};c.attach(h);
 const q=c.query({filter:{include:[{domain:'sensor',state:'< 10'}]}});let calls=0;const off=c.subscribe(q,()=>calls++);calls=0;
 let refreshed=0;const refresh=c.engine.refresh.bind(c.engine);c.engine.refresh=()=>{refreshed++;refresh();};
 const before=q.metrics.evaluated,calculations=q.metrics.calculations;
 c.attach({...h,states:{...states,'sensor.m_1':{...states['sensor.m_1'],state:'50'},'sensor.m_2':{...states['sensor.m_2'],state:'60'},'sensor.m_3':{...states['sensor.m_3'],state:'7'}}});
 assert.equal(q.metrics.calculations,calculations,'nothing is recalculated synchronously');
 await Promise.resolve();
 assert.equal(refreshed,0,'no full refresh');assert.equal(q.metrics.calculations,calculations+1);assert.equal(q.metrics.evaluated-before,3,'only the three changed entities are evaluated');
 assert.equal(calls,1);assert.equal(q.result.length,48);
 const removed={...c.hass.states};delete removed['sensor.m_4'];c.attach({...h,states:removed});await Promise.resolve();assert.equal(c.getEntity('sensor.m_4').stateObject,undefined);assert.equal(q.result.length,47);
 off();c.dispose();
});
test('M10: track/unchanged stay fed by hass.states',()=>{
 const c=fresh(),h=baueHass();c.attach(h);
 const deps=c.track(()=>c.getDeviceEntities('d1'));
 c.attach({...h,states:{...h.states,'sensor.anderes':{...h.states['sensor.anderes'],state:'9'}}});assert.ok(c.unchanged(deps),'foreign device');
 c.attach({...c.hass,states:{...c.hass.states,'sensor.decke_leistung':{...h.states['sensor.decke_leistung'],state:'1'}}});assert.ok(!c.unchanged(deps),'own device');c.dispose();
});
