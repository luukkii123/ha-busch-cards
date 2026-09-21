'use strict';
const {ladeKarte}=require('./laden');const {performance}=require('node:perf_hooks');const fs=require('node:fs');
const {BuschCardsCore}=ladeKarte(['BuschCardsCore'],{performance,setTimeout,clearTimeout});
const result=[];
for(const size of [500,1000,2500,4705])for(const count of [1,10,25,75])for(const distinct of [false,true]){
 const states={},entities={};for(let i=0;i<size;i++){const id=(i%5===0?'light':'sensor')+'.fixture_'+i;states[id]={entity_id:id,state:String(i%100),attributes:{device_class:i%7===0?'battery':'temperature'}};entities[id]={entity_id:id,device_id:'device',platform:'mqtt'};}
 const core=new BuschCardsCore();const start=performance.now();core.seed({states,entities,devices:{device:{id:'device'}},areas:{}});const indexMs=performance.now()-start;
 let initial=performance.now();const queries=Array.from({length:count},(_,i)=>core.query({filter:{include:[{domain:'sensor',integration:'mqtt',attributes:{device_class:'battery'},state:'< '+(distinct?20+i:20)}]}}));const initialQueryMs=performance.now()-initial;
 const offs=queries.map(q=>core.subscribe(q,()=>{}));const unique=[...new Set(queries)];const before=core.metrics.queriesRecalculated;const samples=[];
 for(let i=0;i<101;i++){initial=performance.now();core.updateState('light.fixture_0',{...states['light.fixture_0'],state:String(i)});samples.push(performance.now()-initial);}
 samples.sort((a,b)=>a-b);const unrelatedRecalculations=core.metrics.queriesRecalculated-before;
 const prev=unique.map(q=>q.metrics.evaluated);core.updateState('sensor.fixture_7',{...states['sensor.fixture_7'],state:'99'});
 result.push({entities:size,cards:count,distinctQueries:unique.length,indexMs:+indexMs.toFixed(3),initialQueryMs:+initialQueryMs.toFixed(3),unrelatedUpdateMedianMs:+samples[50].toFixed(4),unrelatedUpdateP95Ms:+samples[95].toFixed(4),unrelatedRecalculations,relevantEvaluations:unique.reduce((sum,q,i)=>sum+q.metrics.evaluated-prev[i],0)});
 offs.forEach(off=>off());core.dispose();
}
const report={node:process.version,scope:'Core-only groundwork, not Smart Entities or DOM/heap. 101 unrelated updates per case. Same fixture distribution as upstream baseline; pipeline semantics are not yet equivalent.',result};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.table(result.filter(r=>r.entities===2500&&r.cards===25));
if(result.some(r=>r.unrelatedRecalculations!==0||r.relevantEvaluations!==r.distinctQueries))process.exitCode=1;
