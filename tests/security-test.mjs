import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const source = read('src/cloud.js').replace("import { createClient } from '@supabase/supabase-js';", 'const createClient = window.__createClient;')
  .replace("boot().catch(error => fatal(error));", '')
  + '\nglobalThis.testApi = {boot,start,flush,submit,signout,showAuth,showAccount,enrollMfa,get state(){return {pending,saving,blocked,revision,memory,started}}};';
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const account = { user: { id: 'test-user-a', email: 'a@example.invalid' } };
const doc = { version: 2, records: {}, extraLeads: [] };

function harness({ session = null, payload = null, revision = 0, protocol = 'https:' } = {}) {
  const nodes = new Map(), events = [], timers = new Map(), calls = [];
  let timerId = 0, signouts = 0, starts = 0, reloads = 0, resetEmails = 0, confirmed = false;
  const listeners = {};
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '', innerHTML: '', disabled: false, dataset: {}, value: '', after() {}, querySelector: selector => node(id + selector) });
    return nodes.get(id);
  };
  const classes = new Set();
  const mock = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: fn => { mock.authEvent = fn; },
      signInWithPassword: async () => ({ data: { session: account }, error: null }),
      signUp: async () => ({ data: { session: account }, error: null }),
      signOut: async () => { signouts++; return { error: null }; },
      resetPasswordForEmail: async () => { resetEmails++; return { error: null }; },
      getUser: async () => ({ data: { user: account.user }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
        listFactors: async () => ({ data: { totp: [] }, error: null })
      }
    },
    rpc(name, params) {
      calls.push({ name, params });
      return { abortSignal: () => mock.response ? mock.response(name, params) : Promise.resolve({ data: name === 'load_crm' ? { ok: true, payload, revision } : { ok: true, revision: params.expected_revision + 1 }, error: null }) };
    }
  };
  const win = {
    MICA_SUPABASE: { url: 'https://example.supabase.co', publishableKey: 'test-public', siteUrl: 'https://micahub.vercel.app', emailRecoveryEnabled: false },
    __createClient: () => mock,
    dispatchEvent: event => events.push(event.detail),
    NEXO_BASE_LEADS: [{ nome: 'PRIVATE LOCAL DATA' }],
    NexoCRMApp: () => { starts++; }
  };
  const context = vm.createContext({
    window: win, document: {
      getElementById: node, body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
      createElement: () => node('created'), querySelectorAll: () => [],
      addEventListener: (name, fn) => { listeners[name] = fn; }
    },
    location: { protocol, pathname: '/', replace: () => { reloads++; }, reload: () => { reloads++; } },
    localStorage: {}, AbortSignal, Blob, URL,
    confirm: () => confirmed,
    CustomEvent: class { constructor(name, options) { this.detail = options.detail; } },
    FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => { listeners[name] = fn; }
  });
  vm.runInContext(source, context);
  return {
    api: context.testApi, win, mock, node, events, timers, calls, classes, listeners,
    confirm: () => { confirmed = true; },
    get metrics() { return { signouts, starts, reloads, resetEmails }; },
    submit: values => context.testApi.submit({ target: { id: 'auth-form', values, querySelector: () => node('submit') }, preventDefault() {}, stopImmediatePropagation() {} })
  };
}

let h = harness(); await h.api.boot();
check('Hosted app requires login', () => { assert(h.classes.has('auth-locked')); assert.equal(h.metrics.starts, 0); assert(h.node('auth-root').innerHTML.includes('Criar uma conta')); });
check('Google login is offered', () => assert.equal(h.node('created').textContent, 'Continuar com Google'));
await h.api.start(account);
check('Only the server document feeds the account', () => { assert.equal(JSON.stringify(h.win.MicaData.load()), '{}'); assert(!h.win.NexoStorage); });
check('New account starts empty', () => assert.equal(JSON.stringify(h.win.MicaData.load()), '{}'));
await h.api.start(account);
check('Repeated start never initializes CRM twice', () => assert.equal(h.metrics.starts, 1));
h.win.MicaData.save(doc); await h.api.flush();
check('Writes use server revision and wait for acknowledgement', () => { assert.equal(h.api.state.revision, 1); assert.equal(h.api.state.pending, null); assert.equal(h.events.at(-1).kind, 'saved'); });
check('Browser storage adapter no longer exists', () => assert(!h.win.NexoStorage));
h.mock.response = async () => ({ data: null, error: { code: 'network_error' } });
h.win.MicaData.save({ ...doc, marker: 'offline' }); await h.api.flush();
check('Network failure retains changes and retries', () => { assert(h.api.state.pending.includes('offline')); assert.equal(h.events.at(-1).kind, 'error'); assert([...h.timers.values()].some(t => t.delay === 10000)); });
await h.api.signout();
check('Cannot silently sign out with unsaved changes', () => { assert.equal(h.metrics.signouts, 0); assert(h.api.state.blocked); assert(h.node('auth-root').innerHTML.includes('Baixar cópia')); });
await h.api.signout(true);
check('Discard requires explicit confirmation', () => assert.equal(h.metrics.signouts, 0));
h.confirm(); await h.api.signout(true);
check('Confirmed discard permits logout', () => assert.equal(h.metrics.signouts, 1));

