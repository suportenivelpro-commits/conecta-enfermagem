-- Disposable records; always roll back. Run as database owner.
begin;
do $$
declare
  v_prof uuid; v_patient uuid; v_result jsonb; v_count integer; v_i integer;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
begin
  perform set_config('request.jwt.claim.sub','433a49b4-5429-4c20-aecd-62672a69ed4a',true);
  v_prof:=public.manage_exchange_professional('TESTE PROFISSIONAL TRANSACIONAL','senha-teste-123');
  if (select password_hash from private.professional_credentials where professional_id=v_prof)='senha-teste-123' then
    raise exception 'Plaintext password stored';
  end if;
  v_patient:=public.register_patient_with_dressing('TESTE SENHA','TESTE','Hickman',v_today-2,'Teste',v_today-10,v_today-2,3);
  select count(*) into v_count from public.connector_events where patient_id=v_patient;
  for v_i in 1..5 loop
    v_result:=public.confirm_professional_exchange(v_patient,v_prof,'incorreta','connector','Teste');
    if v_result->>'error' is null then raise exception 'Wrong password accepted'; end if;
  end loop;
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'senha-teste-123','connector','Teste');
  if v_result->>'error' not like 'Muitas tentativas%' then raise exception 'Lockout missing'; end if;
  if (select count(*) from public.connector_events where patient_id=v_patient)<>v_count then
    raise exception 'Failed authentication changed history';
  end if;
  perform public.manage_exchange_professional('TESTE PROFISSIONAL TRANSACIONAL','nova-senha-123',v_prof,true);
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'senha-teste-123','connector','Teste');
  if v_result->>'error' is null then raise exception 'Old password accepted'; end if;
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'nova-senha-123','connector','Teste');
  if v_result->>'id' is null then raise exception 'Valid connector exchange failed: %',v_result; end if;
  if not exists(select 1 from public.patients where id=v_patient and catheter_installed_date=v_today-10 and dressing_applied_date=v_today-2) then
    raise exception 'Connector changed catheter/dressing dates';
  end if;
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'nova-senha-123','dressing','Teste',null,null,7);
  if v_result->>'id' is null then raise exception 'Valid dressing exchange failed'; end if;
  if not exists(select 1 from public.patients where id=v_patient and dressing_due_date=v_today+6 and catheter_installed_date=v_today-10) then
    raise exception 'Dressing dates incorrect';
  end if;
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'nova-senha-123','catheter','Teste',null,'Permcath',3);
  if v_result->>'id' is null then raise exception 'Valid catheter exchange failed'; end if;
  if not exists(select 1 from public.patients where id=v_patient and catheter_installed_date=v_today and dressing_due_date=v_today+2) then
    raise exception 'Catheter did not reset dressing';
  end if;
  if (select count(*) from public.connector_events where patient_id=v_patient
    and details->>'professional_id'=v_prof::text and professional_name='TESTE PROFISSIONAL TRANSACIONAL')<>5 then
    raise exception 'Professional audit identity missing';
  end if;
  perform public.manage_exchange_professional('TESTE PROFISSIONAL TRANSACIONAL',null,v_prof,false);
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'nova-senha-123','connector','Teste');
  if v_result->>'error' is null then raise exception 'Inactive professional accepted'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  begin
    perform public.manage_exchange_professional('FORBIDDEN','senha-teste-123');
    raise exception 'Non-admin managed professionals';
  exception when others then
    if sqlerrm<>'Somente a administradora pode gerenciar profissionais.' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.confirm_professional_exchange(v_patient,v_prof,'nova-senha-123','connector','Teste');
    raise exception 'Anonymous exchange allowed';
  exception when others then
    if sqlerrm<>'Acesso não autorizado.' then raise; end if;
  end;
  if has_table_privilege('authenticated','private.professional_credentials','SELECT') then raise exception 'Hashes exposed'; end if;
  if has_table_privilege('anon','public.exchange_professionals','SELECT') then raise exception 'Names publicly exposed'; end if;
  if has_function_privilege('authenticated','public.register_connector_exchange(uuid,text,text,text)','EXECUTE') then
    raise exception 'Legacy RPC bypass allowed';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','433a49b4-5429-4c20-aecd-62672a69ed4a',true);
do $$ begin
  if not exists(select 1 from public.exchange_professionals where full_name='TESTE PROFISSIONAL TRANSACIONAL' and not active) then
    raise exception 'Admin cannot see inactive professionals';
  end if;
  begin
    perform password_hash from private.professional_credentials;
    raise exception 'Credentials visible to authenticated';
  exception when insufficient_privilege then null; end;
  begin
    update public.exchange_professionals set active=true;
    raise exception 'Direct update bypass allowed';
  exception when insufficient_privilege then null; end;
end $$;
do $$
declare v_prof uuid; v_patient uuid; v_result jsonb;
begin
  select id into v_prof from public.exchange_professionals where full_name='TESTE PROFISSIONAL TRANSACIONAL';
  perform public.manage_exchange_professional('TESTE PROFISSIONAL TRANSACIONAL',null,v_prof,true);
  select id into v_patient from public.patients where full_name='TESTE SENHA';
  v_result:=public.confirm_professional_exchange(v_patient,v_prof,'nova-senha-123','connector','Teste authenticated');
  if v_result->>'id' is null then raise exception 'Authenticated RPC failed'; end if;
  begin
    perform public.register_connector_exchange(v_patient,'Bypass',null,'Teste');
    raise exception 'Direct RPC bypass allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$ begin
  if exists(select 1 from public.exchange_professionals) then raise exception 'Non-staff read allowed'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.exchange_professionals;
    raise exception 'Anonymous list allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
