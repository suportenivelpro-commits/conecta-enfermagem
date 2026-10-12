-- Additive change: existing patients retain an unknown catheter installation date.
-- Existing registration and connector-exchange RPCs keep their signatures and behavior.
begin;

alter table public.patients
  add column catheter_installed_date date;

alter table public.connector_events
  drop constraint connector_events_event_type_check,
  add constraint connector_events_event_type_check check (
    event_type in ('registration', 'connector_exchange', 'date_correction',
                   'follow_up_closed', 'catheter_exchange')
  );

create function public.register_patient_with_catheter(
  p_full_name text,
  p_bed text,
  p_catheter_type text,
  p_start_date date,
  p_professional_name text,
  p_catheter_installed_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'Acesso não autorizado.';
  end if;

  if p_catheter_installed_date is null or p_catheter_installed_date > v_today then
    raise exception 'Informe uma data de instalação do cateter que não esteja no futuro.';
  end if;
  if p_start_date < p_catheter_installed_date then
    raise exception 'A data do conector não pode ser anterior à instalação do cateter.';
  end if;

  v_patient_id := public.register_patient(
    p_full_name, p_bed, p_catheter_type, p_start_date, p_professional_name
  );
  update public.patients
    set catheter_installed_date = p_catheter_installed_date
    where id = v_patient_id;
  update public.connector_events
    set details = details || jsonb_build_object(
      'catheter_installed_date', p_catheter_installed_date,
      'catheter_type', p_catheter_type
    )
    where patient_id = v_patient_id and event_type = 'registration';
  return v_patient_id;
end;
$$;

create function public.register_catheter_exchange(
  p_patient_id uuid,
  p_catheter_type text,
  p_professional_name text,
  p_reason text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient public.patients%rowtype;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_new_cycle_id uuid;
begin
  if auth.uid() is null or not public.is_active_staff() then
    raise exception 'Acesso não autorizado.';
  end if;
  if p_catheter_type is null or p_catheter_type not in (
    'Cateter de hemodiálise', 'Permcath', 'Hickman'
  ) then
    raise exception 'Tipo de cateter inválido.';
  end if;
  if p_professional_name is null or length(trim(p_professional_name)) = 0 then
    raise exception 'Informe o profissional responsável.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Informe o motivo da troca do cateter.';
  end if;

  select * into v_patient from public.patients
    where id = p_patient_id for update;
  if not found then
    raise exception 'Paciente não encontrado.';
  end if;
  if v_patient.follow_up_status <> 'active' or v_patient.follow_up_closed_at is not null then
    raise exception 'O acompanhamento deste paciente está encerrado.';
  end if;

  -- Reuse the existing RPC: close the old connector cycle and record its exchange.
  -- A failure in either operation rolls back the entire catheter exchange.
  v_new_cycle_id := public.register_connector_exchange(
    p_patient_id, p_professional_name, p_notes, 'Troca do cateter: ' || trim(p_reason)
  );

  update public.patients
    set catheter_type = p_catheter_type, catheter_installed_date = v_today
    where id = p_patient_id;
  insert into public.connector_events (
    patient_id, cycle_id, event_type, event_date, professional_name,
    reason, details, created_by
  ) values (
    p_patient_id, v_new_cycle_id, 'catheter_exchange', v_today,
    trim(p_professional_name), trim(p_reason),
    jsonb_build_object(
      'previous_catheter_installed_date', v_patient.catheter_installed_date,
      'new_catheter_installed_date', v_today,
      'previous_catheter_type', v_patient.catheter_type,
      'new_catheter_type', p_catheter_type,
      'notes', nullif(trim(coalesce(p_notes, '')), '')
    ), auth.uid()
  );
  return v_new_cycle_id;
end;
$$;

revoke all on function public.register_patient_with_catheter(text,text,text,date,text,date) from public, anon;
revoke all on function public.register_catheter_exchange(uuid,text,text,text,text) from public, anon;
grant execute on function public.register_patient_with_catheter(text,text,text,date,text,date) to authenticated;
grant execute on function public.register_catheter_exchange(uuid,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
