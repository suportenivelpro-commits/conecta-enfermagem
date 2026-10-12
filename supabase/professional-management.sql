-- Apply once. Passwords are bcrypt hashes in an unexposed schema.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.is_professional_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() = '433a49b4-5429-4c20-aecd-62672a69ed4a'::uuid
    and public.is_active_staff();
$$;
revoke all on function public.is_professional_admin() from public, anon;
grant execute on function public.is_professional_admin() to authenticated;

create table public.exchange_professionals (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index exchange_professionals_name on public.exchange_professionals (lower(trim(full_name)));
alter table public.exchange_professionals enable row level security;
revoke all on public.exchange_professionals from public, anon, authenticated;
grant select on public.exchange_professionals to authenticated;
create policy professionals_read on public.exchange_professionals for select to authenticated
using (public.is_active_staff() and (active or public.is_professional_admin()));

create table private.professional_credentials (
  professional_id uuid primary key references public.exchange_professionals(id),
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz
);
alter table private.professional_credentials enable row level security;
revoke all on private.professional_credentials from public, anon, authenticated;

create function public.manage_exchange_professional(
  p_full_name text, p_password text default null, p_professional_id uuid default null,
  p_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not coalesce(public.is_professional_admin(), false) then
    raise exception 'Somente a administradora pode gerenciar profissionais.';
  end if;
  if p_full_name is null or length(trim(p_full_name)) not between 2 and 120 then
    raise exception 'Informe um nome entre 2 e 120 caracteres.';
  end if;
  if p_password is not null and (length(p_password) < 8 or octet_length(p_password) > 72) then
    raise exception 'A senha deve ter pelo menos 8 caracteres e no máximo 72 bytes.';
  end if;
  if p_professional_id is null then
    if p_password is null then raise exception 'Informe a senha do profissional.'; end if;
    insert into public.exchange_professionals(full_name,active)
      values(trim(p_full_name),p_active) returning id into v_id;
    insert into private.professional_credentials(professional_id,password_hash)
      values(v_id,extensions.crypt(p_password,extensions.gen_salt('bf',10)));
  else
    update public.exchange_professionals set full_name=trim(p_full_name),active=p_active,updated_at=now()
      where id=p_professional_id returning id into v_id;
    if not found then raise exception 'Profissional não encontrado.'; end if;
    if p_password is not null then
      update private.professional_credentials set
        password_hash=extensions.crypt(p_password,extensions.gen_salt('bf',10)),
        failed_attempts=0,locked_until=null where professional_id=v_id;
    end if;
  end if;
  return v_id;
end;
$$;

create function public.confirm_professional_exchange(
  p_patient_id uuid, p_professional_id uuid, p_password text, p_kind text,
  p_reason text, p_notes text default null, p_catheter_type text default null,
  p_dressing_duration_days integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text; v_credentials private.professional_credentials%rowtype;
  v_result uuid; v_previous_events uuid[];
begin
  if auth.uid() is null or not public.is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if p_kind is null or p_kind not in ('connector','catheter','dressing') then raise exception 'Tipo de troca inválido.'; end if;
  select full_name into v_name from public.exchange_professionals
    where id=p_professional_id and active for share;
  if not found then return jsonb_build_object('error','Selecione um profissional ativo.'); end if;
  select * into v_credentials from private.professional_credentials
    where professional_id=p_professional_id for update;
  if not found then return jsonb_build_object('error','Profissional sem credenciais. Solicite ajuda à administradora.'); end if;
  if v_credentials.locked_until > now() then
    return jsonb_build_object('error','Muitas tentativas. Aguarde 5 minutos ou solicite redefinição à administradora.');
  end if;
  if p_password is null or octet_length(p_password)>72
      or extensions.crypt(p_password,v_credentials.password_hash) is distinct from v_credentials.password_hash then
    update private.professional_credentials set
      failed_attempts=case when v_credentials.locked_until is not null then 1 else failed_attempts+1 end,
      locked_until=case when v_credentials.locked_until is null and failed_attempts+1>=5
        then now()+interval '5 minutes' else null end
      where professional_id=p_professional_id;
    -- Return instead of raising: the attempt counter must commit.
    return jsonb_build_object('error','Senha incorreta. Após 5 tentativas, aguarde 5 minutos.');
  end if;
  perform 1 from public.patients where id=p_patient_id and follow_up_status='active'
    and follow_up_closed_at is null for update;
  if not found then raise exception 'Paciente não encontrado ou acompanhamento encerrado.'; end if;
  select coalesce(array_agg(id),array[]::uuid[]) into v_previous_events
    from public.connector_events where patient_id=p_patient_id;
  if p_kind='connector' then
    v_result:=public.register_connector_exchange(p_patient_id,v_name,p_notes,p_reason);
  elsif p_kind='catheter' then
    v_result:=public.register_catheter_with_dressing(p_patient_id,p_catheter_type,p_dressing_duration_days,v_name,p_reason,p_notes);
  else
    v_result:=public.register_dressing_exchange(p_patient_id,p_dressing_duration_days,v_name,p_reason,p_notes);
  end if;
  update public.connector_events set details=coalesce(details,'{}'::jsonb)
    || jsonb_build_object('professional_id',p_professional_id)
    where patient_id=p_patient_id and not (id=any(v_previous_events));
  update private.professional_credentials set failed_attempts=0,locked_until=null
    where professional_id=p_professional_id;
  return jsonb_build_object('id',v_result);
end;
$$;
revoke all on function public.manage_exchange_professional(text,text,uuid,boolean) from public, anon;
revoke all on function public.confirm_professional_exchange(uuid,uuid,text,text,text,text,text,integer) from public, anon;
grant execute on function public.manage_exchange_professional(text,text,uuid,boolean) to authenticated;
grant execute on function public.confirm_professional_exchange(uuid,uuid,text,text,text,text,text,integer) to authenticated;
-- Keep the existing implementations for internal, atomic calls only.
revoke execute on function public.register_connector_exchange(uuid,text,text,text) from public,anon,authenticated;
revoke execute on function public.register_catheter_exchange(uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.register_catheter_with_dressing(uuid,text,integer,text,text,text) from public,anon,authenticated;
revoke execute on function public.register_dressing_exchange(uuid,integer,text,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
