create table if not exists public.patient_app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  device_id text,
  updated_at timestamptz not null default now()
);

comment on table public.patient_app_state is
  'One encrypted-transport JSON snapshot per authenticated surgery-manager user. RLS isolates every user.';

alter table public.patient_app_state enable row level security;

revoke all on table public.patient_app_state from anon, authenticated;
grant select, insert, update on table public.patient_app_state to authenticated;

create policy "patient_app_state_select_own"
on public.patient_app_state
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

create policy "patient_app_state_insert_own"
on public.patient_app_state
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

create policy "patient_app_state_update_own"
on public.patient_app_state
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
)
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

do $$
begin
  alter publication supabase_realtime add table public.patient_app_state;
exception
  when duplicate_object then null;
end
$$;
