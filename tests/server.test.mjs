import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('EasyPanel server exposes public config, health, SPA fallback and no HTML for missing scripts',async(t)=>{
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3199',SUPABASE_URL:'https://project.example.test',SUPABASE_ANON_KEY:'public-test-key',MERCOSULPAY_API_KEY:'never-expose-this'}});
 try{
  await once(child.stdout,'data');
  const base='http://127.0.0.1:3199';
  assert.equal((await(await fetch(base+'/api/health')).json()).ok,true);
  const config=await(await fetch(base+'/config.js')).text();
  assert.match(config,/public-test-key/);
  assert.doesNotMatch(config,/never-expose-this/);
  const admin=await fetch(base+'/admin');
  assert.equal(admin.status,200);
  assert.match(await admin.text(),/id="app"/);
  const missing=await fetch(base+'/assets/missing.js');
  assert.equal(missing.status,404);

  await t.test('serves the root, static files and nested routes within the build directory',async()=>{
   for(const path of ['/','/index.html','/admin/settings','/..cache/settings','/assets%2f..%2findex.html']){
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    assert.match(await response.text(),/id="app"/,path);
   }
  });

  await t.test('rejects encoded traversal including sibling directories sharing the root prefix',async()=>{
   for(const path of ['/..%2f','/%2e%2e%2foutside.js','/nested%2f..%2f..%2foutside.js','/..%2fdist-sibling%2foutside.js']){
    const response=await fetch(base+path);
    assert.equal(response.status,403,path);
    assert.equal(await response.text(),'',path);
   }
  });

  await t.test('rejects encoded Windows separators on Windows without treating them as separators on POSIX',async()=>{
   for(const path of ['/..%5coutside.js','/nested%5c..%5c..%5coutside.js','/..%5cdist-sibling%5coutside.js','/..%5c..%2foutside.js']){
    const response=await fetch(base+path);
    assert.equal(response.status,process.platform==='win32'?403:404,path);
    assert.doesNotMatch(await response.text(),/id="app"/,path);
   }
  });
 }finally{
  child.kill();
 }
});
