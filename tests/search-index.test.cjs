const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {KnowledgeBase}=require('../lib');
const {SearchIndexService}=require('../lib/services/SearchIndexService');
const lunr=require('lunr');

test('search builds once without page rendering, supports Ukrainian and exports an empty index', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb-search-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'house.md'),'# Будинок\n\nОпалення будинку та конструкція.');
  const kb=new KnowledgeBase({contentRootPath:root,title:'Fixture'});
  kb.renderContent=()=>{throw new Error('Search must not build full pages');};
  const renderer=kb.getMarkdownRenderer();
  const render=renderer.render.bind(renderer);
  let renders=0;
  renderer.render=async (...args)=>{renders++;return render(...args);};
  const service=new SearchIndexService(kb,kb.getFileService(),{});
  const results=await Promise.all(Array.from({length:4},()=>service.buildAndGetIndex()));
  assert.equal(renders,1);
  assert.equal(results[0].documents.length,1);
  assert.equal(lunr.Index.load(results[0].index).search('будинок')[0].ref,'house.md');
  assert.equal(lunr.Index.load(results[0].index).search('опалення')[0].ref,'house.md');
  assert.equal(results[0].documents[0].url,'/content/house.md');
  await fs.unlink(path.join(root,'house.md'));
  await service.build();
  assert.equal((await service.getIndexPayload()).documents.length,0);
});

test('server mode detects deleted and renamed documents without a restart', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb-search-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'old.md'),'# Old\n\nfirst');
  await fs.writeFile(path.join(root,'newest.md'),'# Newest\n\nsecond');
  const kb=new KnowledgeBase({contentRootPath:root,title:'Fixture'});
  const service=kb.getSearchIndexService();
  assert.equal((await service.buildAndGetIndex()).documents.length,2);
  // Removing the most recently modified file lowers the newest mtime; a max-mtime check misses it.
  await fs.unlink(path.join(root,'newest.md'));
  assert.deepEqual((await service.buildAndGetIndex()).documents.map(doc=>doc.id),['old.md']);
  await fs.rename(path.join(root,'old.md'),path.join(root,'renamed.md'));
  assert.deepEqual((await service.buildAndGetIndex()).documents.map(doc=>doc.id),['renamed.md']);
});

test('memory and disk payloads share one public schema; front matter names the result', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb-search-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'plan.work-manager.md'),'---\nid: plan\ntitle: "Назва з YAML"\ndescription: secretword\n---\nВступ до плану.');
  const kb=new KnowledgeBase({contentRootPath:root,title:'Fixture'});
  const memory=await kb.getSearchIndexService().buildAndGetIndex();
  assert.deepEqual(Object.keys(memory.documents[0]).sort(),['id','snippet','title','url']);
  assert.equal(memory.documents[0].title,'Назва з YAML');
  assert.doesNotMatch(memory.documents[0].snippet,/secretword|title:/);
  // A new process has no cache and reads the same schema back from disk.
  const fresh=new SearchIndexService(new KnowledgeBase({contentRootPath:root,title:'Fixture'}),kb.getFileService(),{});
  assert.deepEqual((await fresh.getIndexPayload()).documents,memory.documents);
});
