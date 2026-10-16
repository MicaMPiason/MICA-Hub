import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, sleep, waitFor } from './helpers/browser.mjs';
import { crmFixture } from './fixtures/crm.mjs';

const screenshotDir = process.env.MICA_RESPONSIVE_SCREENSHOTS;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
const fixture = crmFixture(12);
const longName = 'Empresa de serviços e soluções comerciais com nome extenso para conferir a leitura em qualquer dispositivo';
fixture.extraLeads[0].nome = longName;
fixture.segments[0].name = 'Serviços de instalação e manutenção empresarial';
fixture.proposals = { list: [{ id: 'responsive-proposal', number: 'PROP-0001', title: 'Proposta comercial', client: { company: longName }, items: [{ description: longName, quantity: 1, unitPrice: 1500 }] }] };
fixture.financial = { transactions: [{ id: 'responsive-transaction', description: longName, notes: 'Detalhes adicionais para o teste de quebra de linha.', type: 'income', category: 'Serviço', amount: 1500, date: new Date().toISOString().slice(0, 10) }] };
const results = [], exceptions = [];
const harness = await launchBrowser({ document: fixture, exceptions });
const { cdp } = harness;
const quote = JSON.stringify;
function assert(name, condition, detail = '') { results.push({ name, ok: Boolean(condition), detail }); }
async function click(selector) {
  const found = await cdp.evaluate(`(() => {const control=document.querySelector(${quote(selector)});if(!control)return false;control.click();return true})()`);
  if (!found) throw new Error('Control missing: ' + selector);
  await sleep(35);
}
async function screenshot(name) {
  if (!screenshotDir) return;
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(screenshotDir, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function checkLayout(name) {
  const overflow = await cdp.evaluate(`(() => {
    const selectors='.topbar,.view-root,.modal,.modal-body,.modal-foot,.data-actions,.metrics-grid,.metric-card,.priority-grid,.task-columns,.kanban-v2,.pipeline-column,.agenda-grid,.table-shell,.data-table,.preview-shell,.import-preview,.settings-layout,.financial-filters,.report-toolbar,.catalog-filters,.proposal-builder,.proposal-editor,.proposal-item-row,.proposal-adjustments,.proposal-live-preview,.proposal-preview-stage,.lead-drawer.is-open,.drawer-body,.drawer-hero,.session-card,.prospect-session,.btn';
    const visible=element=>element.getClientRects().length&&!element.closest('[hidden]');
    const bad=Array.from(document.querySelectorAll(selectors)).filter(visible).filter(element=>element.scrollWidth>element.clientWidth+1&&!element.matches('.metric-card')).map(element=>({class:element.className,width:element.clientWidth,content:element.scrollWidth,children:Array.from(element.children).filter(child=>child.getBoundingClientRect().right>element.getBoundingClientRect().right+1).map(child=>child.className)}));
    Array.from(document.querySelectorAll('body *')).filter(visible).filter(element=>['auto','scroll'].includes(getComputedStyle(element).overflowX)&&element.scrollWidth>element.clientWidth+1&&!element.matches('input,textarea')).forEach(element=>bad.push({scrollable:element.className,width:element.clientWidth,content:element.scrollWidth}));
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push({page:document.documentElement.scrollWidth,viewport:innerWidth});
    return bad;
  })()`);
  assert(name + ': sem conteúdo ou rolagem horizontal', overflow.length === 0, JSON.stringify(overflow));
  assert(name + ': barras ocultas', await cdp.evaluate(`Array.from(document.querySelectorAll('html,.view-root,.modal,.session-card,.sidebar-content')).every(element=>getComputedStyle(element).scrollbarWidth==='none'&&getComputedStyle(element,'::-webkit-scrollbar').display==='none')`));
}

try {
  if (!await waitFor(cdp, `!!document.querySelector('.metrics-grid')`)) throw new Error('Hub did not start');
  if (!process.env.MICA_RESPONSIVE_SCROLL_ONLY) for (const [width, height] of [[320,568],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const size = width + 'x' + height;
    for (const view of ['hoje','pipeline','leads','agenda','dashboard','relatorios','propostas','catalogo','financeiro','configuracoes']) {
      await click('.side-link[data-view="' + view + '"]');
      await checkLayout(size + ' ' + view);
      if (view === 'leads') assert(size + ': todos os campos dos leads mantêm rótulos', await cdp.evaluate(`document.querySelectorAll('.data-table tbody tr').length===12&&Array.from(document.querySelectorAll('.data-table tbody td')).every(cell=>cell.dataset.label)&&document.querySelectorAll('[data-sort]').length===13`));
      if (view === 'pipeline') assert(size + ': todas as etapas acessíveis', await cdp.evaluate(`document.querySelectorAll('.pipeline-column').length===8&&Array.from(document.querySelectorAll('.pipeline-column')).every(column=>{const bounds=column.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth+1})`));
      if (view === 'configuracoes') await click('[data-theme-choice="light"]');
      if (screenshotDir && [320,1440].includes(width) && ['pipeline','leads'].includes(view)) await screenshot(size + '-' + view);
    }
    for (const [view, action] of [['hoje','new-lead'],['hoje','new-task'],['catalogo','new-catalog-item'],['financeiro','new-financial'],['hoje','export-contacts'],['hoje','open-backup'],['hoje','import-leads'],['hoje','start-prospect']]) {
      await click('.side-link[data-view="' + view + '"]');
      await click('[data-action="' + action + '"]');
      await checkLayout(size + ' modal ' + action);
      if (action === 'open-backup') {
        assert(size + ': botões do backup totalmente dentro do pop-up', await cdp.evaluate(`Array.from(document.querySelectorAll('.modal .data-actions .btn')).every(button=>{const bounds=button.getBoundingClientRect(),modal=document.querySelector('.modal').getBoundingClientRect();return bounds.left>=modal.left&&bounds.right<=modal.right&&button.scrollWidth<=button.clientWidth+1})`));
        if ([320,768,1440].includes(width)) await screenshot(size + '-backup');
      }
      if (action === 'start-prospect') {
        await click('button[form="prospect-filter-form"]');
        await checkLayout(size + ' sessão de prospecção');
        await click('[data-action="end-prospect"]');
      } else await click('[data-modal-close]');
    }
    await click('.side-link[data-view="leads"]');
    await click('[data-open-lead="fixture-0"]');
    for (const tab of ['resumo','historico','negociacao']) {
      await click('[data-drawer-tab="' + tab + '"]');
      await checkLayout(size + ' ficha ' + tab);
    }
    await click('[data-action="close-drawer"]');
    await click('.side-link[data-view="propostas"]');
    await click('[data-action="preview-proposal"]');
    await sleep(80);
    await checkLayout(size + ' prévia A4');
    assert(size + ': prévia inteira cabe na largura', await cdp.evaluate(`document.querySelector('.proposal-doc').getBoundingClientRect().width<=document.querySelector('.proposal-preview-stage').clientWidth`));
    await click('[data-action="back-proposals"]');
    await click('[data-action="new-proposal"]');
    await click('[data-action="add-custom-proposal-item"]');
    await checkLayout(size + ' editor da proposta');
    assert(size + ': prévia disponível também no celular', await cdp.evaluate(`getComputedStyle(document.querySelector('.proposal-live-preview')).display!=='none'&&document.querySelector('.proposal-doc').getBoundingClientRect().width<=document.querySelector('.proposal-live-preview').clientWidth`));
    await cdp.evaluate(`(() => {const description=document.querySelector('[data-item-field="description"]');description.value='Atualização da prévia';description.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await checkLayout(size + ' prévia atualizada');
    await click('[data-action="cancel-proposal"]');
    await cdp.evaluate(`(() => {const file=new File(['Empresa;Telefone;Email\\nEmpresa Exemplo;11911112222;teste@example.invalid'],'responsive.csv',{type:'text/csv'}),transfer=new DataTransfer();transfer.items.add(file);const input=document.getElementById('file-spreadsheet');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    if (!await waitFor(cdp, `!!document.getElementById('import-mapping-form')`)) throw new Error('Import mapping missing');
    await checkLayout(size + ' mapeamento de importação');
    await click('button[form="import-mapping-form"]');
    await checkLayout(size + ' segmento da importação');
    await cdp.evaluate(`(() => {const form=document.getElementById('import-segment-form');form.elements.businessSegmentId.value='seg_test';form.requestSubmit();})()`);
    await checkLayout(size + ' prévia de importação');
    assert(size + ': prévia importada preserva rótulos', await cdp.evaluate(`Array.from(document.querySelectorAll('.import-preview td')).every(cell=>cell.dataset.label)&&document.querySelectorAll('.import-preview td').length===4`));
    await click('[data-modal-close]');
    await click('.side-link[data-view="configuracoes"]');
    await click('[data-theme-choice="dark"]');
    await checkLayout(size + ' tema escuro');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:390,height:600,deviceScaleFactor:1,mobile:false });
  await click('.side-link[data-view="leads"]');
  const scrollBefore = await cdp.evaluate('window.scrollY');
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel',x:250,y:450,deltaX:0,deltaY:450 });
  await sleep(150);
  assert('Roda do mouse mantém rolagem vertical da página', await cdp.evaluate(`window.scrollY>${scrollBefore}`));
  await click('[data-open-lead="fixture-0"]');
  await sleep(350);
  const drawerBefore = await cdp.evaluate(`document.getElementById('lead-drawer').scrollTop`);
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel',x:250,y:450,deltaX:0,deltaY:450 });
  await sleep(300);
  assert('Roda do mouse mantém rolagem vertical da ficha', await cdp.evaluate(`document.getElementById('lead-drawer').scrollTop>${drawerBefore}`));
  await click('[data-action="close-drawer"]');
  await cdp.evaluate(`window.scrollTo(0,0);document.getElementById('view-root').focus()`);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown',key:'PageDown',code:'PageDown',windowsVirtualKeyCode:34 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp',key:'PageDown',code:'PageDown',windowsVirtualKeyCode:34 });
  await sleep(180);
  assert('Teclado mantém rolagem vertical sem barra', await cdp.evaluate('window.scrollY>0'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:390,height:600,deviceScaleFactor:1,mobile:true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled:true,maxTouchPoints:1 });
  await cdp.evaluate('window.scrollTo(0,0)');
  await sleep(300);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart',touchPoints:[{x:250,y:450}] });
  for (const position of [410,370,330,290,250,210,170]) {
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove',touchPoints:[{x:250,y:position}] });
    await sleep(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd',touchPoints:[] });
  await sleep(150);
  assert('Gesto de toque mantém rolagem vertical sem barra', await cdp.evaluate('window.scrollY>0'), JSON.stringify(await cdp.evaluate(`({scroll:window.scrollY,root:document.getElementById('view-root').scrollTop})`)));
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled:false });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:390,height:600,deviceScaleFactor:1,mobile:false });
  await sleep(350);
  await click('[data-action="export-contacts"]');
  await sleep(350);
  const modalBefore = await cdp.evaluate(`document.querySelector('.modal').scrollTop`);
  const modalPoint = await cdp.evaluate(`(() => {const bounds=document.querySelector('.modal').getBoundingClientRect();return {x:bounds.left+20,y:bounds.top+60}})()`);
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel',...modalPoint,deltaX:0,deltaY:450 });
  await sleep(150);
  assert('Roda do mouse mantém rolagem vertical do pop-up', await cdp.evaluate(`document.querySelector('.modal').scrollTop>${modalBefore}`));
  await cdp.send('Emulation.setEmulatedMedia', { media:'print' });
  assert('PDF mantém escala A4 independente da tela', await cdp.evaluate(`getComputedStyle(document.documentElement).width.includes('793')`));
  await cdp.send('Emulation.setEmulatedMedia', { media:'' });
  assert('Nenhuma exceção de execução', exceptions.length===0, JSON.stringify(exceptions));
} catch (error) {
  results.push({ name:'Execução completa',ok:false,detail:String(error.stack||error) });
} finally {
  await harness.close();
  const failed = results.filter(result=>!result.ok);
  console.log(JSON.stringify({ total:results.length,passed:results.length-failed.length,failed,exceptions },null,2));
  if (failed.length) process.exitCode=1;
}
