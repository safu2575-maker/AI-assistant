import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReportState } from '../src/report-state.js';
import { selectedModel, chatIdentity } from '../src/selected-model.js';
import { Model } from '../src/model.js';
test('shared selection is private, updates across readers, and never falls back after a missing selection', async () => {
 const dir=await mkdtemp(join(tmpdir(),'askbics-selection-'));
 try {
 const store=new ReportState(Buffer.alloc(32,7),dir), otherReader=new ReportState(Buffer.alloc(32,7),dir);
 const demo={datasetId:'demo',name:'Demo',measures:[],dimensions:[]} as Model;
 const real={...demo,datasetId:'real',name:'Actual data'};
 await store.write('tenant:alice:connections',{selected:'real',models:[real]});
 assert.equal((await selectedModel(otherReader,'tenant:alice',demo)).datasetId,'real');
 assert.equal((await selectedModel(otherReader,'tenant:bob',demo)).datasetId,'demo');
 await store.write('tenant:alice:connections',{selected:'missing',models:[real]});
 await assert.rejects(selectedModel(otherReader,'tenant:alice',demo),/unavailable/);
 await assert.rejects(selectedModel(undefined,'tenant:alice',demo),/unavailable/);
 assert.throws(()=>chatIdentity('tenant'),/identity/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
