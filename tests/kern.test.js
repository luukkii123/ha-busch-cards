"use strict";
// M8: The shared core (BuschCardsCore, ensureBuschCore, smart queries) is
// embedded from hacs/shared-core/busch-core.js by scripts/sync-shared-ui.py and
// must stay byte-identical with ha-unraid-cards. The marker hash must match the
// block, so any edit inside the block fails here and in GitHub CI.
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { quelle, KARTE } = require('./laden.js');

const BLOCK = /\/\* BEGIN BUSCH SHARED CORE (\S+) sha256:([0-9a-f]{64}) \*\/\n([\s\S]*?)\/\* END BUSCH SHARED CORE \*\//g;

test('core: exactly one CORE block whose content matches its marker hash', () => {
  const text = quelle();
  const blocks = [...text.matchAll(BLOCK)];
  assert.equal(blocks.length, 1, 'exactly one BUSCH SHARED CORE block');
  assert.equal(text.split('/* BEGIN BUSCH SHARED CORE ').length - 1, 1, 'no second BEGIN marker');
  const [, version, hash, block] = blocks[0];
  const stamp = `const BUSCH_CORE_STAMP = Object.freeze({ version: "${version}", sourceHash: "${hash.slice(0, 12)}" });\n`;
  assert.ok(block.startsWith(stamp), 'block starts with the stamp carrying marker version and hash prefix');
  const body = block.slice(stamp.length);
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), hash, 'core differs from its marker hash');
  assert.ok(body.startsWith(`/* Busch Cards Core ${version}. `), 'source head names the marker version');
});

// M9: Two bundles with different core content share one global core. The first
// loaded core stays; the later bundle warns exactly once, and the version and
// the 12-character source hash from the marker stay readable from outside.
const vm = require('node:vm');
function evaluateTwice(firstText, secondText) {
  const warnings = [];
  const context = {
    console: { info() {}, warn: (...args) => warnings.push(args.join(' ')), error() {}, log() {} },
    window: { customCards: [] }, customElements: { define() {} }, HTMLElement: class {}, document: { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }; } },
    setTimeout, clearTimeout, queueMicrotask, performance,
  };
  context.globalThis = context; vm.createContext(context);
  // A function scope per evaluation mirrors two separate ES modules on one globalThis.
  const run = (text) => vm.runInContext(`(() => {\n${text}\n;return { ensureBuschCore };\n})()`, context);
  return { warnings, first: run(firstText), second: run(secondText) };
}
function marker(text) {
  const [, version, hash] = text.match(/\/\* BEGIN BUSCH SHARED CORE (\S+) sha256:([0-9a-f]{64}) \*\//);
  return { version, sourceHash: hash.slice(0, 12) };
}

test('core: a second core with another hash warns once and keeps the first core', () => {
  const text = fs.readFileSync(KARTE, 'utf8'), own = marker(text);
  const other = text.replace(`sourceHash: "${own.sourceHash}"`, 'sourceHash: "000000000000"');
  assert.ok(other !== text, 'bundle carries the injected sourceHash');
  const { warnings, first, second } = evaluateTwice(text, other);
  const core = first.ensureBuschCore(1);
  assert.equal(warnings.length, 0);
  for (let i = 0; i < 3; i++) assert.equal(second.ensureBuschCore(1), core, 'first core is kept');
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], new RegExp(`${own.sourceHash}[\\s\\S]*000000000000|000000000000[\\s\\S]*${own.sourceHash}`));
  assert.equal(core.version, own.version);
  assert.equal(core.sourceHash, own.sourceHash);
  const snapshot = core.debugSnapshot();
  assert.equal(snapshot.version, own.version);
  assert.equal(snapshot.sourceHash, own.sourceHash);
});

test('core: the same core loaded twice stays silent', () => {
  const text = fs.readFileSync(KARTE, 'utf8');
  const { warnings, first, second } = evaluateTwice(text, text);
  assert.equal(second.ensureBuschCore(1), first.ensureBuschCore(1));
  assert.equal(warnings.length, 0, warnings.join('\n'));
});
