import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
test('browser title is exactly poe-nya-Bandar', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /title:\s*"poe-nya-Bandar"/);
});

test('navbar renders new application name', () => {
  const Navbar = require('../app/components/Navbar').default;
  assert.match(renderToStaticMarkup(createElement(Navbar)), />poe-nya-Bandar<\/h1>/);
});

test('password screen and exported card use new name without changing source attribution links', () => {
  for (const file of ['PasswordGate.tsx', 'CompactResultCard.tsx']) {
    const source = readFileSync(new URL('../app/components/' + file, import.meta.url), 'utf8');
    assert.ok(source.includes('poe-nya-Bandar'), file);
    assert.doesNotMatch(source, />Adimology</);
  }
});