h = harness({ session: account, payload: doc, revision: 8 }); await h.api.boot();
check('Cloud account restores only its server document', () => { assert.equal(h.api.state.revision, 8); assert.equal(h.win.MicaData.load().version, 2); });
let resolveWrite;
h.mock.response = () => new Promise(resolve => { resolveWrite = resolve; });
h.win.MicaData.save({ ...doc, marker: 'first' });
const writing = h.api.flush();
h.win.MicaData.save({ ...doc, marker: 'second' });
resolveWrite({ data: { ok: true, revision: 9 }, error: null }); await writing;
check('Changes made during a save remain queued', () => { assert(h.api.state.pending.includes('second')); assert.equal(h.events.at(-1).kind, 'saving'); });
h.mock.response = async () => ({ data: { ok: false, error: 'conflict', revision: 10 }, error: null }); await h.api.flush();
check('Concurrent session conflict never overwrites server data', () => { assert(h.api.state.blocked); assert(h.api.state.pending.includes('second')); assert(h.node('auth-root').innerHTML.includes('outra sessão')); });

h = harness(); await h.api.boot(); h.api.showAuth('signup'); await h.submit({ email: 'new@example.invalid', name: 'Pessoa', password: 'Example-123456' });
check('Password signup session starts the CRM without an email step', () => assert.equal(h.metrics.starts, 1));
h = harness(); await h.api.boot(); await h.submit({ email: 'a@example.invalid', password: 'Example-123456' });
check('Password login session starts the CRM', () => assert.equal(h.metrics.starts, 1));
h = harness(); await h.api.boot(); h.api.showAuth('reset'); await h.submit({ email: 'a@example.invalid' });
check('No email is sent before SMTP is configured', () => { assert.equal(h.metrics.resetEmails, 0); assert(h.node('auth-root').innerHTML.includes('após configurar')); });
h.mock.auth.signInWithPassword = async () => ({ error: { code: 'invalid_credentials' } }); await h.submit({ email: 'keep@example.invalid', password: 'wrong' });
check('Errors preserve email and explain the failure', () => { assert.equal(h.node('auth-root[name="email"]').value, 'keep@example.invalid'); assert(h.node('auth-root').innerHTML.includes('incorretos')); });
h = harness({ session: account }); h.mock.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }); await h.api.boot();
check('MFA gate blocks data loading until verified', () => { assert.equal(h.metrics.starts, 0); assert.equal(h.calls.length, 0); assert(h.node('auth-root').innerHTML.includes('autenticador')); });

