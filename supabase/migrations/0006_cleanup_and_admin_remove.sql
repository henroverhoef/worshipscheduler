-- Nightly cleanup: sets are removed a week after their date (or after they were created, if
-- they have no date) unless a leader ticked "Keep". Their songs/team/markings go with them;
-- the song library is untouched.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.cleanup_old_sets()
returns integer
language sql security definer set search_path = ''
as $$
  with gone as (
    delete from public.events
    where not keep and coalesce(event_date, created_at::date) < current_date - 7
    returning 1
  )
  select count(*)::int from gone
$$;
revoke all on function public.cleanup_old_sets() from public, anon, authenticated;

select cron.schedule('cleanup-old-sets', '17 1 * * *', 'select public.cleanup_old_sets()');

-- App admin: remove a leader. Their sets go, they drop off other leaders' sets and co-leader
-- lists, and their open invites are cancelled. Songs they uploaded stay in the shared library.
-- Their login remains, but without leader access (they can be invited again).
create or replace function public.admin_remove_leader(p_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  them text := lower(trim(p_email));
begin
  if not public.is_app_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.app_admins where email = them) then raise exception 'App admins can''t be removed here.'; end if;
  delete from public.events where created_by_email = them;
  delete from public.invites where invitee_email = them and accepted_at is null;
  -- Cascades to event_leaders, collaborators and invites they sent.
  delete from public.leaders where email = them;
end;
$$;
revoke all on function public.admin_remove_leader(text) from public, anon;
grant execute on function public.admin_remove_leader(text) to authenticated;
