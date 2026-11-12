const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { KnowledgeBase, StaticSiteBuilder, notesPlugin, resolvePluginsFromSettings } = require('../lib');

async function content(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-notes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (file, text) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), text);
  };
  await write('index.md', '# Home\n\nSee [[Камін]], [[projects/house|the house]], [[Missing note]] and `[[not a link]]`.');
  await write('projects/house.md', '---\ntitle: Будинок\ntags: [дім, project]\n---\n# House\n\nHeating: [[kamin#Димохід Ø120]]. Also [boiler](../areas/boiler.md).');
  await write('projects/kamin.md', '---\ntags: дім\n---\n# Камін\n\n## Димохід Ø120\n\nBack to [[house]].');
  await write('archive/kamin.md', '# Old kamin\n\nNothing.');
  await write('areas/boiler.md', '# Boiler\n\n```\n[[house]] inside code is not a link\n```');
  await write('all.tags.md', '---\ntitle: Теги\n---\nУсі теги.');
  return root;
}

test('wiki links resolve by path, file name and title; the nearest note wins; missing links are marked', async t => {
  const root = await content(t);
  const kb = new KnowledgeBase({ contentRootPath: root, plugins: [notesPlugin()] });
  const home = (await kb.renderContent('index.md')).htmlContent;
  assert.match(home, /<a class="kb-wikilink kb-markdown-link" href="\/projects\/kamin\.md">Камін<\/a>/);
  assert.match(home, /<a class="kb-wikilink kb-markdown-link" href="\/projects\/house\.md">the house<\/a>/);
  assert.match(home, /<span class="kb-wikilink kb-wikilink--missing"[^>]*>Missing note<\/span>/);
  assert.match(home, /<code>\[\[not a link\]\]<\/code>/);
  // [[kamin]] from projects/ means projects/kamin.md, not archive/kamin.md; the heading becomes an anchor.
  const house = (await kb.renderContent('projects/house.md')).htmlContent;
  assert.match(house, /href="\/projects\/kamin\.md#димохід-ø120"/);
});

test('backlinks list every note that links here, by wiki link or Markdown link', async t => {
  const root = await content(t);
  const kb = new KnowledgeBase({ contentRootPath: root, plugins: [notesPlugin({ backlinksTitle: 'Згадки' })] });
  const house = (await kb.renderContent('projects/house.md')).htmlContent;
  const section = house.match(/<section class="kb-backlinks">[\s\S]*<\/section>/)[0];
  assert.match(section, /<h2>Згадки<\/h2>/);
  assert.deepEqual([...section.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(match => [match[1], match[2]]),
    [['/index.md', 'Home'], ['/projects/kamin.md', 'Камін']]);
  const boiler = (await kb.renderContent('areas/boiler.md')).htmlContent;
  assert.match(boiler, /kb-backlinks[\s\S]*href="\/projects\/house\.md">Будинок</);
  assert.doesNotMatch((await kb.renderContent('archive/kamin.md')).htmlContent, /kb-backlinks/);
});

test('tags are shown on notes and collected on a *.tags.md page', async t => {
  const root = await content(t);
  const kb = new KnowledgeBase({ contentRootPath: root, plugins: [notesPlugin()] });
  const house = (await kb.renderContent('projects/house.md')).htmlContent;
  assert.match(house, /<a class="kb-tag" href="\/all\.tags\.md#tag-дім">#дім<\/a> <a class="kb-tag" href="\/all\.tags\.md#tag-project">#project<\/a>/);
  const page = await kb.renderContent('all.tags.md');
  assert.equal(page.title, 'Теги');
  assert.match(page.htmlContent, /Усі теги\./);
  assert.match(page.htmlContent, /<h2 id="tag-дім">#дім <small>2<\/small><\/h2><ul><li><a href="\/projects\/house\.md">Будинок<\/a><\/li><li><a href="\/projects\/kamin\.md">Камін<\/a><\/li><\/ul>/);
  assert.match(page.htmlContent, /<h2 id="tag-project">#project <small>1<\/small>/);

  await fs.unlink(path.join(root, 'all.tags.md'));
  const plain = (await new KnowledgeBase({ contentRootPath: root, plugins: [notesPlugin()] }).renderContent('projects/house.md')).htmlContent;
  assert.match(plain, /<span class="kb-tag">#дім<\/span>/);
});

test('static builds link notes with .html addresses under the base URL', async t => {
  const root = await content(t);
  const outputDir = path.join(root, '..', path.basename(root) + '-site');
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  await new StaticSiteBuilder({ contentRootPath: root, baseUrl: '/kb', isStaticSite: true, search: { enabled: false },
    build: { outputDir }, plugins: [notesPlugin()] }).build();
  const house = await fs.readFile(path.join(outputDir, 'projects', 'house.html'), 'utf8');
  assert.match(house, /href="\/kb\/projects\/kamin\.html#димохід-ø120"/);
  assert.match(house, /class="kb-tag" href="\/kb\/all\.tags\.html#tag-дім"/);
  assert.match(house, /kb-backlinks[\s\S]*href="\/kb\/index\.html">Home</);
  assert.match(await fs.readFile(path.join(outputDir, 'all.tags.html'), 'utf8'), /href="\/kb\/projects\/house\.html">Будинок</);
});

test('options switch features off; the plugin is available by name', async t => {
  const root = await content(t);
  const [plugin] = resolvePluginsFromSettings({ plugins: [{ name: 'notes', options: { wikiLinks: false, backlinks: false, tags: false } }] });
  assert.equal(plugin.id, 'notes');
  const home = (await new KnowledgeBase({ contentRootPath: root, plugins: [plugin] }).renderContent('index.md')).htmlContent;
  assert.match(home, /\[\[Камін\]\]/);
  assert.doesNotMatch(home, /kb-wikilink|kb-backlinks|kb-tag/);
  assert.throws(() => notesPlugin({ nope: true }), /unknown option "nope"/);
  assert.throws(() => notesPlugin({ refreshSeconds: -1 }), /refreshSeconds/);
});

test('headings in any script get distinct anchors that the table of contents links to', async t => {
  const root = await content(t);
  const page = await new KnowledgeBase({ contentRootPath: root }).renderContent('projects/kamin.md');
  assert.match(page.htmlContent, /<h2 id="димохід-ø120">/);
  assert.match(page.htmlContent, /<a href="#димохід-ø120">Димохід Ø120<\/a>/);
  assert.match(page.htmlContent, /<h1 id="камін">/);
});

test('a running server refreshes links when content changes', async t => {
  const root = await content(t);
  const express = require('express');
  const kb = new KnowledgeBase({ contentRootPath: root, plugins: [notesPlugin({ refreshSeconds: 3600 })] });
  kb.setupMiddleware(express());
  t.after(() => kb.close());
  assert.match((await kb.renderContent('index.md')).htmlContent, /kb-wikilink--missing[^>]*>Missing note</);
  await fs.writeFile(path.join(root, 'missing-note.md'), '# Missing note');
  let html = '';
  for (let attempt = 0; attempt < 40 && !/href="\/missing-note\.md"/.test(html); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    html = (await kb.renderContent('index.md')).htmlContent;
  }
  assert.match(html, /<a class="kb-wikilink kb-markdown-link" href="\/missing-note\.md">Missing note<\/a>/);
});
