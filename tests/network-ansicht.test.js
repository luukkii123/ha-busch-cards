'use strict';
// M30 (#1311, W6): network rows as <details> with a definition list, search, presence filter,
// sort, result count and a real "N more" button. The data layer (M4 changedBatch) stays untouched.
const {test}=require('node:test');const assert=require('node:assert/strict');const {load,fixture}=require('./network-fixture');
const descend=node=>[node,...(node.children||[]).flatMap(descend)];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function memoryStorage(){const data=new Map();return {data,getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};}
function many(l,n=12){const f=fixture(l);for(let i=1;i<=n;i++){const hex=i.toString(16).padStart(2,'0'),mac='02:00:00:00:02:'+hex;f.add('device_tracker.c'+i,'client',mac+'_tracker',i%3?'home':'not_home',{source_type:'router',mac,ip:'192.0.2.'+(100+i),host_name:'host-'+i,friendly_name:'Client '+String(i).padStart(2,'0'),last_time_reachable:new Date(Date.UTC(2026,8,29,12,i)).toISOString()});}f.refresh();return f;}
function card(l,f,config={},Card=l.BuschNetworkCard){const c=new Card();c._core=f.core;c._hass={...f.hass,locale:{language:'de'}};c._connect=()=>{};c.isConnected=true;c.setConfig(config);return c;}
const articles=c=>c._clientBody.children.filter(n=>n.tagName==='ARTICLE');
const text=node=>descend(node).map(n=>typeof n.textContent==='string'&&!(n.children||[]).length?n.textContent:'').join(' ');
const toolbar=c=>c._toolbar;
const control=(c,tag,name)=>descend(toolbar(c)).find(n=>n.tagName===tag&&(!name||n.dataset?.control===name));
function type(c,value){const input=control(c,'INPUT','search');input.value=value;input.listeners.input({target:input});}
function choose(c,name,value){const select=control(c,'SELECT',name);select.value=value;select.listeners.change({target:select});}

test('M30: a client row is a native details whose summary holds name, status and IP; values form a definition list',()=>{
 const l=load(),f=fixture(l),c=card(l,f,{count:0}),row=articles(c)[0];
 const details=row.children.flatMap(n=>[n,...(n.children||[])]).find(n=>n.tagName==='DETAILS');assert.ok(details,'row has a details element');
 const summary=details.children[0];assert.equal(summary.tagName,'SUMMARY','summary is the first child, so Enter and Space toggle natively');
 assert.equal(summary.attributes.tabindex,undefined);assert.equal(details.open,false,'rows start collapsed');
 const head=text(summary);assert.match(head,/Workstation/);assert.match(head,/Anwesend gemeldet/);assert.match(head,/192\.0\.2\.10/);
 assert.equal(descend(summary).some(n=>n.tagName==='BUTTON'),false,'no interactive content inside the summary');
 const dl=details.children.find(n=>n.tagName==='DL');assert.ok(dl,'values are a definition list');
 const pairs=dl.children.map(d=>[d.children[0].tagName,d.children[0].textContent,d.children[1].tagName,d.children[1].textContent]);
 assert.ok(pairs.every(([dt,,dd])=>dt==='DT'&&dd==='DD'));
 assert.deepEqual(pairs.map(p=>p[1]).slice(0,3),['Hostname','MAC-Adresse','Verbindungspunkt']);
 assert.ok(pairs.some(p=>p[1]==='Verbindungspunkt'&&p[3]==='Unbekannt'));
 assert.equal(descend(row).some(n=>n.className==='detail'&&/: /.test(n.textContent||'')),false,'no "Label: value" text lines');
 const detailsButton=descend(row).find(n=>n.tagName==='BUTTON'&&n.attributes['aria-label']==='Details');assert.ok(detailsButton,'Details stays a labelled button outside the summary');
 const actions=row.children.find(n=>n.className==='actions');assert.ok(actions,'actions sit in a row under the head');
 assert.ok(actions.children.some(n=>n.attributes['aria-label']==='Aufwecken'));
});

