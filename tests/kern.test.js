"use strict";
// M8: The shared core (BuschCardsCore, ensureBuschCore, smart queries) is
// embedded from hacs/shared-core/busch-core.js by scripts/sync-shared-ui.py and
// must stay byte-identical with ha-unraid-cards. The marker hash must match the
// block, so any edit inside the block fails here and in GitHub CI.
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { quelle } = require('./laden.js');

const BLOCK = /\/\* BEGIN BUSCH SHARED CORE (\S+) sha256:([0-9a-f]{64}) \*\/\n([\s\S]*?)\/\* END BUSCH SHARED CORE \*\//g;

test('core: exactly one CORE block whose content matches its marker hash', () => {
  const text = quelle();
  const blocks = [...text.matchAll(BLOCK)];
  assert.equal(blocks.length, 1, 'exactly one BUSCH SHARED CORE block');
  assert.equal(text.split('/* BEGIN BUSCH SHARED CORE ').length - 1, 1, 'no second BEGIN marker');
  const [, , hash, body] = blocks[0];
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), hash, 'core differs from its marker hash');
  assert.ok(body.startsWith('const BUSCH_CORE_KEY = Symbol.for("busch.cards.core");\n'), 'block starts with the core');
});
