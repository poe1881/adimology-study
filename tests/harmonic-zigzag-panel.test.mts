import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { analysis, result, pivot } from './fixtures-zigzag.mjs';
const require=createRequire(import.meta.url);
const {HarmonicZigzagPanel}=require('../app/components/HarmonicZigzagPanel.tsx');
const render=(a:any)=>renderToStaticMarkup(React.createElement(HarmonicZigzagPanel,{analysis:a}));
test('legacy panel is collapsed without fetch or fake chart',()=>{const html=render(undefined);assert.match(html,/<details/);assert.doesNotMatch(html,/<details[^>]*open/);assert.match(html,/Versi Story lama/);assert.doesNotMatch(html,/<svg/);});
test('ABC projection renders three actual points, confirmation dates and undated illustrative D',()=>{const html=render(analysis);assert.match(html,/data-pivot="A"/);assert.match(html,/data-pivot="B"/);assert.match(html,/data-pivot="C"/);assert.doesNotMatch(html,/data-pivot="X"/);assert.match(html,/D\* ilustratif/);assert.match(html,/dikonfirmasi 2026-01-23/);assert.match(html,/bukan tanggal kedatangan/);assert.match(html,/aria-live="polite"/);});
test('multiple results offer family and lookback selector, not right-bar promise',()=>{const html=render({...analysis,results:[result,{...result,id:'other',period:13,periods:[13]}]});assert.match(html,/<select/);assert.match(html,/ABCD · lookback 13/);assert.match(html,/bukan 8 candle kanan/);});
test('dated provisional D is dashed and historical results mute targets',()=>{const html=render({...analysis,results:[{...result,stage:'expired',endedAt:analysis.lastDate,provisionalD:pivot(7,'low',true)}]});assert.match(html,/stroke-dasharray="6 5"/);assert.doesNotMatch(html,/>D\* ilustratif<\/text>/);assert.match(html,/Historis/);});

test('PRZ header is separated from the D illustration label',()=>{
 const html=render(analysis);
 assert.match(html,/<text[^>]*data-label="prz-range"[^>]*y="52"/);
 assert.match(html,/<circle[^>]*data-label="projected-d"/);
});

test('SSR candle hitboxes use bounded geometry and decorative overlays cannot steal hover',()=>{const html=render(analysis);assert.match(html,/data-hitbox=/);assert.match(html,/data-overlay="zigzag"[^>]*pointer-events="none"/);});
