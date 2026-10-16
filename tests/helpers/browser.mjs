import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = fileURLToPath(new URL('../../', import.meta.url));

class CDP {
  constructor(url, exceptions) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.exceptions = exceptions;
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data), request = this.pending.get(msg.id);
      if (request) {
        this.pending.delete(msg.id);
        msg.error ? request.reject(new Error(msg.error.message)) : request.resolve(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') this.exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

// This adapter exists only on the isolated test server, never in the app/build.
function mockCloud(payload) {
  let memory = payload, writes = Promise.resolve(), pending = 0;
  window.MicaCloud = { active: true, userId:'fixture-user', flush: () => writes, get pending() { return pending > 0; } };
  window.MicaData = {
    load: () => structuredClone(memory),
    async commit(value) {
      await writes;
      if (window.__failCommercialWrite) throw new Error('Simulated connection failure');
      if (window.__commercialWriteDelay) await new Promise(resolve=>setTimeout(resolve,window.__commercialWriteDelay));
      const response=await fetch('/__test__/document',{method:'PUT',body:JSON.stringify(value)});
      if(!response.ok)throw new Error('Test persistence failed');
      memory=structuredClone(value);return true;
    },
    save(value) {
      memory = structuredClone(value);
      const snapshot = JSON.stringify(memory); pending++;
      writes = writes.then(async () => {
        const result = await fetch('/__test__/document', { method: 'PUT', body: snapshot });
        if (!result.ok) throw new Error('Test persistence failed');
        pending--;
        window.dispatchEvent(new CustomEvent('mica-sync', { detail: { kind: pending ? 'saving' : 'saved', message: pending ? 'Salvando…' : 'Salvo na nuvem' } }));
      });
      return true;
    }
  };
  document.body.classList.remove('auth-locked'); document.getElementById('auth-root').hidden = true;
  document.getElementById('cloud-account').hidden = false;
  document.querySelector('[data-user-email]').textContent = 'demo@example.invalid';
  window.NexoCRMApp();
}

export async function launchBrowser({ document, exceptions = [] }) {
  let stored = structuredClone(document), browser, cdp;
  const profile = mkdtempSync(path.join(tmpdir(), 'mica-browser-test-'));
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (pathname === '/__test__/document' && request.method === 'PUT') {
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('Too large'); chunks.push(chunk);
        }
        stored = JSON.parse(Buffer.concat(chunks).toString()); response.writeHead(204).end(); return;
      }
      if (pathname === '/assets/js/cloud.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end('(' + mockCloud.toString() + ')(' + JSON.stringify(stored).replaceAll('<', '\\u003c') + ');'); return;
      }
      if (pathname === '/assets/js/charts.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(await readFile(path.join(root, 'dist/assets/js/charts.js'))); return;
      }
      if (pathname !== '/' && !/^\/assets\/(css\/[\w-]+\.css|js\/[\w-]+\.js|Logotipo[^/]+\.png)$/.test(decodeURIComponent(pathname))) {
        response.writeHead(404).end(); return;
      }
      const file = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
      response.setHeader('Content-Type', (mime[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
      response.end(await readFile(path.join(root, file)));
    } catch { response.writeHead(404).end(); }
  });
  async function close() {
    cdp?.close(); browser?.kill(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await sleep(200);
    if (path.dirname(profile) !== tmpdir() || !path.basename(profile).startsWith('mica-browser-test-')) throw new Error('Unsafe test cleanup');
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    const edge = process.env.MICA_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, url], { stdio: 'ignore', windowsHide: true });
    let endpoint;
    for (let i = 0; i < 80 && !endpoint; i++) {
      try {
        const port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        const pages = await fetch('http://127.0.0.1:' + port + '/json').then(r => r.json());
        endpoint = pages.find(p => p.type === 'page')?.webSocketDebuggerUrl;
      } catch { /* Browser is still starting. */ }
      if (!endpoint) await sleep(100);
    }
    if (!endpoint) throw new Error('O navegador de testes não iniciou.');
    cdp = new CDP(endpoint, exceptions); await cdp.open();
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    return { cdp, profile, url, close };
  } catch (error) { await close(); throw error; }
}

export async function waitFor(cdp, expression, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await cdp.evaluate("!!window.MicaData && (" + expression + ")")) return true;
    await sleep(80);
  }
  return false;
}
