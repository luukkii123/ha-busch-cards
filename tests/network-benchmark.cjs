'use strict';
// M4: network query cost per device_tracker update at 400 FRITZ trackers (target p95 <= 0.2 ms single, <= 20 ms per 100-burst).
// Each sample is updateState(s) plus engine.flush, so the bundled evaluation is included; older cores without flush run it synchronously.
const {load}=require('./network-fixture');const {performance}=require('node:perf_hooks');const fs=require('node:fs');
const l=load({performance});const core=new l.BuschCardsCore(),TRACKERS=400,devices={router:{id:'router',name:'Router',identifiers:[['fritz','box-key']],config_entries:['entry']}},entities={},states={};
const stamp=minute=>new Date(Date.UTC(2026,8,29,12,0,0)+minute*60000).toISOString();
const add=(id,device,unique_id,state,attributes={})=>{entities[id]={entity_id:id,device_id:device,unique_id,platform:'fritz',config_entry_id:'entry'};states[id]={entity_id:id,state,attributes,last_changed:stamp(0),last_updated:stamp(0)};};
for(let i=0;i<TRACKERS;i++){const hex=i.toString(16).padStart(4,'0'),mac=`02:00:00:00:${hex.slice(0,2)}:${hex.slice(2)}`,device='client_'+i;devices[device]={id:device,name:'Client '+i,config_entries:['entry']};
 add('device_tracker.client_'+i,device,mac+'_tracker',i%3?'home':'not_home',{source_type:'router',mac,ip:`192.168.${i>>8}.${i&255}`,host_name:'host-'+i,friendly_name:'Client '+String(i).padStart(3,'0'),last_time_reachable:stamp(0)});
 add('switch.client_'+i+'_internet',device,mac+'_internet_access','on');add('button.client_'+i+'_wake',device,mac+'_wake_on_lan','unknown');}
core.seed({devices,entities,states,locale:{language:'en'},user:{is_admin:true}});
const query=new l.BuschNetworkQueries(core).query({});let notifications=0;const off=core.subscribe(query,()=>notifications++);
const p=(values,q)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.ceil(q*s.length)-1)];};
let minute=1;const touch=i=>{const id='device_tracker.client_'+i,prev=core.index.states.get(id);core.updateState(id,{...prev,attributes:{...prev.attributes,last_time_reachable:stamp(minute)},last_updated:stamp(minute)});};
for(let i=0;i<50;i++){touch(i%TRACKERS);core.engine.flush?.();minute++;}
const single=[];for(let i=0;i<200;i++){const t=performance.now();touch((i*7)%TRACKERS);core.engine.flush?.();single.push(performance.now()-t);minute++;}
const burst=[];for(let r=0;r<20;r++){const t=performance.now();for(let i=0;i<100;i++)touch((r*100+i)%TRACKERS);core.engine.flush?.();burst.push(performance.now()-t);minute++;}
const rows=query.result.length,report={node:process.version,trackers:TRACKERS,rows,singleSamples:single.length,singleP50Ms:+p(single,.5).toFixed(4),singleP95Ms:+p(single,.95).toFixed(4),burstSamples:burst.length,burstP50Ms:+p(burst,.5).toFixed(3),burstP95Ms:+p(burst,.95).toFixed(3),notifications};
off();core.dispose();if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
if(rows!==TRACKERS)process.exitCode=1;
