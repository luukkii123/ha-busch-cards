'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ladeKarte}=require('./laden.js');

const {buschEditorUpdate,buschEditorUpdatePath,buschEditorDeletePath}=ladeKarte([
  'buschEditorUpdate','buschEditorUpdatePath','buschEditorDeletePath'
]);

test('shared editor updates keep false, zero and empty text without mutating input',()=>{
  const incoming={title:'Old',nested:{count:5},rows:[{enabled:true}]};
  const next=buschEditorUpdate(incoming,{title:'',show_status:false,first:0});
  assert.equal(next.title,'');assert.equal(next.show_status,false);assert.equal(next.first,0);
  assert.equal(incoming.title,'Old');
  next.nested.count=9;next.rows[0].enabled=false;
  assert.equal(incoming.nested.count,5);assert.equal(incoming.rows[0].enabled,true);
});

test('shared editor path updates and deletes preserve siblings and array order',()=>{
  const incoming={filter:{include:[{domain:'sensor',state:'on'},{domain:'light'}]}};
  const updated=buschEditorUpdatePath(incoming,['filter','include',0,'state'],'');
  assert.equal(updated.filter.include[0].state,'');
  assert.equal(updated.filter.include[0].domain,'sensor');
  assert.equal(incoming.filter.include[0].state,'on');
  const without=buschEditorDeletePath(updated,['filter','include',0]);
  assert.equal(without.filter.include.length,1);
  assert.equal(without.filter.include[0].domain,'light');
  assert.equal(updated.filter.include.length,2);
});

test('shared editor deletes only undefined and rejects prototype paths',()=>{
  const incoming={zero:0,flag:false,empty:'',title:'x'};
  const next=buschEditorUpdate(incoming,{title:undefined});
  assert.equal(Object.hasOwn(next,'title'),false);
  assert.equal(next.zero,0);assert.equal(next.flag,false);assert.equal(next.empty,'');
  assert.throws(()=>buschEditorUpdatePath({},['__proto__','polluted'],true),/Invalid/);
  assert.equal({}.polluted,undefined);
});
