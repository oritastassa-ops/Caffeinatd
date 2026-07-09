-- Fixes the households SELECT policy so a creator can read their own
-- household immediately (before their household_members row exists) — see
-- comment in 006_home.sql.

drop policy if exists "members read households" on households;
create policy "members read households" on households
  for select using (is_household_member(id) or created_by = auth.uid());

-- Cleanup of historical debugging artifacts; both statements are no-ops on a
-- fresh database.
delete from households where name like '% (debug)';
drop function if exists debug_whoami();
