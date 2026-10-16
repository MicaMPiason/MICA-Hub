import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser, sleep, waitFor } from "./helpers/browser.mjs";
import { crmFixture } from "./fixtures/crm.mjs";
const visualDir = process.env.MICA_SIDEBAR_SCREENSHOTS;
if (visualDir) mkdirSync(visualDir, {recursive:true});
const results = [], exceptions = [];
const harness = await launchBrowser({document:crmFixture(0),exceptions});
const { cdp } = harness;
function assert(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

const q = value => JSON.stringify(value);
async function click(selector) {
  const point = await cdp.evaluate(`(() => {const n=document.querySelector(${q(selector)});if(!n||n.closest('[hidden],[inert]'))return null;n.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if (!point) throw new Error("Control not reachable: " + selector);
  await cdp.send("Input.dispatchMouseEvent", {type:"mousePressed",...point,button:"left",clickCount:1});
  await cdp.send("Input.dispatchMouseEvent", {type:"mouseReleased",...point,button:"left",clickCount:1});
  await sleep(300);
}
async function key(key, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", {type:"keyDown",key,modifiers});
  await cdp.send("Input.dispatchKeyEvent", {type:"keyUp",key,modifiers});
}
async function viewport(width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
  await sleep(350);
}
async function capture(name) {
  if (!visualDir) return;
  const shot = await cdp.send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  writeFileSync(join(visualDir, name+".png"), Buffer.from(shot.data,"base64"));
}
try {
  await viewport(1440,960);
  assert("Hub inicia sem dados pessoais", await waitFor(cdp, `!!document.querySelector(".metrics-grid") && window.MicaData.load().extraLeads.length===0`));
  assert("Sidebar expandida no desktop", await cdp.evaluate(`Math.round(document.querySelector(".sidebar").getBoundingClientRect().width)===248 && !document.querySelector(".sidebar").inert`));
  assert("Todos os módulos do Hub preservados", await cdp.evaluate(`["hoje","pipeline","leads","agenda","dashboard","relatorios","propostas","catalogo","financeiro","configuracoes"].every(v=>document.querySelector('.side-link[data-view="'+v+'"]'))`));
  assert("Conta da sessão é exibida", await cdp.evaluate(`!document.getElementById("cloud-account").hidden`));
  await cdp.evaluate(`document.querySelector('[data-view="configuracoes"]').click();document.querySelector('[data-theme-choice="light"]').click();document.querySelector('[data-view="hoje"]').click()`);
  await sleep(250);
  const lightPalette = await cdp.evaluate(`({body:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector(".sidebar")).backgroundColor,active:getComputedStyle(document.querySelector(".side-link.is-active")).backgroundColor})`);
  assert("Paleta clara original preservada", lightPalette.body==="rgb(244, 246, 241)" && lightPalette.sidebar==="rgb(255, 255, 255)" && lightPalette.active==="rgb(17, 22, 17)", JSON.stringify(lightPalette));
  await cdp.evaluate(`document.getElementById("cloud-account").hidden=false;document.querySelector("[data-user-email]").textContent="demo@exemplo.invalid"`);
  await sleep(300);
  await capture("sidebar-desktop");
  await click(".sidebar-trigger");
  assert("Botão recolhe sidebar para 76px", await cdp.evaluate(`Math.round(document.querySelector(".sidebar").getBoundingClientRect().width)===76 && document.querySelector(".sidebar-trigger").getAttribute("aria-expanded")==="false"`));
  assert("Submenus não recebem foco quando recolhidos", await cdp.evaluate(`document.getElementById("sidebar-crm").hidden && document.getElementById("sidebar-documents").hidden`));
  await capture("sidebar-compacta");
  await click('[data-sidebar-group="documents"]');
  assert("Grupo recolhido expande a sidebar e abre submenu", await cdp.evaluate(`document.querySelector(".app-shell").dataset.sidebarState==="expanded" && !document.getElementById("sidebar-documents").hidden`));
  await click('[data-view="propostas"]');
  assert("Propostas abre pelo submenu", await cdp.evaluate(`document.getElementById("page-title").textContent==="Propostas" && document.querySelector('[data-view="propostas"]').getAttribute("aria-current")==="page"`));
  await click('[data-sidebar-group="documents"]');
  assert("Grupo ativo pode ser fechado", await cdp.evaluate(`document.getElementById("sidebar-documents").hidden && document.querySelector('[data-sidebar-group="documents"]').classList.contains("is-group-active")`));
  await key("b",2);
  await sleep(300);
  assert("Ctrl+B recolhe a navegação", await cdp.evaluate(`document.querySelector(".app-shell").dataset.sidebarState==="collapsed"`));
  await key("b",2);
  await sleep(300);
  await click('[data-sidebar-search]');
  assert("Busca rápida foca a pesquisa real", await cdp.evaluate(`document.activeElement.id==="global-search"`));
  for (const view of ["leads","pipeline","agenda","dashboard","relatorios","financeiro","catalogo","configuracoes","hoje"]) {
    const group = ["leads","pipeline"].includes(view) ? "crm" : view==="catalogo" ? "documents" : null;
    if (group && await cdp.evaluate(`document.querySelector('[data-sidebar-group="${group}"]').getAttribute("aria-expanded")==="false"`)) await click('[data-sidebar-group="'+group+'"]');
    await click('[data-view="'+view+'"]');
    assert("Navegação real: "+view, await cdp.evaluate(`document.querySelector('.side-link[aria-current="page"]').dataset.view===${q(view)} && document.getElementById("view-root").childElementCount>0`));
  }
  await click('[data-view="configuracoes"]');
  await click('[data-theme-choice="dark"]');
  assert("Paleta escura original preservada", await cdp.evaluate(`getComputedStyle(document.body).backgroundColor==="rgb(9, 10, 9)" && getComputedStyle(document.querySelector(".sidebar")).backgroundColor==="rgb(7, 8, 7)" && getComputedStyle(document.querySelector(".side-link.is-active")).backgroundColor==="rgb(244, 245, 241)"`));
  await click('[data-theme-choice="light"]');
  await click('[data-view="hoje"]');
  await viewport(1024,768);
  assert("Layout não vaza em notebook de 1024px", await cdp.evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector(".topbar").scrollWidth<=document.querySelector(".topbar").clientWidth`));
  await viewport(900,760);
  assert("Layout não vaza em tablet de 900px", await cdp.evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector(".topbar").scrollWidth<=document.querySelector(".topbar").clientWidth`));
  await viewport(390,844);
  assert("Menu móvel começa fechado e sem foco", await cdp.evaluate(`document.querySelector(".sidebar").inert && document.querySelector(".sidebar").getAttribute("aria-hidden")==="true" && !document.querySelector(".workspace").inert`));
  await click(".sidebar-trigger");
  await capture("sidebar-mobile");
  const drawerState = await cdp.evaluate(`({open:document.querySelector(".app-shell").dataset.mobileOpen,modal:document.querySelector(".sidebar").getAttribute("aria-modal"),inert:document.querySelector(".workspace").inert,position:document.body.style.position,focus:document.activeElement.className,trigger:document.querySelector(".sidebar-trigger").getBoundingClientRect().toJSON()})`);
  assert("Menu móvel abre como diálogo e bloqueia fundo", drawerState.open==="true" && drawerState.modal==="true" && drawerState.inert && drawerState.position==="fixed" && drawerState.focus==="sidebar-close",JSON.stringify(drawerState));
  await cdp.evaluate(`document.querySelector(".brand-mark").focus()`);
  await key("Tab",8);
  assert("Shift+Tab mantém foco dentro do menu", await cdp.evaluate(`document.querySelector(".sidebar").contains(document.activeElement) && document.activeElement.matches("[data-cloud-signout]")`));
  await key("Tab");
  assert("Tab retorna ao primeiro controle", await cdp.evaluate(`document.activeElement.matches(".brand-mark")`));
  await key("Escape");
  assert("Escape fecha menu, libera fundo e restaura foco", await cdp.evaluate(`document.querySelector(".sidebar").inert && !document.querySelector(".workspace").inert && document.body.style.position==="" && document.activeElement.matches(".sidebar-trigger")`));
  await click(".sidebar-trigger");
  await click('[data-view="financeiro"]');
  assert("Selecionar módulo fecha menu e navega", await cdp.evaluate(`document.getElementById("page-title").textContent==="Financeiro" && document.querySelector(".sidebar").inert && !document.querySelector(".workspace").inert`));
  await click(".sidebar-trigger");
  await cdp.send("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[{x:370,y:400}]});
  await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
  await sleep(300);
  assert("Toque no fundo fecha o menu", await cdp.evaluate(`document.querySelector(".app-shell").dataset.mobileOpen==="false"`));
  await viewport(320,568);
  await click(".sidebar-trigger");
  assert("Menu cabe a 320px sem rolagem horizontal", await cdp.evaluate(`document.querySelector(".sidebar").getBoundingClientRect().right<=innerWidth && document.querySelector(".sidebar-content").scrollWidth<=document.querySelector(".sidebar-content").clientWidth && document.querySelector(".sidebar-footer").getBoundingClientRect().bottom<=innerHeight`));
  await viewport(1200,900);
  assert("Voltar ao desktop libera foco e rolagem", await cdp.evaluate(`!document.querySelector(".workspace").inert && !document.querySelector(".sidebar").inert && document.body.style.position==="" && !document.querySelector(".sidebar").hasAttribute("aria-modal")`));
  await cdp.send("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  assert("Movimento reduzido respeitado", await cdp.evaluate(`getComputedStyle(document.querySelector(".app-shell")).transitionDuration==="0s" && getComputedStyle(document.querySelector(".sidebar-indicator")).transitionDuration==="0s"`));
  assert("Topo tem um único botão para ações de leads", await cdp.evaluate(`document.querySelectorAll('.topbar [data-action="toggle-lead-menu"]').length===1 && !document.querySelector('[data-action="open-data"]') && !document.querySelector('.topbar>.icon-btn')`));
  await click('[data-action="toggle-lead-menu"]');
  assert("Menu reúne cadastro, importação e exportação sem backup", await cdp.evaluate(`!document.getElementById("lead-actions-menu").hidden && document.getElementById("lead-actions-trigger").getAttribute("aria-expanded")==="true" && document.activeElement.dataset.action==="new-lead" && document.querySelectorAll('#lead-actions-menu [role="menuitem"]').length===4 && !document.querySelector('#lead-actions-menu [data-action="backup-json"]')`));
  await key("ArrowUp");
  assert("Seta para cima retorna ao último item", await cdp.evaluate(`document.activeElement.dataset.action==="export-contacts"`));
  await key("Home");
  assert("Home seleciona o cadastro individual", await cdp.evaluate(`document.activeElement.dataset.action==="new-lead"`));
  await key("End");
  assert("End seleciona a extração com filtros", await cdp.evaluate(`document.activeElement.dataset.action==="export-contacts"`));
  await key("Escape");
  assert("Escape fecha o menu e restaura o foco", await cdp.evaluate(`document.getElementById("lead-actions-menu").hidden && document.activeElement.id==="lead-actions-trigger"`));
  await key("ArrowDown");
  assert("Menu abre pelo teclado", await cdp.evaluate(`!document.getElementById("lead-actions-menu").hidden && document.activeElement.dataset.action==="new-lead"`));
  await click('#lead-actions-menu [data-action="new-lead"]');
  assert("Cadastro individual abre pelo novo menu", await cdp.evaluate(`!!document.getElementById("new-lead-form") && document.getElementById("lead-actions-menu").hidden`));
  await click('[data-modal-close]');
  await click('[data-action="toggle-lead-menu"]');
  await click('#lead-actions-menu [data-action="import-leads"]');
  assert("Importação abre pelo novo menu", await cdp.evaluate(`!!document.querySelector('[data-action="import-paste"]') && document.getElementById("lead-actions-menu").hidden`));
  await click('[data-modal-close]');
  await click('[data-action="toggle-lead-menu"]');
  await click('#lead-actions-menu [data-action="export-contacts"]');
  assert("Extração mantém todos os filtros", await cdp.evaluate(`!!document.getElementById("contact-export-form")?.elements.score && !!document.getElementById("contact-export-form")?.elements.contactStatus && !!document.getElementById("contact-export-form")?.elements.site`));
  await click('[data-modal-close]');
  await click('[data-view="configuracoes"]');
  assert("Configurações não repete os botões de leads e backup", await cdp.evaluate(`!document.querySelector('#view-root [data-action="backup-json"],#view-root [data-action="restore-backup"],#view-root [data-action="import-leads"],#view-root [data-action="export-csv"]')`));
  await viewport(1440,900);
  await click('[data-action="toggle-lead-menu"]');
  await capture("lead-actions-desktop");
  await viewport(390,844);
  await capture("lead-actions-mobile");
  const menuMobile = await cdp.evaluate(`(() => {const menu=document.getElementById("lead-actions-menu"),r=menu.getBoundingClientRect(),label=getComputedStyle(document.getElementById("lead-actions-trigger"));return {hidden:menu.hidden,left:r.left,right:r.right,width:innerWidth,font:label.fontSize}})()`);
  assert("Menu móvel mantém os textos e cabe na tela", !menuMobile.hidden && menuMobile.left>=0 && menuMobile.right<=menuMobile.width && parseFloat(menuMobile.font)>=12,JSON.stringify(menuMobile));
  await click('.sidebar-trigger');
  assert("Abrir sidebar fecha o menu de leads", await cdp.evaluate(`document.getElementById("lead-actions-menu").hidden && document.querySelector('.app-shell').dataset.mobileOpen==="true"`));
  await click('[data-action="open-backup"]');
  assert("Backup da sidebar fica separado da importação de leads", await cdp.evaluate(`document.querySelector('.modal-head h2')?.textContent==="Backup do Hub" && !!document.querySelector('.modal [data-action="restore-backup"]') && !document.querySelector('.modal [data-action="import-leads"]') && document.querySelector('.backup-description')?.textContent.includes("configurações")`));
  await capture("backup-hub-mobile");
  assert("Backups de dados continuam disponíveis sem modo offline", await cdp.evaluate(`!!document.querySelector('[data-action="backup-json"]') && !document.querySelector('.modal [data-action="export-csv"]') && !document.querySelector('[data-action="export-html"]')`));
  assert("Sem erros de execução", exceptions.length===0, exceptions.join(" | "));
  console.log(JSON.stringify({ok:true,passed:results.length,results},null,2));
} catch(error) {
  console.error(JSON.stringify({ok:false,error:error.message,exceptions,results},null,2));
  process.exitCode=1;
} finally {
 await harness.close();
}
