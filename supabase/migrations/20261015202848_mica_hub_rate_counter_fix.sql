create or replace function private.authorize_request(action text)
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
    on conflict on constraint request_limits_pkey do update set
      window_start = excluded.window_start,
      requests = case when limits.window_start = excluded.window_start then least(limits.requests + 1, cap + 1) else 1 end
    returning requests into n;
  -- Return instead of raising so the over-limit counter also commits.
  return n <= cap;
end;
$$;
