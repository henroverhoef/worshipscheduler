-- No two songs with the same title and artist. Titles are compared loosely (case, spacing,
-- punctuation and apostrophes ignored), so "How Deep The Father's Love" = "how deep the fathers love".
-- Same title with different artists is allowed (e.g. Bethel's and Jesus Culture's "Freedom").
-- The app additionally treats a missing artist as "could be the same song" and asks first.
create or replace function public.norm_text(t text)
returns text
language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(lower(regexp_replace(coalesce(t, ''), '[''’`]', '', 'g')), '[^[:alnum:]]+', ' ', 'g'))
$$;

create unique index songs_title_artist_unique on public.songs (public.norm_text(title), public.norm_text(artist));
