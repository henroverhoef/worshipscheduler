-- Sets are private to the leader who created them plus the leaders they invite.
-- The song library and the Leaders list stay shared by all leaders.

alter table public.events
  add column created_by_email text default lower(auth.jwt() ->> 'email');

update public.events e
set created_by_email = lower(u.email)
from auth.users u
where u.id = e.created_by and e.created_by_email is null;

create table public.event_leaders (
  event_id uuid not null references public.events (id) on delete cascade,
  email text not null references public.leaders (email) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, email)
);
create index event_leaders_email_idx on public.event_leaders (email);
alter table public.event_leaders enable row level security;

create or replace function public.can_access_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_leader() and exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (
        e.created_by_email = lower(auth.jwt() ->> 'email')
        or exists (
          select 1 from public.event_leaders el
          where el.event_id = e.id and el.email = lower(auth.jwt() ->> 'email')
        )
      )
  );
$$;
revoke all on function public.can_access_event(uuid) from public, anon;
grant execute on function public.can_access_event(uuid) to authenticated;

drop policy "leaders manage events" on public.events;
create policy "set leaders read events" on public.events
  for select to authenticated using (public.can_access_event(id));
create policy "leaders create own events" on public.events
  for insert to authenticated
  with check (public.is_leader() and created_by_email = lower(auth.jwt() ->> 'email'));
create policy "set leaders update events" on public.events
  for update to authenticated using (public.can_access_event(id)) with check (public.is_leader());
create policy "set leaders remove events" on public.events
  for delete to authenticated using (public.can_access_event(id));

drop policy "leaders manage event_songs" on public.event_songs;
create policy "set leaders manage event_songs" on public.event_songs
  for all to authenticated using (public.can_access_event(event_id)) with check (public.can_access_event(event_id));

drop policy "leaders manage event_team" on public.event_team;
create policy "set leaders manage event_team" on public.event_team
  for all to authenticated using (public.can_access_event(event_id)) with check (public.can_access_event(event_id));

create policy "set leaders manage event_leaders" on public.event_leaders
  for all to authenticated using (public.can_access_event(event_id)) with check (public.can_access_event(event_id));
