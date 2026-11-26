-- Freeze legacy writes; the new app explicitly selects a primary browser per account.
-- Keep the pre-transition cloud snapshot under the existing per-account RLS.
alter table public.patient_app_state
  add column if not exists primary_device_id text,
  add column if not exists previous_payload jsonb;

create or replace function public.guard_patient_primary_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.payload ->> 'syncMode' is distinct from 'single-primary-v1'
     or pg_catalog.jsonb_typeof(new.payload -> 'cases') is distinct from 'array'
     or new.primary_device_id is null
     or new.primary_device_id !~ '^device_[A-Za-z0-9_-]+$'
     or new.device_id is distinct from new.primary_device_id then
    raise exception using errcode = '23514', message = 'Only a configured primary app can send patient snapshots';
  end if;

  if TG_OP = 'INSERT' then
    if new.revision is distinct from 1 or pg_catalog.jsonb_array_length(new.payload -> 'cases') = 0 then
      raise exception using errcode = '23514', message = 'Primary setup requires an initial snapshot';
    end if;
    new.previous_payload := null;
  else
    if new.user_id is distinct from old.user_id
       or new.revision is distinct from old.revision + 1 then
      raise exception using errcode = '23514', message = 'Patient snapshot changed; reload before writing';
    end if;
    if old.primary_device_id is null then
      if pg_catalog.jsonb_array_length(new.payload -> 'cases') = 0 then
        raise exception using errcode = '23514', message = 'Primary setup requires at least one case';
      end if;
      new.previous_payload := old.payload;
    else
      if new.primary_device_id is distinct from old.primary_device_id then
        raise exception using errcode = '23514', message = 'Only the configured primary app can send patient updates';
      end if;
      new.previous_payload := old.previous_payload;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.guard_patient_primary_snapshot() from public, anon, authenticated;

create trigger guard_patient_primary_snapshot
before insert or update on public.patient_app_state
for each row execute function public.guard_patient_primary_snapshot();
