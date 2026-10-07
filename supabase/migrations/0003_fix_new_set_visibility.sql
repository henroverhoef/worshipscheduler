-- Creating a set failed: the insert's RETURNING is checked against the read policy, and
-- can_access_event() looks the set up in a snapshot that doesn't contain the new row yet.
-- Check the row's own creator column directly instead.

create or replace function public.is_event_leader(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.event_leaders el
    where el.event_id = p_event_id and el.email = lower(auth.jwt() ->> 'email')
  );
$$;
revoke all on function public.is_event_leader(uuid) from public, anon;
grant execute on function public.is_event_leader(uuid) to authenticated;

alter policy "set leaders read events" on public.events
  using (public.is_leader() and (created_by_email = lower(auth.jwt() ->> 'email') or public.is_event_leader(id)));
alter policy "set leaders update events" on public.events
  using (public.is_leader() and (created_by_email = lower(auth.jwt() ->> 'email') or public.is_event_leader(id)));
alter policy "set leaders remove events" on public.events
  using (public.is_leader() and (created_by_email = lower(auth.jwt() ->> 'email') or public.is_event_leader(id)));
