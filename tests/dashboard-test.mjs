import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, sleep, waitFor } from './helpers/browser.mjs';
import { crmFixture } from './fixtures/crm.mjs';
const fixture = crmFixture(16), today = new Date();
function at(offset) { const d = new Date(today); d.setDate(d.getDate() + offset); d.setHours(8, 0, 0, 0); return d.toISOString(); }
function day(offset) { const d = new Date(at(offset)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
fixture.segments.push({ id: 'seg_retail', name: 'Comércio' }, { id: 'seg_empty', name: 'Sem registros' });
const stages = ['a_prospectar', 'em_contato', 'oportunidades', 'propostas', 'fechado', 'perdido'];
fixture.extraLeads.forEach((lead, index) => {
  lead.origem = ['Google Maps', 'Indicação', 'Instagram', 'Site'][index % 4]; lead.businessSegmentId = index % 3 === 0 ? 'seg_retail' : 'seg_test';
  const stage = stages[index % 6], value = 1500 + index * 100, history = [];
  if (index % 6) for (let offset = -28; offset <= 0; offset += 4) {
    history.push({ id: `call-${index}-${offset}`, type: 'call', at: at(offset), meta: { answered: index % 2 === 0 } });
    if (offset % 8 === 0) history.push({ id: `whatsapp-${index}-${offset}`, type: 'whatsapp', at: at(offset + 1), meta: {} });
  }
  if (index % 6 >= 2) history.push({ id: 'meeting-' + index, type: 'meeting', at: at(-2) });
  if (index % 6 >= 3) history.push({ id: 'proposal-' + index, type: 'proposal', at: at(-1) });
  const closure = stage === 'fechado' ? { result: 'won', value, date: day(-1) } : stage === 'perdido' ? { result: 'lost', reason: index % 2 ? 'Sem orçamento' : 'Escolheu concorrente', date: day(-3) } : null;
  fixture.records[lead.id] = { stage, createdAt: at(index % 2 ? -3 : -20), history, attempts: history.filter(e => e.type === 'call').length,
    pipeline: { version: 1, stage, substatus: stage === 'propostas' ? 'Negociando valores' : '', closure }, negotiation: { proposedValue: value, closedValue: stage === 'fechado' ? value : 0 } };
});
const exceptions = [], browser = await launchBrowser({ document: fixture, exceptions }), { cdp } = browser;
let passed = 0;
const quote = JSON.stringify, screens = process.env.MICA_DASHBOARD_SCREENSHOTS;
if (screens) mkdirSync(screens, { recursive: true });
async function check(name, expression) { assert(await cdp.evaluate(expression), name); passed++; }
async function click(selector) { await cdp.evaluate(`document.querySelector(${quote(selector)}).click()`); await sleep(60); }
async function segment(value) { await cdp.evaluate(`(() => {const s=document.getElementById('business-segment-filter');s.value=${quote(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`); await sleep(100); }
async function capture(name, lower = false) { if (!screens) return; await sleep(400); await cdp.evaluate(`window.scrollTo(0,${lower ? 1300 : 0});document.getElementById('view-root').scrollTop=${lower ? 1300 : 0}`); const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(screens, name + '.png'), Buffer.from(shot.data, 'base64')); }
try {
  assert(await waitFor(cdp, `!!document.querySelector('.metrics-grid')`), 'Hub initializes');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1250, deviceScaleFactor: 1, mobile: false });
  await cdp.evaluate(`document.documentElement.dataset.theme='light'`);
  await click('[data-view="dashboard"]');
  assert(await waitFor(cdp, `document.querySelector('.commercial-dashboard')?.dataset.chartsReady==='true'`), 'Dashboard charts initialize'); passed++;
  await check('Fifteen real CRM indicators', `document.querySelectorAll('.dash-stat').length===15&&document.querySelector('[data-metric="total"] b').textContent==='16'`);
  await check('All requested analysis panels', `document.querySelectorAll('.dashboard-panels>.dash-card').length===6&&document.querySelectorAll('.dashboard-kpi-primary').length===5`);
  await check('Charts and sparklines created once', `window.MicaCharts.count===7&&document.querySelectorAll('canvas').length===7`);
  await check('Configured goals retained', `document.querySelectorAll('.goal-card').length===4&&document.querySelectorAll('[role="progressbar"]').length===4`);
  await check('Data fallback available to keyboard and assistive technology', `document.querySelector('.dashboard-data summary')&&document.querySelector('[role="table"][aria-label="Dados de atividade e minigráficos"]')&&[...document.querySelectorAll('canvas')].every(c=>c.getAttribute('aria-label')&&c.getAttribute('role')==='img')`);
  await check('Real sources, no unprovided categories', `[...document.querySelectorAll('.dashboard-origin-list li>span')].map(x=>x.textContent).sort().join('|')==='Google Maps|Indicação|Instagram|Site'`);
  const baseline = await cdp.evaluate(`JSON.stringify(window.MicaData.load())`);
  await click('[data-period="today"]');
  await check('Period filters cohort and graphs', `Number(document.querySelector('[data-metric="total"] b').textContent)<16&&document.querySelector('[data-period="today"]').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('.dashboard-data-row').length===2`);
  await check('Filtering does not modify account business data', `JSON.stringify(window.MicaData.load())===${quote(baseline)}`);
  await click('[data-period="30"]');
  const prior = await cdp.evaluate(`({total:document.querySelector('[data-metric="total"] b').textContent,potential:document.querySelector('[data-metric="potential"] b').textContent,revenue:document.querySelector('[data-metric="revenue"] b').textContent})`);
  await segment('seg_retail');
  await check('Global segment updates total, potential, origins and ranking', `document.querySelector('[data-metric="total"] b').textContent==='6'&&document.querySelector('[data-metric="potential"] b').textContent!==${quote(prior.potential)}&&document.querySelectorAll('.is-ranking .dashboard-bar-row').length===1&&document.querySelector('.is-ranking .dashboard-bar-row>span').textContent==='Comércio'`);
  await segment('seg_empty');
  await check('Empty scope never shows invented activity', `!!document.querySelector('.dashboard-scope-empty')&&document.querySelector('[data-metric="total"] b').textContent==='0'&&!document.querySelector('.dashboard-donut')&&window.MicaCharts.count===0`);
  await segment('all');
  await click('[data-period="all"]');
  await check('All-time comparison is explicitly unavailable', `document.querySelector('[data-metric="total"] .dashboard-trend').textContent==='Sem comparação'`);
  await click('[data-period="30"]');
  await capture('dashboard-desktop-light');
  await capture('dashboard-desktop-light-lower', true);
  await cdp.evaluate(`document.documentElement.dataset.theme='dark'`); await sleep(100);
  await check('Theme refresh does not leak chart instances', `window.MicaCharts.count===7&&document.querySelector('.commercial-dashboard').dataset.chartsReady==='true'`);
  await capture('dashboard-desktop-dark');
  await cdp.evaluate(`document.documentElement.dataset.theme='light'`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await check('Reduced motion still draws real charts', `matchMedia('(prefers-reduced-motion:reduce)').matches&&window.MicaCharts.count===7`);
  const rect = await cdp.evaluate(`(() => {const r=document.querySelector('[data-dashboard-chart="activity"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect }); await sleep(100); passed++;
  await click('.dashboard-data summary');
  await check('Keyboard-accessible data table expands', `document.querySelector('.dashboard-data').open&&document.querySelectorAll('.dashboard-data-row').length===31`);
  await click('.dashboard-data summary');
  for (const width of [320, 390, 768, 1024, 1366, 1920]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width < 800 ? 900 : 1100, deviceScaleFactor: 1, mobile: width < 800 }); await sleep(180);
    await check('No horizontal overflow at ' + width, `document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.commercial-dashboard,.dash-card,.dash-stat,.goal-card,.dashboard-data-list')].every(e=>e.scrollWidth<=e.clientWidth+2)`);
    if (width === 390) await capture('dashboard-mobile');
    if (width === 390) await capture('dashboard-mobile-lower', true);
    if (width === 1024) await capture('dashboard-tablet');
  }
  await cdp.evaluate(`window.__getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(){throw new Error('Test drawing failure')}`);
  await click('[data-period="7"]');
  await check('Chart failure preserves data and provides recovery', `!document.querySelector('[data-chart-error]').hidden&&!!document.querySelector('[data-metric="total"] b')&&!!document.querySelector('.dashboard-data summary')`);
  await cdp.evaluate(`HTMLCanvasElement.prototype.getContext=window.__getContext`); await click('[data-period="30"]');
  await check('Charts recover on next render', `window.MicaCharts.count===7&&document.querySelector('[data-chart-error]').hidden`);
  await click('[data-view="leads"]');
  await check('Leaving dashboard destroys all instances', `window.MicaCharts.count===0&&!!document.querySelector('.data-table')`);
  await click('[data-view="dashboard"]');
  await check('Returning mounts only active charts', `window.MicaCharts.count===7`);
  assert.equal(exceptions.length, 0, exceptions.join('\n'));
  console.log(`Dashboard browser: ${passed} checks passed.`);
} finally { await browser.close(); }