test('M30: an opened row stays open across a row rebuild and a shell rebuild',async()=>{
 const l=load(),f=fixture(l),c=card(l,f,{count:0});const details=()=>descend(articles(c)[0]).find(n=>n.tagName==='DETAILS');
 const first=details();first.open=true;first.listeners.toggle();
 const prev=f.core.index.states.get('device_tracker.renamed');f.core.updateState('device_tracker.renamed',{...prev,attributes:{...prev.attributes,ip:'192.0.2.11'}});await tick();
 assert.notEqual(details(),first,'the changed row was rebuilt');assert.equal(details().open,true);assert.match(text(details().children[0]),/192\.0\.2\.11/);
 c._shellSignature=null;c._render();assert.equal(details().open,true);
 details().open=false;details().listeners.toggle();c._shellSignature=null;c._render();assert.equal(details().open,false);
});

test('M30: search filters name, IP, hostname and MAC and shows the result count',()=>{
 const l=load(),f=many(l),c=card(l,f,{count:0});assert.equal(toolbar(c).hidden,false);assert.equal(articles(c).length,13);
 const count=()=>descend(toolbar(c)).find(n=>n.dataset?.control==='count').textContent;assert.equal(count(),'13 von 13 Clients');
 type(c,'host-1');assert.deepEqual(articles(c).map(n=>n.dataset.entityId),['device_tracker.c1','device_tracker.c10','device_tracker.c11','device_tracker.c12']);assert.equal(count(),'4 von 13 Clients');
 type(c,'192.0.2.105');assert.deepEqual(articles(c).map(n=>n.dataset.entityId),['device_tracker.c5']);
 type(c,'02:00:00:00:02:0A');assert.deepEqual(articles(c).map(n=>n.dataset.entityId),['device_tracker.c10']);
 type(c,'client 07');assert.deepEqual(articles(c).map(n=>n.dataset.entityId),['device_tracker.c7']);
 type(c,'kein treffer');assert.equal(articles(c).length,0);assert.equal(count(),'0 von 13 Clients');assert.match(text(c._clientBody),/Keine passenden Netzwerkclients/);
 type(c,'');assert.equal(articles(c).length,13);
});

test('M30: presence filter and sort by name or last seen; filter and sort are remembered (R21), the search is not',()=>{
 const storage=memoryStorage(),l=load({localStorage:storage}),f=many(l),c=card(l,f,{count:0});
 choose(c,'filter','not_home');assert.deepEqual(articles(c).map(n=>n.dataset.entityId),['device_tracker.c3','device_tracker.c6','device_tracker.c9','device_tracker.c12']);
 choose(c,'filter','home');assert.ok(articles(c).length===9&&articles(c).every(n=>!['device_tracker.c3','device_tracker.c6','device_tracker.c9','device_tracker.c12'].includes(n.dataset.entityId)));
 choose(c,'filter','all');choose(c,'sort','last_seen');assert.deepEqual(articles(c).slice(0,3).map(n=>n.dataset.entityId),['device_tracker.c12','device_tracker.c11','device_tracker.c10'],'newest first');
 choose(c,'sort','name');assert.deepEqual(articles(c).slice(0,2).map(n=>n.dataset.entityId),['device_tracker.c1','device_tracker.c2']);
 choose(c,'filter','not_home');choose(c,'sort','last_seen');type(c,'host');
 const saved=[...storage.data.values()];assert.equal(saved.length,1);assert.deepEqual(JSON.parse(saved[0]),{filter:'not_home',sort:'last_seen'});
 const again=card(l,f,{count:0});assert.equal(control(again,'SELECT','filter').value,'not_home');assert.equal(control(again,'SELECT','sort').value,'last_seen');assert.equal(control(again,'INPUT','search').value,'');
 assert.deepEqual(articles(again).map(n=>n.dataset.entityId),['device_tracker.c12','device_tracker.c9','device_tracker.c6','device_tracker.c3']);
 const other=card(l,f,{count:0,title:'Gäste'});assert.equal(control(other,'SELECT','filter').value,'all','another card keeps its own view');
 const broken=load({localStorage:{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}}}),bf=many(broken),bc=card(broken,bf,{count:0});choose(bc,'filter','home');assert.equal(articles(bc).length,9,'blocked storage never breaks the card');
 storage.data.set([...storage.data.keys()][0],'{"filter":"evil","sort":"__proto__"}');const sane=card(l,f,{count:0});assert.equal(control(sane,'SELECT','filter').value,'all');assert.equal(control(sane,'SELECT','sort').value,'default');
});

