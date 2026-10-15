-- All CRM modules are stored together as a versioned document to preserve the legacy model.
-- The private schema is NOT exposed in the Supabase Data API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create table private.crm_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint crm_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint crm_payload_size check (octet_length(payload::text) <= 10485760)
);
alter table private.crm_documents enable row level security;
alter table private.crm_documents force row level security;
revoke all on private.crm_documents from public, anon, authenticated;
grant select, insert, update on private.crm_documents to authenticated;
create policy own_document_read on private.crm_documents for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_document_insert on private.crm_documents for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy own_document_update on private.crm_documents for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table private.request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('read','write')),
  window_start timestamptz not null,
  requests integer not null check (requests > 0),
  primary key (user_id, action)
);
alter table private.request_limits enable row level security;
alter table private.request_limits force row level security;
revoke all on private.request_limits from public, anon, authenticated;

-- Privileged access is restricted to authentication/session lookup and atomic counters.
create function private.authorize_request(action text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid text := auth.jwt()->>'session_id';
  n integer;
  cap integer;
begin
  if uid is null or sid is null or not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id = u.id
    where u.id = uid and s.id::text = sid
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until < now())
      and (s.not_after is null or s.not_after > now())
  ) then raise sqlstate 'PT401' using message = 'Sessão inválida. Entre novamente.'; end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified')
    and coalesce(auth.jwt()->>'aal','aal1') <> 'aal2'
  then raise sqlstate 'PT403' using message = 'Confirme o segundo fator.'; end if;
  if action not in ('read','write') or action is null then
    raise sqlstate '22023' using message = 'Invalid action';
  end if;
  cap := case when action = 'read' then 120 else 60 end;
  insert into private.request_limits as limits(user_id, action, window_start, requests)
    values (uid, action, date_trunc('minute', now()), 1)
    on conflict (user_id, action) do update set
      window_start = excluded.window_start,
      requests = case when limits.window_start = excluded.window_start then least(limits.requests + 1, cap + 1) else 1 end
    returning requests into n;
  -- Return instead of raising so the over-limit counter also commits.
  return n <= cap;
end;
$$;
revoke all on function private.authorize_request(text) from public, anon, authenticated;
grant execute on function private.authorize_request(text) to authenticated;

create function public.load_crm()
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $$
declare doc private.crm_documents%rowtype;
begin
  if not private.authorize_request('read') then
    return jsonb_build_object('ok',false,'error','rate_limit','retry_after',60);
  end if;
  select * into doc from private.crm_documents where user_id = (select auth.uid());
  return jsonb_build_object('ok',true,'payload',doc.payload,'revision',coalesce(doc.revision,0));
end;
$$;
revoke all on function public.load_crm() from public, anon;
grant execute on function public.load_crm() to authenticated;

create function public.save_crm(document jsonb, expected_revision bigint)
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $$
declare current_revision bigint; new_revision bigint;
begin
  if not private.authorize_request('write') then
    return jsonb_build_object('ok',false,'error','rate_limit','retry_after',60);
  end if;
  if document is null or jsonb_typeof(document) <> 'object'
    or document->>'version' is distinct from '2'
    or jsonb_typeof(document->'records') is distinct from 'object'
    or jsonb_typeof(document->'extraLeads') is distinct from 'array'
    or octet_length(document::text) > 10485760
    or expected_revision is null or expected_revision < 0
  then return jsonb_build_object('ok',false,'error','invalid_document'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select revision into current_revision from private.crm_documents where user_id = (select auth.uid());
  if coalesce(current_revision,0) <> expected_revision then
    return jsonb_build_object('ok',false,'error','conflict','revision',coalesce(current_revision,0));
  end if;
  insert into private.crm_documents as docs(user_id, payload, revision, updated_at)
    values (auth.uid(), document, 1, now())
    on conflict (user_id) do update set payload = excluded.payload, revision = docs.revision + 1, updated_at = now()
    returning revision into new_revision;
  return jsonb_build_object('ok',true,'revision',new_revision);
end;
$$;
revoke all on function public.save_crm(jsonb,bigint) from public, anon;
grant execute on function public.save_crm(jsonb,bigint) to authenticated;
notify pgrst, 'reload schema';
