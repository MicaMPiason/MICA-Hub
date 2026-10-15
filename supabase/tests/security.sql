-- Transaction-scoped fixtures: no accounts or CRM documents survive this test.
begin;
insert into auth.users(id,email,email_confirmed_at,aud,role) values
 ('11111111-aaaa-4444-8888-000000000001','mica-security-a@example.invalid',now(),'authenticated','authenticated'),
 ('11111111-aaaa-4444-8888-000000000002','mica-security-b@example.invalid',now(),'authenticated','authenticated');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('22222222-aaaa-4444-8888-000000000001','11111111-aaaa-4444-8888-000000000001',now(),now()),
 ('22222222-aaaa-4444-8888-000000000002','11111111-aaaa-4444-8888-000000000002',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-aaaa-4444-8888-000000000001","role":"authenticated","session_id":"22222222-aaaa-4444-8888-000000000001","aal":"aal1"}',true);
do $$
declare result jsonb; n integer;
begin
 result := public.load_crm();
 if result->>'revision' <> '0' then raise exception 'New account not empty'; end if;
 result := public.save_crm('{"version":2,"records":{},"extraLeads":[{"id":"test","nome":"Only A"}]}',0);
 if result->>'revision' <> '1' then raise exception 'Save failed'; end if;
 result := public.save_crm('{"version":2,"records":{},"extraLeads":[]}',0);
 if result->>'error' <> 'conflict' then raise exception 'Version conflict not detected'; end if;
 result := public.save_crm('{"version":2}',1);
 if result->>'error' <> 'invalid_document' then raise exception 'Invalid document accepted'; end if;
 begin
   insert into private.crm_documents(user_id,payload) values('11111111-aaaa-4444-8888-000000000002','{}');
   raise exception 'RLS allowed cross-account insert';
 exception when insufficient_privilege then null; end;
 for n in 1..60 loop result := public.save_crm('{"version":2,"records":{},"extraLeads":[]}',1); end loop;
 if result->>'error' <> 'rate_limit' then raise exception 'Write rate limit failed'; end if;
end; $$;
select set_config('request.jwt.claims','{"sub":"11111111-aaaa-4444-8888-000000000002","role":"authenticated","session_id":"22222222-aaaa-4444-8888-000000000002","aal":"aal1"}',true);
do $$
declare result jsonb; n integer;
begin
 select count(*) into n from private.crm_documents;
 if n <> 0 then raise exception 'RLS exposed another account'; end if;
 update private.crm_documents set payload='{}' where user_id='11111111-aaaa-4444-8888-000000000001';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'RLS allowed cross-account update'; end if;
 for n in 1..121 loop result := public.load_crm(); end loop;
 if result->>'error' <> 'rate_limit' then raise exception 'Read rate limit failed'; end if;
end; $$;
select set_config('request.jwt.claims','{"sub":"11111111-aaaa-4444-8888-000000000002","role":"authenticated","session_id":"22222222-aaaa-4444-8888-999999999999"}',true);
do $$ begin
 begin perform public.load_crm(); raise exception 'Revoked session accepted';
 exception when sqlstate 'PT401' then null; end;
end; $$;
set local role anon;
do $$ begin
 begin perform public.load_crm(); raise exception 'Anonymous RPC accepted';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select 'PASS: RLS isolation, cross-account insert/update, version conflicts, schema validation, write/read rate limits, revoked sessions and anonymous access' as security_tests;
rollback;