test('M30: "N more" is a real button naming how many rows it reveals, counted after the search',()=>{
 const l=load(),f=many(l),c=card(l,f,{count:5});const more=()=>descend(c._clientBody).find(n=>n.tagName==='BUTTON'&&/weitere anzeigen$/.test(n.attributes['aria-label']||''));
 assert.equal(articles(c).length,5);assert.equal(more().attributes['aria-label'],'5 weitere anzeigen');assert.equal(more().textContent,'5 weitere anzeigen');assert.equal(more().attributes['data-variant'],'secondary');
 more().listeners.click({stopPropagation(){}});assert.equal(articles(c).length,10);assert.equal(more().attributes['aria-label'],'3 weitere anzeigen');
 more().listeners.click({stopPropagation(){}});assert.equal(articles(c).length,13);assert.equal(more(),undefined);
 type(c,'host-1');assert.equal(articles(c).length,4);assert.equal(more(),undefined,'the search resets paging and four matches fit');
 type(c,'host');assert.equal(articles(c).length,5);assert.equal(more().attributes['aria-label'],'5 weitere anzeigen');
});

test('M30: small lists hide the toolbar; a repeated render reuses every node',()=>{
 const l=load(),f=fixture(l),c=card(l,f,{count:0});assert.equal(toolbar(c).hidden,true,'one client needs no search');
 const before=[...c._clientBody.children],bar=toolbar(c);c._render();c._render();assert.deepEqual([...c._clientBody.children],before);assert.equal(toolbar(c),bar);
 const fm=many(l),fc=card(l,fm,{count:0});assert.equal(toolbar(fc).hidden,false);
});

test('M30: toolbar and row texts exist in German and English on both cards',()=>{
 const l=load(),f=many(l);for(const Card of [l.BuschNetworkCard,l.BuschFritzDeviceCard])for(const language of ['de','en']){const c=card(l,f,{device_id:'router',count:0},Card);c._hass={...c._hass,locale:{language}};const t=c._text();
  for(const key of ['search','search_placeholder','filter_presence','filter_all','filter_home','filter_not_home','view_sort','sort_default','sort_name','sort_last_seen','result_count','more'])assert.equal(typeof t[key],'string',Card.name+' '+language+' '+key);
  assert.match(t.more,/\{n\}/);assert.match(t.result_count,/\{shown\}.*\{total\}/);c.disconnectedCallback();}
});

test('M30: the icon-only Details button in the row head keeps a 44 px width despite the card-wide min-width reset',()=>{
 // The card sheet resets `*{min-width:0}` after BuschUI's `:where(.busch-ui-action){min-width:44px}`; both have zero
 // specificity, so the later reset wins and the icon button shrinks to its padding plus icon (run 20261119-131747: < 44 px).
 const {BUSCH_NETWORK_STYLE:css}=require('./laden').ladeKarte(['BUSCH_NETWORK_STYLE']);
 const reset=css.lastIndexOf('*{box-sizing:border-box;min-width:0}');assert.ok(reset>0,'card-wide min-width reset present');
 const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m.index>reset&&m[1].split(',').some(s=>s.trim()==='.client-line>.busch-ui-action'));
 assert.ok(rules.some(m=>/(^|;)\s*min-width:\s*var\(--ha-space-11,\s*44px\)/.test(m[2])),'row-head action declares min-width 44 px after the reset');
});
