'use strict';
const {ladeKarte}=require('./laden'),{performance}=require('node:perf_hooks'),fs=require('node:fs'),assert=require('node:assert/strict');
const {BuschCardsCore}=ladeKarte(['BuschCardsCore'],{performance,setTimeout,clearTimeout});const rows=[];
function measure(n,count,distinct){
 const states={},entities={};for(let i=0;i<n;i++){const entity_id=(i%5===0?'light':'sensor')+'.fixture_'+i;states[entity_id]={entity_id,state:String(i%100),attributes:{friendly_name:'Fixture '+i,device_class:i%7===0?'battery':'temperature'}};entities[entity_id]={entity_id,platform:'mqtt',device_id:'device_fixture',config_entry_id:'entry_fixture',labels:[]};}
 const h={states,entities,devices:{device_fixture:{id:'device_fixture',labels:[]}},areas:{},formatEntityState:s=>s.state};
 global.gc?.();const heapBefore=process.memoryUsage().heapUsed;let start=performance.now();const c=new BuschCardsCore();c.hass=h;c.seed(h);const indexMs=performance.now()-start;
 start=performance.now();const qs=Array.from({length:count},(_,i)=>c.smartQuery({filter:{include:[{integration:'mqtt',domain:'sensor',attributes:{device_class:'battery'},state:'< '+(distinct?20+i:20)}]}}));const offs=qs.map(q=>c.subscribe(q,()=>{})),initialMs=performance.now()-start;
 const unique=[...new Set(qs)],before=unique.reduce((n,q)=>n+q.metrics.calculations,0),samples=[];
 for(let i=0;i<21;i++){start=performance.now();c.updateState('light.fixture_0',{...states['light.fixture_0'],state:String(i+100)});c.engine.flush?.();samples.push(performance.now()-start);}
 const unrelatedRecalculations=unique.reduce((n,q)=>n+q.metrics.calculations,0)-before;assert.equal(unrelatedRecalculations,0);
 // M50/P11: a sensor inside the plan guard that is no match before and after (temperature, not battery).
 const nonMember=[],nonMemberExec=[],resultsBefore=unique.map(q=>q.result);for(let i=0;i<201;i++){start=performance.now();c.updateState('sensor.fixture_1',{...states['sensor.fixture_1'],state:String(i%2?30:31)});c.engine.flush?.();nonMember.push(performance.now()-start);nonMemberExec.push(unique.reduce((ms,q)=>ms+q.metrics.executionMs,0));}
 assert.ok(unique.every((q,i)=>q.result===resultsBefore[i]),'non-member change keeps every result');nonMember.sort((a,b)=>a-b);nonMemberExec.sort((a,b)=>a-b);
 const evaluation=unique.reduce((n,q)=>n+q.metrics.evaluated,0);start=performance.now();c.updateState('sensor.fixture_7',{...states['sensor.fixture_7'],state:'99'});c.engine.flush?.();const relevantMs=performance.now()-start,relevantEvaluations=unique.reduce((n,q)=>n+q.metrics.evaluated,0)-evaluation;assert.equal(relevantEvaluations,unique.length);
 global.gc?.();samples.sort((a,b)=>a-b);rows.push({entities:n,cards:count,queries:unique.length,indexMs,initialMs,unrelatedMedianMs:samples[10],unrelatedP95Ms:samples[19],unrelatedRecalculations,relevantMs,relevantEvaluations,nonMemberMedianMs:nonMember[100],nonMemberP95Ms:nonMember[190],nonMemberSmartP95Ms:nonMemberExec[190],heapDeltaBytes:process.memoryUsage().heapUsed-heapBefore});offs.forEach(off=>off());c.dispose();
}
for(const n of [500,1000,2500])for(const count of [1,10,25,75])for(const distinct of [false,true]){global.gc?.();measure(n,count,distinct);}
const report={node:process.version,scope:'Smart declarative pipeline, same synthetic distribution/config as upstream baseline. Heap is Node retained delta, not browser heap; no DOM timing. 21 unrelated changes/case, 201 non-member changes inside the plan guard/case (M50); initialization single sample.',rows};fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.table(rows.filter(r=>r.entities===2500&&r.cards===25));
console.log('nonMemberSmartP95Ms (Smart compute only) shared query max',Math.max(...rows.filter(r=>r.queries===1).map(r=>r.nonMemberSmartP95Ms)).toFixed(4),'| per query over distinct rows max',Math.max(...rows.map(r=>r.nonMemberSmartP95Ms/r.queries)).toFixed(4));
console.log('nonMemberP95Ms max over all rows',Math.max(...rows.map(r=>r.nonMemberP95Ms)).toFixed(4),'| shared query (distinct=false) max',Math.max(...rows.filter(r=>r.queries===1).map(r=>r.nonMemberP95Ms)).toFixed(4));
