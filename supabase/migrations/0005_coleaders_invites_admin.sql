-- Co-leaders, invites, names, app admin overview and "keep" for sets.
--
-- Leaders no longer all see each other. Two leaders are co-leaders (a mutual pair in
-- `collaborators`) once one invites the other and the invite is accepted. You only see your
-- co-leaders, and only they can be added to your sets. The song library stays shared by all.

create or replace function public.my_email()
returns text
language sql stable set search_path = ''
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- App admins (the app owner): see the overview, remove leaders.
create table public.app_admins (
  email text primary key check (email = lower(email))
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
insert into public.app_admins (email) values ('hertzogv120@gmail.com');

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_admins where email = public.my_email()) $$;

-- Names people can be found by.
create table public.profiles (
  email text primary key check (email = lower(email)),
  user_id uuid unique references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Co-leader pairs, stored once with a < b.
create table public.collaborators (
  a text not null references public.leaders (email) on delete cascade,
  b text not null references public.leaders (email) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index collaborators_b_idx on public.collaborators (b);
alter table public.collaborators enable row level security;

create or replace function public.is_collaborator(p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.collaborators
    where a = least(public.my_email(), lower(p_email)) and b = greatest(public.my_email(), lower(p_email))
  )
$$;

-- Whose name/email you may see: yourself, your co-leaders, and leaders of sets you're on.
create or replace function public.can_see_person(p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select lower(p_email) = public.my_email()
    or public.is_app_admin()
    or public.is_collaborator(p_email)
    or exists (
      select 1 from public.events e
      where public.can_access_event(e.id)
        and (e.created_by_email = lower(p_email)
             or exists (select 1 from public.event_leaders el where el.event_id = e.id and el.email = lower(p_email)))
    )
$$;

create policy "see allowed profiles" on public.profiles
  for select to authenticated using (public.can_see_person(email));
create policy "create own profile" on public.profiles
  for insert to authenticated with check (email = public.my_email());
create policy "edit own profile" on public.profiles
  for update to authenticated using (email = public.my_email()) with check (email = public.my_email());

create policy "see own co-leaders" on public.collaborators
  for select to authenticated using (a = public.my_email() or b = public.my_email() or public.is_app_admin());
create policy "end own co-leader pairs" on public.collaborators
  for delete to authenticated using (a = public.my_email() or b = public.my_email() or public.is_app_admin());

-- Invites: a link the inviter shares; accepting it (signed in with that email) makes the
-- invitee a leader and the inviter's co-leader.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_'),
  inviter_email text not null references public.leaders (email) on delete cascade,
  invitee_email text not null check (invitee_email = lower(invitee_email)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  declined_at timestamptz
);
create unique index invites_one_open_idx on public.invites (inviter_email, invitee_email)
  where accepted_at is null and declined_at is null;
create index invites_invitee_idx on public.invites (invitee_email);
alter table public.invites enable row level security;

create policy "see own invites" on public.invites
  for select to authenticated
  using (inviter_email = public.my_email() or invitee_email = public.my_email() or public.is_app_admin());
create policy "cancel own invites" on public.invites
  for delete to authenticated using (inviter_email = public.my_email() or public.is_app_admin());

create or replace function public.create_invite(p_email text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_email();
  them text := lower(trim(p_email));
  tok text;
begin
  if not public.is_leader() then raise exception 'Only leaders can invite.'; end if;
  if them !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That doesn''t look like an email address.'; end if;
  if them = me then raise exception 'That''s your own email.'; end if;
  if public.is_collaborator(them) then raise exception 'You''re already co-leaders.'; end if;
  select token into tok from public.invites
    where inviter_email = me and invitee_email = them and accepted_at is null and declined_at is null;
  if tok is not null then
    update public.invites set expires_at = now() + interval '14 days' where token = tok;
    return tok;
  end if;
  insert into public.invites (inviter_email, invitee_email) values (me, them) returning token into tok;
  return tok;
end;
$$;

-- Public: what the invite page shows (works before the invitee has an account).
create or replace function public.get_invite(p_token text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'inviter_email', i.inviter_email,
    'inviter_name', (select display_name from public.profiles p where p.email = i.inviter_email),
    'invitee_email', i.invitee_email,
    'status', case
      when i.accepted_at is not null then 'accepted'
      when i.declined_at is not null then 'declined'
      when i.expires_at < now() then 'expired'
      else 'pending' end
  )
  from public.invites i where i.token = p_token
$$;

create or replace function public.accept_invite(p_token text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_email();
  inv public.invites%rowtype;
begin
  select * into inv from public.invites where token = p_token;
  if not found then raise exception 'This invite link isn''t valid.'; end if;
  if inv.invitee_email <> me then raise exception 'This invite is for %. Sign in with that email to accept it.', inv.invitee_email; end if;
  if inv.accepted_at is not null then return; end if;
  if inv.declined_at is not null then raise exception 'This invite was declined. Ask for a new one.'; end if;
  if inv.expires_at < now() then raise exception 'This invite has expired. Ask for a new one.'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'Confirm your email address first (check your inbox), then accept.';
  end if;
  insert into public.leaders (email) values (me) on conflict do nothing;
  insert into public.collaborators (a, b) values (least(me, inv.inviter_email), greatest(me, inv.inviter_email))
    on conflict do nothing;
  update public.invites set accepted_at = now() where id = inv.id;
end;
$$;

create or replace function public.decline_invite(p_token text)
returns void
language sql security definer set search_path = ''
as $$
  update public.invites set declined_at = now()
  where token = p_token and invitee_email = public.my_email() and accepted_at is null
$$;

-- Open invites addressed to me (shown on the home page after signing in).
create or replace function public.my_invites()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'token', i.token,
    'inviter_email', i.inviter_email,
    'inviter_name', (select display_name from public.profiles p where p.email = i.inviter_email),
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  from public.invites i
  where i.invitee_email = public.my_email() and i.accepted_at is null and i.declined_at is null and i.expires_at > now()
$$;

-- Me and my co-leaders, with names (for the co-leaders page and adding leaders to a set).
create or replace function public.my_people()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with people as (
    select public.my_email() as email, true as me
    union
    select case when c.a = public.my_email() then c.b else c.a end, false
    from public.collaborators c where c.a = public.my_email() or c.b = public.my_email()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'email', p.email, 'name', pr.display_name, 'me', p.me,
    'since', (select c.created_at from public.collaborators c
              where c.a = least(public.my_email(), p.email) and c.b = greatest(public.my_email(), p.email))
  ) order by p.me desc, lower(coalesce(pr.display_name, p.email))), '[]'::jsonb)
  from people p left join public.profiles pr on pr.email = p.email
  where public.is_leader()
$$;

-- Leaders: you see yourself and your co-leaders; only app admins add or remove leaders directly.
alter policy "leaders manage leaders" on public.leaders
  using (email = public.my_email() or public.is_collaborator(email) or public.is_app_admin())
  with check (public.is_app_admin());
create policy "only admins remove leaders" on public.leaders
  as restrictive for delete to authenticated using (public.is_app_admin());

-- A set's leaders can only be you or your co-leaders.
create policy "set leaders are co-leaders" on public.event_leaders
  as restrictive for insert to authenticated
  with check (email = public.my_email() or public.is_collaborator(email) or public.is_app_admin());

-- Sets are removed automatically a week after their date, unless kept.
alter table public.events add column keep boolean not null default false;

-- App owner overview: who uses the app, without anyone's set contents.
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'leaders', (select count(*) from public.leaders),
      'pairs', (select count(*) from public.collaborators),
      'sets', (select count(*) from public.events),
      'upcoming_sets', (select count(*) from public.events where coalesce(event_date, created_at::date) >= current_date),
      'kept_sets', (select count(*) from public.events where keep),
      'songs', (select count(*) from public.songs),
      'pdf_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'charts'),
      'open_invites', (select count(*) from public.invites where accepted_at is null and declined_at is null and expires_at > now()),
      'active_7d', (select count(*) from public.leaders l join auth.users u on lower(u.email) = l.email
                    where u.last_sign_in_at > now() - interval '7 days')
    ),
    'leaders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', l.email,
        'name', (select display_name from public.profiles p where p.email = l.email),
        'added_at', l.added_at,
        'last_sign_in', (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = l.email),
        'sets', (select count(*) from public.events e where e.created_by_email = l.email),
        'songs', (select count(*) from public.songs s join auth.users u on u.id = s.created_by where lower(u.email) = l.email),
        'is_admin', exists (select 1 from public.app_admins a where a.email = l.email),
        'co_leaders', coalesce((
          select jsonb_agg(coalesce(p.display_name, x.other) order by lower(coalesce(p.display_name, x.other)))
          from (select case when c.a = l.email then c.b else c.a end as other
                from public.collaborators c where c.a = l.email or c.b = l.email) x
          left join public.profiles p on p.email = x.other
        ), '[]'::jsonb)
      ) order by l.added_at)
      from public.leaders l), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'token', i.token,
        'inviter', coalesce((select display_name from public.profiles p where p.email = i.inviter_email), i.inviter_email),
        'invitee_email', i.invitee_email,
        'created_at', i.created_at,
        'expires_at', i.expires_at
      ) order by i.created_at desc)
      from public.invites i where i.accepted_at is null and i.declined_at is null and i.expires_at > now()), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_email() from public, anon;
revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.is_collaborator(text) from public, anon;
revoke all on function public.can_see_person(text) from public, anon;
revoke all on function public.create_invite(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.decline_invite(text) from public, anon;
revoke all on function public.my_invites() from public, anon;
revoke all on function public.my_people() from public, anon;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.my_email(), public.is_app_admin(), public.is_collaborator(text),
  public.can_see_person(text), public.create_invite(text), public.accept_invite(text), public.decline_invite(text),
  public.my_invites(), public.my_people(), public.admin_overview() to authenticated;
revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Existing leaders: Henro is co-leader with everyone; Teehgan and Cara with each other.
insert into public.collaborators (a, b)
select least(x, y), greatest(x, y) from (values
  ('hertzogv120@gmail.com', 'teehgansomma@gmail.com'),
  ('hertzogv120@gmail.com', 'cara21raw@gmail.com'),
  ('hertzogv120@gmail.com', 'mareeverhoef@gmail.com'),
  ('teehgansomma@gmail.com', 'cara21raw@gmail.com')
) v(x, y)
where exists (select 1 from public.leaders where email = x) and exists (select 1 from public.leaders where email = y)
on conflict do nothing;

-- Profiles for existing accounts, with the names they go by.
insert into public.profiles (email, user_id, display_name)
select lower(u.email), u.id, n.name
from auth.users u
left join (values
  ('hertzogv120@gmail.com', 'Henro Verhoef'),
  ('teehgansomma@gmail.com', 'Teehgan Somma'),
  ('cara21raw@gmail.com', 'Cara Rawlins'),
  ('mareeverhoef@gmail.com', 'Maree Verhoef')
) n(email, name) on n.email = lower(u.email)
where u.email is not null
on conflict (email) do update set display_name = coalesce(public.profiles.display_name, excluded.display_name);
