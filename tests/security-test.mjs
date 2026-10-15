import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const source = read('src/cloud.js').replace("import { createClient } from '@supabase/supabase-js';", 'const createClient = window.__createClient;')
  .replace("if (location.protocol !== 'file:') boot().catch(error => fatal(error));", '')
  + '\nglobalThis.testApi = {boot,start,flush,submit,signout,showAuth,showAccount,enrollMfa,get state(){return {pending,saving,blocked,revision,memory,started}}};';
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const account = { user: { id: 'test-user-a', email: 'a@example.invalid' } };
const doc = { version: 2, records: {}, extraLeads: [] };

function harness({ session = null, payload = null, revision = 0 } = {}) {
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
    location: { protocol: 'https:', pathname: '/', replace: () => { reloads++; }, reload: () => { reloads++; } },
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
check('Private local base is never adopted by a cloud account', () => { assert.equal(h.win.NEXO_BASE_LEADS.length, 0); assert.equal(h.node('estado-salvo').textContent, '{}'); assert.equal(h.win.NexoStorage.get('crm_climatizacao_sp_v1', 'empty'), 'empty'); });
check('New account starts empty', () => assert.equal(h.win.NexoStorage.get('crm_climatizacao_sp_v2', null), null));
await h.api.start(account);
check('Repeated start never initializes CRM twice', () => assert.equal(h.metrics.starts, 1));
h.win.NexoStorage.set('crm_climatizacao_sp_v2', doc); await h.api.flush();
check('Writes use server revision and wait for acknowledgement', () => { assert.equal(h.api.state.revision, 1); assert.equal(h.api.state.pending, null); assert.equal(h.events.at(-1).kind, 'saved'); });
check('Legacy keys cannot be written in cloud mode', () => assert.equal(h.win.NexoStorage.set('crm_climatizacao_sp_v1', doc), false));
h.mock.response = async () => ({ data: null, error: { code: 'network_error' } });
h.win.NexoStorage.set('crm_climatizacao_sp_v2', { ...doc, marker: 'offline' }); await h.api.flush();
check('Network failure retains changes and retries', () => { assert(h.api.state.pending.includes('offline')); assert.equal(h.events.at(-1).kind, 'error'); assert([...h.timers.values()].some(t => t.delay === 10000)); });
await h.api.signout();
check('Cannot silently sign out with unsaved changes', () => { assert.equal(h.metrics.signouts, 0); assert(h.api.state.blocked); assert(h.node('auth-root').innerHTML.includes('Baixar cópia')); });
await h.api.signout(true);
check('Discard requires explicit confirmation', () => assert.equal(h.metrics.signouts, 0));
h.confirm(); await h.api.signout(true);
check('Confirmed discard permits logout', () => assert.equal(h.metrics.signouts, 1));

h = harness({ session: account, payload: doc, revision: 8 }); await h.api.boot();
check('Cloud account restores only its server document', () => { assert.equal(h.api.state.revision, 8); assert.equal(h.win.NexoStorage.get('crm_climatizacao_sp_v2', null).version, 2); });
let resolveWrite;
h.mock.response = () => new Promise(resolve => { resolveWrite = resolve; });
h.win.NexoStorage.set('crm_climatizacao_sp_v2', { ...doc, marker: 'first' });
const writing = h.api.flush();
h.win.NexoStorage.set('crm_climatizacao_sp_v2', { ...doc, marker: 'second' });
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

check('Build excludes private leads, environment files and source files', () => {
  assert(existsSync(new URL('../dist/index.html', import.meta.url)));
  const files = readdirSync(new URL('../dist/', import.meta.url), { recursive: true }).map(String);
  assert(!files.some(f => /(^|[\\/])(data\.js|\.env.*|src|supabase|node_modules)$/.test(f)));
  assert(read('dist/assets/js/data.example.js').includes('NEXO_BASE_LEADS = []'));
  assert(read('dist/index.html').includes('assets/js/cloud.js'));
  assert(!read('dist/index.html').includes('assets/js/data.js'));
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
