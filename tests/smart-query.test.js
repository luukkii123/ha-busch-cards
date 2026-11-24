'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {ladeKarte}=require('./laden');const {baueHass}=require('./geraet-attrappe');
function setup(extra={}){const api=ladeKarte(['BuschCardsCore'],{performance,setTimeout,clearTimeout,...extra});const c=new api.BuschCardsCore(),h=baueHass();h.formatEntityState=s=>s?.state;c.hass=h;c.seed(h);return {c,h};}
const config={filter:{include:[{domain:'sensor',integration:'shelly',state:'< 20'}]}};
test('smart query shares results, ignores unrelated changes and evaluates one relevant entity',async()=>{const {c,h}=setup();assert.equal(typeof c.smartQuery,'function');const q=c.smartQuery(config);assert.equal(q,c.smartQuery(config));let count=0;const off=c.subscribe(q,()=>count++);const n=q.metrics.evaluated;count=0;c.updateState('light.decke',{...h.states['light.decke'],state:'off'});await Promise.resolve();assert.equal(q.metrics.evaluated,n);assert.equal(count,0);c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'100'});await Promise.resolve();assert.equal(q.metrics.evaluated,n+1);assert.equal(count,1);off();c.dispose();});
test('group membership changes refresh dependent smart queries',async()=>{const {c}=setup();c.updateState('group.demo',{state:'on',attributes:{entity_id:['sensor.decke_leistung']}});await Promise.resolve();const q=c.smartQuery({filter:{include:[{group:'group.demo'}]}});const off=c.subscribe(q,()=>{});assert.equal(q.result.length,1);c.updateState('group.demo',{state:'on',attributes:{entity_id:[]}});await Promise.resolve();assert.equal(q.result.length,0);off();c.dispose();});
test('different value projections never share a final result cache',()=>{const {c}=setup();const a=c.smartQuery({...config,value:{type:'device_id'},unique_values:true}),b=c.smartQuery({...config,value:{type:'attribute',attribute:'friendly_name'}});assert.notEqual(a,b);assert.deepEqual([...a.result],['d1']);assert.ok(b.result.length>1);c.dispose();});
test('leave and reenter preserves original state order before pagination',()=>{const {c,h}=setup();const q=c.smartQuery({filter:{include:[{domain:'sensor',state:'< 20'}]},sort:{count:2}});const off=c.subscribe(q,()=>{});const before=JSON.stringify(q.result);c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'100'});c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'12.4'});assert.equal(JSON.stringify(q.result),before);off();c.dispose();});
test('invalid regex is isolated and does not stop another smart query',async()=>{const {c,h}=setup();const invalid=c.smartQuery({filter:{include:[{entity_id:'/[bad/'}]}});assert.ok(invalid.error);const valid=c.smartQuery(config),off=c.subscribe(valid,()=>{});c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'100'});await Promise.resolve();assert.ok(!valid.result.some(e=>e.entity==='sensor.decke_leistung'));off();c.dispose();});
test('stringification patterns are not mistaken for literal index keys',()=>{const {c}=setup();const q=c.smartQuery({filter:{include:[{domain:'$$"sensor"'}]}});assert.ok(q.result.length>0);c.dispose();});
test('different target cards share the same declarative computation',()=>{const {c}=setup();assert.equal(c.smartQuery({...config,card:{type:'entities'}}),c.smartQuery({...config,card:{type:'glance'},debug:true}));c.dispose();});
test('template subscribers share a backend subscription and preserve errors until recovery',async()=>{
 const {c,h}=setup();let receive,calls=0,stopped=0;h.connection={subscribeMessage:async cb=>{calls++;receive=cb;return ()=>stopped++;}};
 const q=c.smartQuery({filter:{template:'{{ states.sensor | list }}'}});const off1=c.subscribe(q,()=>{}),off2=c.subscribe(q,()=>{});await Promise.resolve();await Promise.resolve();assert.equal(calls,1);
 receive({result:['sensor.decke_leistung']});await Promise.resolve();assert.equal(q.result.length,1);
 receive({error:'bad'});c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'9'});assert.ok(q.error);
 receive({result:[]});await Promise.resolve();assert.equal(q.error,null);assert.equal(q.result.length,0);off1();assert.equal(stopped,0);off2();assert.equal(stopped,1);c.dispose();
});
test('synchronous template transport failures become visible query errors',async()=>{const {c,h}=setup();h.connection={subscribeMessage(){throw Error('offline');}};const q=c.smartQuery({filter:{template:'{{ states }}'}});const off=c.subscribe(q,()=>{});for(let i=0;i<8;i++)await Promise.resolve();assert.ok(q.error);off();c.dispose();});
test('numeric timestamp attributes schedule their next age boundary',()=>{const {c}=setup();c.updateState('sensor.time',{entity_id:'sensor.time',state:'on',attributes:{timestamp:Date.now()}});const q=c.smartQuery({filter:{include:[{entity_id:'sensor.time',attributes:{timestamp:'< 1 m ago'}}]}});assert.equal(q.result.length,1);assert.ok(Number.isFinite(q.nextDeadline));c.dispose();});
test('locale format changes invalidate translated state comparisons',()=>{const {c,h}=setup();h.formatEntityState=()=>h.locale.number_format||'before';c.attach(h);const q=c.smartQuery({filter:{include:[{state:'after'}]}});const off=c.subscribe(q,()=>{});assert.equal(q.result.length,0);h.locale={...h.locale,number_format:'after'};c.attach(h);assert.ok(q.result.length>0);off();c.dispose();});
test('shared object values cannot mutate HA state attributes',()=>{const {c}=setup();const object={nested:1};c.updateState('sensor.object',{entity_id:'sensor.object',state:'1',attributes:{object}});const q=c.smartQuery({filter:{include:[{entity_id:'sensor.object'}]},value:{type:'attribute',attribute:'object'}});assert.throws(()=>q.result[0].nested=2);assert.equal(object.nested,1);assert.equal(Object.isFrozen(object),false);c.dispose();});
test('M4: one microtask burst notifies a smart query subscriber once',async()=>{const {c,h}=setup();const q=c.smartQuery(config);let count=0;const off=c.subscribe(q,()=>count++);count=0;c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'100'});c.updateState('sensor.decke_energie',{...h.states['sensor.decke_energie'],state:'100'});c.updateState('light.decke',{...h.states['light.decke'],state:'off'});await Promise.resolve();assert.equal(count,1);assert.ok(!q.result.some(row=>['sensor.decke_leistung','sensor.decke_energie'].includes(row.entity)));off();c.dispose();});
function fakeTimers(){const timers=[];return {timers,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:id=>{if(timers[id-1])timers[id-1].fn=null;},due:ms=>timers.filter(t=>t.fn&&t.ms===ms),fire(ms){const t=timers.find(t=>t.fn&&t.ms===ms);assert.ok(t,'retry planned after '+ms+' ms');const fn=t.fn;t.fn=null;fn();}};}
const ticks=async(n=8)=>{for(let i=0;i<n;i++)await Promise.resolve();};
test('M38: first template subscription rejected, second succeeds and shows rows without rebuilding the card',async()=>{
 const t=fakeTimers(),{c,h}=setup({setTimeout:t.setTimeout,clearTimeout:t.clearTimeout});let calls=0,receive;
 h.connection={subscribeMessage:async cb=>{calls++;if(calls===1)throw Object.assign(new Error('Connection lost'),{code:3});receive=cb;return ()=>{};}};
 const spec={filter:{template:'{{ states.sensor | list }}'}},q=c.smartQuery(spec),seen=[];const off=c.subscribe(q,rows=>seen.push(rows.length));
 await ticks();assert.equal(calls,1);assert.ok(q.error);assert.equal(q.templateActive,false);
 t.fire(2000);await ticks();assert.equal(calls,2);
 receive({result:['sensor.decke_leistung']});await ticks();
 assert.equal(q.error,null);assert.equal(q.result.length,1);assert.equal(seen.at(-1),1);assert.equal(c.smartQuery(spec),q);
 off();c.dispose();
});
test('M38: rejected subscriptions back off 2 s, 10 s, 60 s and a core ready retries at once',async()=>{
 const t=fakeTimers(),{c,h}=setup({setTimeout:t.setTimeout,clearTimeout:t.clearTimeout});let calls=0,ready;
 h.connection={subscribeEvents:async()=>()=>{},addEventListener:(type,fn)=>{if(type==='ready')ready=fn;},removeEventListener(){},subscribeMessage:async(cb,message)=>{if(message.type!=='render_template')return ()=>{};calls++;throw {code:3,message:'Connection lost'};}};
 h.callWS=async m=>m.type==='get_states'?Object.values(h.states):[];c.attach(h);await c.ready;
 const q=c.smartQuery({filter:{template:'{{ states.light | list }}'}}),off=c.subscribe(q,()=>{});
 await ticks();assert.equal(calls,1);
 for(const [ms,n] of [[2000,2],[10000,3],[60000,4],[60000,5]]){t.fire(ms);await ticks();assert.equal(calls,n);}
 assert.equal(t.due(60000).length,1);ready();await ticks();assert.equal(calls,6,'ready retries without waiting');
 off();assert.equal(t.timers.filter(x=>x.fn&&[2000,10000,60000].includes(x.ms)).length,0,'stop clears the retry');c.dispose();
});
test('M38: real template errors are not retried until the configuration changes',async()=>{
 const t=fakeTimers(),{c,h}=setup({setTimeout:t.setTimeout,clearTimeout:t.clearTimeout});let calls=0,receive;
 h.connection={subscribeMessage:async cb=>{calls++;if(calls===1)throw {code:'template_error',message:'UndefinedError'};receive=cb;return ()=>{};}};
 const q=c.smartQuery({filter:{template:'{{ states.sensor | list }}'}}),off=c.subscribe(q,()=>{});await ticks();
 assert.equal(calls,1);assert.ok(q.error);assert.equal(t.due(2000).length,0);
 c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'3'});await ticks();assert.equal(calls,1);
 off();const again=c.smartQuery({filter:{template:'{{ states.sensor | list }}'}}),off2=c.subscribe(again,()=>{});await ticks();assert.equal(calls,2);
 receive({error:'bad',level:'ERROR'});await ticks();c.updateState('sensor.decke_leistung',{...h.states['sensor.decke_leistung'],state:'4'});await ticks();
 assert.ok(again.error);assert.equal(calls,2);assert.equal(t.due(2000).length,0);off2();c.dispose();
});
test('M50 change of a non-member inside the guard skips the projection, members and static rows still project',async()=>{const {c,h}=setup();const q=c.smartQuery(config);let count=0;const off=c.subscribe(q,()=>count++);count=0;const set=(id,patch)=>{c.updateState(id,{...c.index.states.get(id),...patch});};
 set('sensor.decke_leistung',{state:'30'});await Promise.resolve();assert.ok(!q.result.some(r=>r.entity==='sensor.decke_leistung'),'member leaves');assert.equal(count,1);
 const skipped=q.metrics.projectionsSkipped??0,result=q.result,evaluated=q.metrics.evaluated;
 set('sensor.decke_leistung',{state:'31'});await Promise.resolve();assert.equal(q.metrics.evaluated,evaluated+1,'membership still evaluated');assert.equal(q.metrics.projectionsSkipped,skipped+1,'no projection for a non-member before and after');assert.equal(q.result,result);assert.equal(count,1);
 const timed=q.timed;assert.ok(Array.isArray(timed),'M50: timed plans are built once per query, not per event');
 set('sensor.decke_leistung',{state:'5'});await Promise.resolve();assert.ok(q.result.some(r=>r.entity==='sensor.decke_leistung'),'entry projects');assert.equal(q.metrics.projectionsSkipped,skipped+1);assert.equal(count,2);assert.equal(q.timed,timed,'same cached plan list');off();
 const s=c.smartQuery({entities:['sensor.decke_leistung'],filter:{include:[{domain:'sensor',integration:'shelly',state:'> 1000'}]},value:{type:'attribute',attribute:'friendly_name'}});const off2=c.subscribe(s,()=>{});assert.deepEqual([...s.result],['Wohnzimmer Deckenlampe Leistung']);
 set('sensor.decke_leistung',{attributes:{...c.index.states.get('sensor.decke_leistung').attributes,friendly_name:'Neu'}});await Promise.resolve();assert.deepEqual([...s.result],['Neu'],'static row is projected although it never matches');off2();c.dispose();});
test('M50 buschSmartMatch compiles each pattern once and bounds its cache',()=>{const api=ladeKarte(['buschSmartMatch','BUSCH_SMART_REGEX']);const cache=api.BUSCH_SMART_REGEX;cache.clear();
 assert.equal(api.buschSmartMatch('sensorXa','sensor.*'),true);const first=cache.get('^sensor..*$');assert.ok(first);assert.equal(api.buschSmartMatch('lightXa','sensor.*'),false);assert.equal(cache.get('^sensor..*$'),first);assert.equal(cache.size,1);
 assert.equal(api.buschSmartMatch('abc','/b/'),true);assert.equal(cache.size,2);for(let i=0;i<600;i++)api.buschSmartMatch('x','/x'+i+'/');assert.ok(cache.size<=256,`cache size ${cache.size}`);assert.throws(()=>api.buschSmartMatch('x','/(/'));});
