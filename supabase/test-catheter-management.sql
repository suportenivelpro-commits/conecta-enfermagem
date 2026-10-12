-- Integration checks use disposable patients inside a transaction that is always rolled back.
-- No real patient is updated and no test record is committed.
begin;
do $$
declare
  v_staff uuid;
  v_patient uuid;
  v_legacy uuid;
  v_old_cycle uuid;
  v_new_cycle uuid;
  v_second_cycle uuid;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_count integer;
begin
  select user_id into v_staff from public.staff_profiles where active limit 1;
  if v_staff is null then raise exception 'An active staff profile is required for this rollback-only test.'; end if;
  perform set_config('request.jwt.claim.sub', v_staff::text, true);

  v_legacy := public.register_patient('TESTE TRANSACIONAL LEGADO', 'TESTE', 'Hickman', v_today, 'Teste');
  if (select catheter_installed_date from public.patients where id = v_legacy) is not null then
    raise exception 'Legacy registration must not invent a catheter date.';
  end if;

  begin
    perform public.register_patient_with_catheter('TESTE DATA FUTURA', 'TESTE', 'Hickman', v_today, 'Teste', v_today + 1);
    raise exception 'Future catheter date was accepted.';
  exception when others then
    if sqlerrm <> 'Informe uma data de instalação do cateter que não esteja no futuro.' then raise; end if;
  end;
  begin
    perform public.register_patient_with_catheter('TESTE CRONOLOGIA', 'TESTE', 'Hickman', v_today - 2, 'Teste', v_today);
    raise exception 'Connector date before catheter date was accepted.';
  exception when others then
    if sqlerrm <> 'A data do conector não pode ser anterior à instalação do cateter.' then raise; end if;
  end;

  v_patient := public.register_patient_with_catheter(
    'TESTE TRANSACIONAL CATETER', 'TESTE', 'Hickman', v_today - 2, 'Teste', v_today - 7
  );
  if (select catheter_installed_date from public.patients where id = v_patient) <> v_today - 7 then
    raise exception 'Catheter date was not persisted.';
  end if;
  select id into v_old_cycle from public.connector_cycles where patient_id = v_patient and status = 'active';

  v_new_cycle := public.register_catheter_exchange(v_patient, 'Permcath', 'Teste', 'Troca por obstrução', 'Observação de teste');
  if not exists (select 1 from public.patients where id = v_patient and catheter_type = 'Permcath' and catheter_installed_date = v_today) then
    raise exception 'Catheter data was not updated.';
  end if;
  if not exists (select 1 from public.connector_cycles where id = v_old_cycle and status = 'closed' and closed_at is not null) then
    raise exception 'Previous connector cycle was not closed.';
  end if;
  if not exists (select 1 from public.connector_cycles where id = v_new_cycle and status = 'active' and start_date = v_today) then
    raise exception 'New connector cycle must start today (Day 1).';
  end if;
  if not exists (
    select 1 from public.connector_events where patient_id = v_patient and event_type = 'catheter_exchange'
      and notes = 'Observação de teste' and details->>'previous_catheter_type' = 'Hickman'
      and (details->>'previous_catheter_installed_date')::date = v_today - 7
  ) then raise exception 'Catheter exchange audit is incomplete.'; end if;
  if not exists (select 1 from public.connector_events where patient_id = v_patient and event_type = 'connector_exchange' and cycle_id = v_new_cycle) then
    raise exception 'Connector exchange audit is missing.';
  end if;

  v_second_cycle := public.register_catheter_exchange(v_patient, 'Hickman', 'Teste', 'Outros', null);
  select count(*) into v_count from public.connector_cycles where patient_id = v_patient and status = 'active';
  if v_count <> 1 or v_second_cycle = v_new_cycle then raise exception 'Same-day exchange did not preserve exactly one active cycle.'; end if;
  begin
    perform public.register_catheter_exchange(v_patient, 'Hickman', 'Teste', ' ', null);
    raise exception 'Empty reason was accepted.';
  exception when others then
    if sqlerrm <> 'Informe o motivo da troca do cateter.' then raise; end if;
  end;

  -- Without an active cycle, all catheter changes must roll back.
  update public.connector_cycles set status = 'closed', closed_at = now(), closed_by = 'Teste' where id = v_second_cycle;
  begin
    perform public.register_catheter_exchange(v_patient, 'Permcath', 'Teste', 'Outros', null);
    raise exception 'Exchange without active cycle was accepted.';
  exception when others then
    if sqlerrm <> 'Não existe ciclo ativo para este paciente.' then raise; end if;
  end;
  if (select catheter_type from public.patients where id = v_patient) <> 'Hickman' then
    raise exception 'Failed exchange partially updated the patient.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.register_catheter_exchange(v_patient, 'Hickman', 'Teste', 'Outros', null);
    raise exception 'Unauthenticated exchange was accepted.';
  exception when others then
    if sqlerrm <> 'Acesso não autorizado.' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.register_catheter_exchange(uuid,text,text,text,text)', 'execute') then
    raise exception 'Anonymous users can execute the catheter RPC.';
  end if;
end;
$$;
rollback;
