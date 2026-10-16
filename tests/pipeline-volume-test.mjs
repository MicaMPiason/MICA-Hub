import assert from 'node:assert/strict';
import { launchBrowser,waitFor } from './helpers/browser.mjs';
import { crmFixture } from './fixtures/crm.mjs';
const exceptions=[],harness=await launchBrowser({document:crmFixture(1500),exceptions});
try{
  assert(await waitFor(harness.cdp,`!!document.querySelector('.metrics-grid')`,15000));
  const result=await harness.cdp.evaluate(`(() => {const start=performance.now();document.querySelector('[data-view="pipeline"]').click();document.querySelector('.pipeline-board-shell').getBoundingClientRect();return {elapsedMs:Math.round(performance.now()-start),cards:document.querySelectorAll('.pipeline-card').length,leads:window.MicaData.load().extraLeads.length}})()`);
  assert.equal(result.cards,1500);assert.equal(result.leads,1500);assert(result.elapsedMs<10000,'Render exceeded 10 second guard');assert.equal(exceptions.length,0);
  console.log(JSON.stringify({ok:true,...result,exceptions}));
}finally{await harness.close();}
