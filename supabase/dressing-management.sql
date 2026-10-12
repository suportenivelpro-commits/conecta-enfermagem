-- Add dressing tracking without replacing existing RPCs or RLS policies.
begin;

alter table public.patients
  add column dressing_applied_date date,
  add column dressing_duration_days smallint,
  add column dressing_due_date date generated always as (
    dressing_applied_date + (dressing_duration_days::integer - 1)
  ) stored,
  add constraint patients_dressing_check check (
    (dressing_applied_date is null and dressing_duration_days is null)
    or (dressing_applied_date is not null and dressing_duration_days is not null
        and dressing_duration_days in (1, 3, 7))
  );

alter table public.connector_events
  drop constraint connector_events_event_type_check,
  add constraint connector_events_event_type_check check (
    event_type in ('registration', 'connector_exchange', 'date_correction',
                  'follow_up_closed', 'catheter_exchange', 'dressing_exchange')
  );

create function public.register_patient_with_dressing(
  p_full_name text, p_bed text, p_catheter_type text, p_start_date date,
  p_professional_name text, p_catheter_installed_date date,
  p_dressing_applied_date date, p_dressing_duration_days integer
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_dressing_duration_days is null or p_dressing_duration_days not in (1, 3, 7) then
    raise exception 'Selecione um curativo de 1, 3 ou 7 dias.';
  end if;
  if p_dressing_applied_date is null or p_dressing_applied_date > v_today then
    raise exception 'Informe uma data de aplicação do curativo que não esteja no futuro.';
  end if;
  if p_dressing_applied_date < p_catheter_installed_date then
    raise exception 'A aplicação do curativo não pode ser anterior à instalação do cateter.';
  end if;

  v_patient_id := public.register_patient_with_catheter(
    p_full_name, p_bed, p_catheter_type, p_start_date,
    p_professional_name, p_catheter_installed_date
  );
  update public.patients set dressing_applied_date = p_dressing_applied_date,
    dressing_duration_days = p_dressing_duration_days where id = v_patient_id;
  update public.connector_events set details = details || jsonb_build_object(
    'dressing_applied_date', p_dressing_applied_date,
    'dressing_duration_days', p_dressing_duration_days,
    'dressing_due_date', p_dressing_applied_date + p_dressing_duration_days - 1
  ) where patient_id = v_patient_id and event_type = 'registration';
  return v_patient_id;
end;
$$;

create function public.register_dressing_exchange(
  p_patient_id uuid, p_dressing_duration_days integer,
  p_professional_name text, p_reason text, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_patient public.patients%rowtype;
  v_event_id uuid;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_dressing_duration_days is null or p_dressing_duration_days not in (1, 3, 7) then
    raise exception 'Selecione um curativo de 1, 3 ou 7 dias.';
  end if;
  if p_professional_name is null or length(trim(p_professional_name)) = 0 then
    raise exception 'Informe o profissional responsável.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Informe o motivo da troca do curativo.';
  end if;
  select * into v_patient from public.patients where id = p_patient_id for update;
  if not found then raise exception 'Paciente não encontrado.'; end if;
  if v_patient.follow_up_status <> 'active' or v_patient.follow_up_closed_at is not null then
    raise exception 'O acompanhamento deste paciente está encerrado.';
  end if;
  if v_patient.catheter_installed_date > v_today then
    raise exception 'A aplicação do curativo não pode ser anterior à instalação do cateter.';
  end if;

  update public.patients set dressing_applied_date = v_today,
    dressing_duration_days = p_dressing_duration_days where id = p_patient_id;
  insert into public.connector_events (
    patient_id, event_type, event_date, professional_name, reason, details, created_by
  ) values (
    p_patient_id, 'dressing_exchange', v_today, trim(p_professional_name), trim(p_reason),
    jsonb_build_object(
      'previous_dressing_applied_date', v_patient.dressing_applied_date,
      'previous_dressing_duration_days', v_patient.dressing_duration_days,
      'new_dressing_applied_date', v_today,
      'new_dressing_duration_days', p_dressing_duration_days,
      'new_dressing_due_date', v_today + p_dressing_duration_days - 1,
      'notes', nullif(trim(coalesce(p_notes, '')), '')
    ), auth.uid()
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

create function public.register_catheter_with_dressing(
  p_patient_id uuid, p_catheter_type text, p_dressing_duration_days integer,
  p_professional_name text, p_reason text, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_cycle_id uuid;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_dressing_duration_days is null or p_dressing_duration_days not in (1, 3, 7) then
    raise exception 'Selecione um curativo de 1, 3 ou 7 dias.';
  end if;
  -- All three records succeed together or roll back together.
  v_cycle_id := public.register_catheter_exchange(
    p_patient_id, p_catheter_type, p_professional_name, p_reason, p_notes
  );
  perform public.register_dressing_exchange(
    p_patient_id, p_dressing_duration_days, p_professional_name,
    'Troca do cateter: ' || trim(p_reason), p_notes
  );
  return v_cycle_id;
end;
$$;

revoke all on function public.register_patient_with_dressing(text,text,text,date,text,date,date,integer) from public, anon;
revoke all on function public.register_dressing_exchange(uuid,integer,text,text,text) from public, anon;
revoke all on function public.register_catheter_with_dressing(uuid,text,integer,text,text,text) from public, anon;
grant execute on function public.register_patient_with_dressing(text,text,text,date,text,date,date,integer) to authenticated;
grant execute on function public.register_dressing_exchange(uuid,integer,text,text,text) to authenticated;
grant execute on function public.register_catheter_with_dressing(uuid,text,integer,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
