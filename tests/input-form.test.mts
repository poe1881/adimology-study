import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const InputForm: typeof import('../app/components/InputForm').default = require('../app/components/InputForm').default;

function submitButton(loading: boolean) {
  const html = renderToStaticMarkup(createElement(InputForm, {
    onSubmit: () => {}, loading, fromDate: '2026-01-01', toDate: '2026-01-01',
    onDateChange: () => {},
  }));
  const button = html.match(/<button\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(button, 'Submit button must remain present');
  return button;
}

test('analysis submit button is labelled Cek Bandar', () => {
  assert.equal(submitButton(false)[1], 'Cek Bandar');
});

test('loading submit button remains disabled with progress label', () => {
  const button = submitButton(true);
  assert.equal(button[1], '...');
  assert.match(button[0], /disabled=""/);
});
