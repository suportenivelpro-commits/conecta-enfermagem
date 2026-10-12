-- Disposable test patients only; no real patient or authentication record is changed.
begin;
do $$
declare
  v_staff uuid;
  v_patient uuid;
  v_legacy uuid;
  v_cycle uuid;
  v_new_cycle uuid;
  v_duration integer;
  v_count integer;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
begin
  select user_id into v_staff from public.staff_profiles where active limit 1;
  if v_staff is null then raise exception 'Active staff is required for rollback-only tests.'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  v_legacy := public.register_patient('TESTE LEGADO CURATIVO', 'TESTE', 'Hickman', v_today, 'Teste');
  if (select dressing_applied_date from public.patients where id = v_legacy) is not null then
    raise exception 'Legacy patients must retain an unknown dressing date.';
  end if;

  foreach v_duration in array array[1,3,7] loop
    v_patient := public.register_patient_with_dressing(
      'TESTE TRANSACIONAL CURATIVO', 'TESTE', 'Hickman', v_today - 2,
      'Teste', v_today - 14, v_today - v_duration + 1, v_duration
    );
    if not exists (select 1 from public.patients where id = v_patient
        and dressing_due_date = v_today and dressing_duration_days = v_duration) then
      raise exception 'Inclusive Day 1 expiry is incorrect for % days.', v_duration;
    end if;
  end loop;
  select id into v_cycle from public.connector_cycles where patient_id = v_patient and status = 'active';

  perform public.register_dressing_exchange(v_patient, 7, 'Teste', 'Troca programada', 'Teste observação');
  if not exists (select 1 from public.patients where id = v_patient
      and dressing_applied_date = v_today and dressing_due_date = v_today + 6
      and catheter_installed_date = v_today - 14 and catheter_type = 'Hickman') then
    raise exception 'Dressing-only exchange changed catheter or calculated expiry incorrectly.';
  end if;
  if not exists (select 1 from public.connector_cycles where id = v_cycle and status = 'active' and start_date = v_today - 2) then
    raise exception 'Dressing-only exchange changed connector cycle.';
  end if;
  if not exists (select 1 from public.connector_events where patient_id = v_patient and event_type = 'dressing_exchange'
      and notes = 'Teste observação' and (details->>'previous_dressing_applied_date')::date = v_today - 6) then
    raise exception 'Dressing history is incomplete.';
  end if;

  perform public.register_connector_exchange(v_patient, 'Teste', null, 'Troca programada');
  if not exists (select 1 from public.patients where id = v_patient and dressing_duration_days = 7 and dressing_due_date = v_today + 6) then
    raise exception 'Connector-only exchange changed dressing.';
  end if;
  v_new_cycle := public.register_catheter_with_dressing(v_patient, 'Permcath', 3, 'Teste', 'Outros', null);
  if not exists (select 1 from public.patients where id = v_patient and catheter_installed_date = v_today
      and catheter_type = 'Permcath' and dressing_applied_date = v_today and dressing_duration_days = 3
      and dressing_due_date = v_today + 2) then
    raise exception 'Catheter exchange must reset catheter and dressing together.';
  end if;
  if not exists (select 1 from public.connector_cycles where id = v_new_cycle and status = 'active' and start_date = v_today) then
    raise exception 'Catheter exchange did not reset connector.';
  end if;
  select count(*) into v_count from public.connector_events where patient_id = v_patient;
  begin
    perform public.register_catheter_with_dressing(v_patient, 'Hickman', 2, 'Teste', 'Outros', null);
    raise exception 'Invalid dressing duration was accepted.';
  exception when others then
    if sqlerrm <> 'Selecione um curativo de 1, 3 ou 7 dias.' then raise; end if;
  end;
  if (select count(*) from public.connector_events where patient_id = v_patient) <> v_count then
    raise exception 'Failed catheter exchange left partial history.';
  end if;
  if (select catheter_type from public.patients where id = v_patient) <> 'Permcath' then
    raise exception 'Failed catheter exchange partially changed patient.';
  end if;
  begin
    perform public.register_patient_with_dressing('TESTE DATA', 'TESTE', 'Hickman', v_today,
      'Teste', v_today, v_today - 1, 3);
    raise exception 'Dressing before catheter installation was accepted.';
  exception when others then
    if sqlerrm <> 'A aplicação do curativo não pode ser anterior à instalação do cateter.' then raise; end if;
  end;
  begin
    perform public.register_patient_with_dressing('TESTE FUTURO', 'TESTE', 'Hickman', v_today,
      'Teste', v_today, v_today + 1, 3);
    raise exception 'Future dressing application was accepted.';
  exception when others then
    if sqlerrm <> 'Informe uma data de aplicação do curativo que não esteja no futuro.' then raise; end if;
  end;

  -- Existing patients can initialize a dressing without guessing historical dates.
  perform public.register_dressing_exchange(v_legacy, 1, 'Teste', 'Primeiro registro', null);
  if (select dressing_due_date from public.patients where id = v_legacy) <> v_today then
    raise exception 'One-day dressing must be due on application day.';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.register_dressing_exchange(v_patient, 3, 'Teste', 'Outros', null);
    raise exception 'Unauthenticated exchange was accepted.';
  exception when others then
    if sqlerrm <> 'Acesso não autorizado.' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.register_dressing_exchange(uuid,integer,text,text,text)', 'execute') then
    raise exception 'Anonymous users can execute dressing RPC.';
  end if;
end;
$$;
rollback;
