import { createClient } from '@supabase/supabase-js';

const KEY = 'crm_climatizacao_sp_v2';
let client, userId, started = false, revision = 0, memory = null, pending = null;
let saving = false, timer, blocked = false, authMode = 'login', authBusy = false;
let enrollmentId = null, starting = false;
const root = () => document.getElementById('auth-root');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function status(kind, message) {
  window.dispatchEvent(new CustomEvent('mica-sync', { detail: { kind, message } }));
}
function errorText(error) {
  const code = error?.code;
  if (code === 'invalid_credentials') return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed') return 'Confirme seu e-mail antes de entrar.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'Muitas solicitações. Aguarde alguns minutos e tente novamente.';
  if (code === 'weak_password') return 'Use uma senha com 12 caracteres, maiúsculas, minúsculas, número e símbolo.';
  if (code === 'email_address_not_authorized') return 'O envio de e-mails precisa ser configurado pelo administrador do MICA Hub.';
  if (code === 'provider_disabled') return 'O acesso com Google ainda precisa ser habilitado pelo administrador.';
  if (code === 'user_already_exists') return 'Já existe uma conta com esse e-mail. Entre na sua conta.';
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'Confira o endereço de e-mail informado.';
  if (code === 'mfa_verification_failed') return 'Código inválido ou expirado. Digite o código atual do autenticador.';
  return 'Não foi possível concluir. Verifique sua conexão e tente novamente.';
}
function showAuth(mode = 'login', message = '', isError = false) {
  authMode = mode;
  document.body.classList.add('auth-locked');
  root().hidden = false;
  const signup = mode === 'signup', reset = mode === 'reset', recover = mode === 'recover', mfa = mode === 'mfa';
  const title = signup ? 'Crie sua conta' : reset ? 'Recuperar acesso' : recover ? 'Defina uma nova senha' : mfa ? 'Confirme seu acesso' : 'Seu comercial, em um só lugar.';
  root().innerHTML = `<section class="auth-card" aria-label="Acesso ao MICA Hub"><div class="auth-brand">MICA<span>+</span> Hub</div><h1>${title}</h1><p class="auth-description">${mfa ? 'Digite o código do seu aplicativo autenticador.' : 'Entre com sua conta para acessar seus leads, propostas e resultados.'}</p><form id="auth-form"><div class="auth-fields">${signup ? '<label>Seu nome<input class="control" name="name" required maxlength="80" autocomplete="name"></label>' : ''}${!recover && !mfa ? '<label>E-mail<input class="control" type="email" name="email" required maxlength="254" autocomplete="email"></label>' : ''}${!reset && !mfa ? `<label>${recover ? 'Nova senha' : 'Senha'}<input class="control" type="password" name="password" required ${signup || recover ? 'minlength="12"' : ''} maxlength="128" autocomplete="${signup || recover ? 'new-password' : 'current-password'}"></label>` : ''}${signup || recover ? '<p class="auth-hint">Pelo menos 12 caracteres, com maiúsculas, minúsculas, número e símbolo.</p>' : ''}${mfa ? '<label>Código de verificação<input class="control" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>' : ''}</div><p id="auth-message" role="status" class="auth-message ${isError ? 'is-error' : ''}">${escape(message)}</p><button class="btn btn-primary btn-wide" type="submit">${signup ? 'Criar conta' : reset ? 'Enviar link de recuperação' : recover ? 'Salvar nova senha' : mfa ? 'Verificar código' : 'Entrar'}</button></form><div class="auth-links">${!recover && !mfa ? `<button type="button" data-auth-mode="${signup ? 'login' : 'signup'}">${signup ? 'Já tenho conta' : 'Criar uma conta'}</button><button type="button" data-auth-mode="${reset ? 'login' : 'reset'}">${reset ? 'Voltar ao login' : 'Esqueci minha senha'}</button>` : '<button type="button" data-cloud-signout>Voltar ao login</button>'}</div><p class="auth-privacy">Seus dados ficam privados na sua conta.</p></section>`;
  if (mode === 'login' || mode === 'signup') {
    const googleButton = document.createElement('button');
    googleButton.type = 'button'; googleButton.className = 'btn btn-wide auth-google';
    googleButton.dataset.cloudGoogle = ''; googleButton.textContent = 'Continuar com Google';
    root().querySelector('.auth-description').after(googleButton);
  }
}
function fatal(error) {
  blocked = true;
  document.body.classList.add('auth-locked');
  if (!root()) return;
  root().hidden = false;
  root().innerHTML = `<section class="auth-card"><div class="auth-brand">MICA<span>+</span> Hub</div><h1>Não foi possível sincronizar</h1><p>${escape(error?.message || 'Verifique sua conexão e recarregue para tentar novamente.')}</p>${memory ? '<button class="btn" data-cloud-backup>Baixar cópia das alterações</button>' : ''}<button class="btn btn-primary" data-cloud-reload>Recarregar</button><button class="btn" data-cloud-signout>Sair da conta</button>${pending ? '<button class="btn" data-cloud-discard>Descartar alterações pendentes e sair</button>' : ''}</section>`;
  status('error', 'Alterações não sincronizadas');
}
async function rpc(name, params) {
  const { data, error } = await client.rpc(name, params).abortSignal(AbortSignal.timeout(20000));
  if (error) throw error;
  if (!data?.ok) {
    const failure = new Error(data?.error === 'conflict' ? 'A base foi alterada em outra sessão. Baixe uma cópia das suas alterações antes de recarregar para evitar perda de dados.' : data?.error === 'rate_limit' ? 'Limite de solicitações atingido. Aguarde um minuto.' : 'A base não pôde ser salva. O limite é de 10 MB por conta. Baixe uma cópia antes de recarregar.');
    failure.code = data?.error;
    throw failure;
  }
  return data;
}
async function flush() {
  clearTimeout(timer);
  timer = null;
  if (saving || blocked || !pending) return;
  saving = true;
  const snapshot = pending;
  pending = null;
  status('saving', 'Salvando na nuvem…');
  try {
    const result = await rpc('save_crm', { document: JSON.parse(snapshot), expected_revision: revision });
    revision = result.revision;
    status(pending ? 'saving' : 'saved', pending ? 'Salvando alterações…' : 'Salvo na nuvem');
  } catch (error) {
    pending = pending || snapshot;
    if (['conflict', 'invalid_document', 'PT401', 'PT403', 'PGRST301'].includes(error.code)) fatal(error);
    else {
      status('error', 'Sem sincronização — tente novamente');
      timer = setTimeout(flush, error.code === 'rate_limit' ? 61000 : 10000);
    }
  } finally {
    saving = false;
    if (pending && !blocked && !timer) timer = setTimeout(flush, 1500);
  }
}
async function start(session) {
  if (started || starting) return;
  if (!session?.user) { showAuth(); return; }
  starting = true;
  try {
  userId = session.user.id;
  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') { showAuth('mfa'); return; }
  const data = await rpc('load_crm');
  revision = data.revision;
  memory = data.payload ? JSON.stringify(data.payload) : null;
  window.NEXO_BASE_LEADS = [];
  document.getElementById('estado-salvo').textContent = '{}';
  window.MicaCloud = { active: true, flush, get pending() { return !!pending || saving; } };
  window.NexoStorage = {
    get(key, fallback) { return key === KEY && memory ? JSON.parse(memory) : fallback; },
    set(key, value) {
      if (key !== KEY || blocked) return false;
      memory = JSON.stringify(value);
      pending = memory;
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; flush(); }, 1500);
      return true;
    },
    remove() { return false; }
  };
  started = true;
  root().hidden = true;
  document.body.classList.remove('auth-locked');
  document.querySelectorAll('[data-user-email]').forEach(node => { node.textContent = session.user.email; });
  document.getElementById('cloud-account').hidden = false;
  window.NexoCRMApp();
  status(pending ? 'saving' : 'saved', pending ? 'Salvando na nuvem…' : 'Salvo na nuvem');
  } finally { starting = false; }
}
async function submit(event) {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (authBusy) return;
  authBusy = true;
  const mode = authMode, form = event.target, button = form.querySelector('[type="submit"]');
  button.disabled = true;
  document.getElementById('auth-message').textContent = '';
  const fd = new FormData(form), email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || '');
  const redirectTo = window.MICA_SUPABASE.siteUrl + '/';
  try {
    if (mode === 'signup') {
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { display_name: String(fd.get('name') || '').trim() } } });
      if (error) throw error;
      if (data.session) await start(data.session);
      else showAuth('login', 'Cadastro recebido. Entre com sua conta para continuar.');
    } else if (mode === 'reset') {
      if (!window.MICA_SUPABASE.emailRecoveryEnabled) {
        showAuth('login', 'A recuperação por e-mail estará disponível após configurar o remetente do MICA Hub.');
        return;
      }
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      showAuth('login', 'Se existir uma conta para esse e-mail, enviaremos um link de recuperação.');
    } else if (mode === 'recover') {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      await client.auth.signOut();
      location.replace(location.pathname);
    } else if (mode === 'enroll') {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: enrollmentId, code: String(fd.get('code') || '') });
      if (error) throw error;
      enrollmentId = null;
      await showAccount('Verificação em duas etapas ativada.');
    } else if (mode === 'mfa') {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      const factor = data.totp.find(item => item.status === 'verified');
      if (!factor) throw new Error('Missing MFA factor');
      const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: String(fd.get('code') || '') });
      if (verifyError) throw verifyError;
      const { data: { session } } = await client.auth.getSession();
      await start(session);
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await start(data.session);
    }
  } catch (error) {
    if (mode === 'enroll') document.getElementById('auth-message').textContent = 'Código inválido ou expirado. Tente novamente.';
    else {
      showAuth(mode, errorText(error), true);
      const emailInput = root().querySelector('[name="email"]');
      const nameInput = root().querySelector('[name="name"]');
      if (emailInput) emailInput.value = email;
      if (nameInput) nameInput.value = String(fd.get('name') || '');
    }
  }
  finally { authBusy = false; button.disabled = false; }
}
async function signout(discard = false) {
  if (discard) {
    if (!confirm('Descartar as alterações que ainda não foram salvas na nuvem e sair? Baixe uma cópia antes se quiser preservá-las.')) return;
    pending = null;
  }
  if (pending && !blocked) await flush();
  if (pending || saving) { fatal(new Error('Ainda há alterações não salvas. Baixe uma cópia antes de sair.')); return; }
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
  memory = null;
  location.replace(location.pathname);
}
async function showAccount(message = '') {
  const { data: { user }, error } = await client.auth.getUser();
  if (error) throw error;
  const { data: factors, error: factorError } = await client.auth.mfa.listFactors();
  if (factorError) throw factorError;
  const enabled = factors.totp.some(factor => factor.status === 'verified');
  document.body.classList.add('auth-locked'); root().hidden = false;
  root().innerHTML = `<section class="auth-card"><div class="auth-brand">MICA<span>+</span> Hub</div><h1>Sua conta</h1><p>${escape(user.email)}</p><p class="auth-description">Verificação em duas etapas: ${enabled ? 'ativada' : 'desativada'}.</p><p class="auth-message">${escape(message)}</p>${enabled ? '' : '<button class="btn btn-primary" data-cloud-enroll>Ativar verificação em duas etapas</button>'}<button class="btn" data-cloud-return>Voltar ao CRM</button><button class="btn" data-cloud-signout>Sair</button></section>`;
}
async function enrollMfa() {
  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError) throw listError;
  for (const factor of factors.totp.filter(item => item.status === 'unverified')) await client.auth.mfa.unenroll({ factorId: factor.id });
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'MICA Hub' });
  if (error) throw error;
  enrollmentId = data.id; authMode = 'enroll';
  const qr = data.totp.qr_code.startsWith('data:') ? data.totp.qr_code : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data.totp.qr_code);
  root().innerHTML = `<section class="auth-card"><h1>Ative a proteção extra</h1><p class="auth-description">Leia o QR code com seu aplicativo autenticador e digite o código de seis dígitos.</p><div class="auth-qr"><img src="${escape(qr)}" alt="QR code para configurar o autenticador"></div><form id="auth-form"><label>Código do autenticador<input class="control" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label><p id="auth-message" class="auth-message" role="status"></p><button class="btn btn-primary btn-wide" type="submit">Confirmar ativação</button></form><button class="btn" data-cloud-return>Cancelar</button></section>`;
}
async function boot() {
  document.body.classList.add('auth-locked');
  root().hidden = false;
  root().textContent = 'Conectando ao MICA Hub…';
  const config = window.MICA_SUPABASE;
  if (!config?.url || !config?.publishableKey) throw new Error('A conexão com o Supabase não está configurada.');
  client = createClient(config.url, config.publishableKey, { auth: { storage: localStorage, storageKey: 'mica-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  document.addEventListener('submit', submit, true);
  document.addEventListener('click', event => {
    const mode = event.target.closest('[data-auth-mode]');
    if (mode) showAuth(mode.dataset.authMode);
    if (event.target.closest('[data-cloud-google]')) {
      if (authBusy) return;
      authBusy = true;
      const button = event.target.closest('[data-cloud-google]'); button.disabled = true;
      client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.MICA_SUPABASE.siteUrl + '/' } }).then(({ error }) => { if (error) showAuth('login', errorText(error), true); }).catch(error => showAuth('login', errorText(error), true)).finally(() => { authBusy = false; button.disabled = false; });
    }
    if (event.target.closest('[data-cloud-signout]')) signout().catch(fatal);
    if (event.target.closest('[data-cloud-discard]')) signout(true).catch(fatal);
    if (event.target.closest('[data-cloud-reload]')) location.reload();
    if (event.target.closest('[data-cloud-retry]')) flush();
    if (event.target.closest('[data-cloud-account]')) showAccount().catch(fatal);
    if (event.target.closest('[data-cloud-enroll]')) enrollMfa().catch(fatal);
    if (event.target.closest('[data-cloud-return]')) { root().hidden = true; root().innerHTML = ''; document.body.classList.remove('auth-locked'); }
    if (event.target.closest('[data-cloud-backup]') && memory) {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([memory], { type: 'application/json' }));
      a.href = url; a.download = 'mica-hub-alteracoes-nao-salvas.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  let recovery = false;
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { recovery = true; showAuth('recover'); }
    else if (started && (!session || session.user.id !== userId)) {
      blocked = true; memory = null; pending = null; location.reload();
    }
  });
  const { data: { session }, error } = await client.auth.getSession();
  if (error) { await client.auth.signOut({ scope: 'local' }); showAuth('login', 'Sua sessão expirou ou o acesso não foi concluído. Entre novamente.', true); return; }
  if (!recovery) await start(session);
  addEventListener('online', () => { if (!blocked) flush(); });
  addEventListener('beforeunload', event => { if (pending || saving) { event.preventDefault(); event.returnValue = ''; } });
}

// The hosted app always requires authentication. Offline HTML backups are explicit exports.
if (location.protocol !== 'file:') boot().catch(error => fatal(error));