h = harness({ protocol: 'file:' });
await assert.rejects(h.api.boot(), /O MICA Hub é online/);
check('File URLs cannot start an offline application', () => { assert.equal(h.metrics.starts, 0); assert.equal(h.calls.length, 0); assert(!h.win.MicaData); });
check('CRM controller refuses initialization without an authenticated adapter', () => {
  const unauthenticated = vm.createContext({ window: {} });
  vm.runInContext(read('assets/js/app.js'), unauthenticated);
  assert.throws(() => unauthenticated.window.NexoCRMApp(), /Entre na sua conta/);
});
h = harness({ session: account, payload: doc }); await h.api.boot();
h.win.MicaData.save({ ...doc, extraLeads: [{ id: 'synthetic' }] });
const copy = h.win.MicaData.load(); copy.extraLeads[0].id = 'changed-copy';
check('Loaded documents cannot mutate the synchronization snapshot', () => assert.equal(h.win.MicaData.load().extraLeads[0].id, 'synthetic'));
h.mock.authEvent('SIGNED_OUT', null);
check('Account changes clear cached business data and block further writes', () => {
  assert(h.api.state.blocked); assert.equal(h.api.state.memory, null); assert.equal(h.api.state.pending, null);
  assert.equal(h.win.MicaData.save(doc), false); assert.equal(h.metrics.reloads, 1);
});
check('Legacy business storage and HTML-app export are absent from production source', () => {
  const app = read('assets/js/app.js'), html = read('index.html'), build = read('scripts/build.mjs');
  assert(!/crm_climatizacao_sp|estado-salvo|exportHTML|export-html|NEXO_BASE_LEADS|NexoStorage/.test(app + html));
  assert(!/data\.example|storage\.js|cp\('dist\/assets\/js\/cloud/.test(build));
  assert(read('.gitignore').includes('/backups/')); assert(read('.vercelignore').includes('backups/'));
});

check('Build excludes private leads, environment files and source files', () => {
  assert(existsSync(new URL('../dist/index.html', import.meta.url)));
  const files = readdirSync(new URL('../dist/', import.meta.url), { recursive: true }).map(String);
  assert(!files.some(f => /(^|[\\/])(data\.js|\.env.*|src|supabase|node_modules)$/.test(f)));
  assert(!files.some(f => /(^|[\\/])(data(?:\.example)?\.js|storage\.js|backups|tests)$/.test(f)));
  assert(read('dist/index.html').includes('assets/js/cloud.js'));
  assert(!/estado-salvo|assets\/js\/(data|storage)\.js/.test(read('dist/index.html')));
  for (const match of read('dist/index.html').matchAll(/(?:src|href)="(assets\/[^\"]+)"/g)) {
    assert(existsSync(new URL('../dist/' + decodeURIComponent(match[1]), import.meta.url)), match[1]);
  }
});
check('Public configuration contains no privileged keys', () => { const config = read('assets/js/supabase-config.js'); assert(!/service_role|sb_secret_|client_secret|eyJ/.test(config)); });
check('Security headers deny inline scripts and framing', () => { const headers = JSON.parse(read('vercel.json')).headers[0].headers; const csp = headers.find(h => h.key === 'Content-Security-Policy').value; assert(csp.includes("script-src 'self';")); assert(csp.includes("frame-ancestors 'none'")); });

if (process.argv.includes('--live')) {
  const cfg = read('assets/js/supabase-config.js');
  const url = cfg.match(/https:\/\/[a-z]+\.supabase\.co/)[0];
  const apikey = cfg.match(/sb_publishable_[\w-]+/)[0];
  const settings = await fetch(url + '/auth/v1/settings', { headers: { apikey }, signal: AbortSignal.timeout(15000) }).then(r => r.json());
  check('Live Google and password auth enabled; email confirmation disabled', () => { assert.equal(settings.external.google, true); assert.equal(settings.external.email, true); assert.equal(settings.mailer_autoconfirm, true); assert.equal(settings.external.anonymous_users, false); });
  for (const name of ['load_crm', 'save_crm']) {
    const response = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey, 'Content-Type': 'application/json' }, body: JSON.stringify(name === 'save_crm' ? { document: doc, expected_revision: 0 } : {}), signal: AbortSignal.timeout(15000) });
    check('Live API denies anonymous ' + name, () => assert([401,403].includes(response.status), String(response.status)));
  }
  const privateResponse = await fetch(url + '/rest/v1/crm_documents?select=user_id', { headers: { apikey, 'Accept-Profile': 'private' }, signal: AbortSignal.timeout(15000) });
  check('Private schema not exposed through Data API', () => assert([403,404,406].includes(privateResponse.status)));
  const response = await fetch(url + '/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fmicahub.vercel.app%2F', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const google = new URL(response.headers.get('location'));
  check('Live OAuth redirects to Google with correct Supabase callback', () => { assert.equal(google.hostname, 'accounts.google.com'); assert.equal(google.searchParams.get('redirect_uri'), url + '/auth/v1/callback'); assert(google.searchParams.get('client_id')); });
}
console.log(`PASS: ${passed} auth, synchronization, build and security checks. No real accounts created.`);
