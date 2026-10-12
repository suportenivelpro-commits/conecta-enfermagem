CREATE OR REPLACE FUNCTION public.register_connector_exchange(p_patient_id uuid, p_professional_name text, p_notes text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
        DECLARE
          v_today date;
            v_old_cycle_id uuid;
              v_old_start_date date;
                v_new_cycle_id uuid;
                BEGIN
                  IF auth.uid() IS NULL OR NOT public.is_active_staff() THEN
                      RAISE EXCEPTION 'Acesso não autorizado.';
                        END IF;

                          IF p_professional_name IS NULL
                               OR length(trim(p_professional_name)) = 0 THEN
                                   RAISE EXCEPTION 'Informe o profissional responsável.';
                                     END IF;

                                       IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
                                           RAISE EXCEPTION 'Informe o motivo da troca.';
                                             END IF;

                                               v_today := (now() AT TIME ZONE 'America/Fortaleza')::date;

                                                 PERFORM 1
                                                   FROM public.patients
                                                     WHERE id = p_patient_id
                                                       FOR UPDATE;

                                                         IF NOT FOUND THEN
                                                             RAISE EXCEPTION 'Paciente não encontrado.';
                                                               END IF;

                                                                 SELECT id, start_date
                                                                   INTO v_old_cycle_id, v_old_start_date
                                                                     FROM public.connector_cycles
                                                                       WHERE patient_id = p_patient_id
                                                                           AND status = 'active'
                                                                             FOR UPDATE;

                                                                               IF v_old_cycle_id IS NULL THEN
                                                                                   RAISE EXCEPTION 'Não existe ciclo ativo para este paciente.';
                                                                                     END IF;

                                                                                       -- Exchanges on the same date are allowed; each closes the previous cycle.

                                                                                               UPDATE public.connector_cycles
                                                                                                 SET status = 'closed',
                                                                                                       closed_at = now(),
                                                                                                             closed_by = trim(p_professional_name)
                                                                                                               WHERE id = v_old_cycle_id;

                                                                                                                 INSERT INTO public.connector_cycles (
                                                                                                                     patient_id, start_date, created_by
                                                                                                                       )
                                                                                                                         VALUES (
                                                                                                                             p_patient_id, v_today, auth.uid()
                                                                                                                               )
                                                                                                                                 RETURNING id INTO v_new_cycle_id;

                                                                                                                                   INSERT INTO public.connector_events (
                                                                                                                                       patient_id, cycle_id, related_cycle_id,
                                                                                                                                           event_type, event_date, professional_name,
                                                                                                                                               reason, details, created_by
                                                                                                                                                 )
                                                                                                                                                   VALUES (
                                                                                                                                                       p_patient_id, v_new_cycle_id, v_old_cycle_id,
                                                                                                                                                           'connector_exchange', v_today, trim(p_professional_name),
                                                                                                                                                               trim(p_reason),
                                                                                                                                                                   jsonb_build_object(
                                                                                                                                                                         'previous_cycle_start_date', v_old_start_date,
                                                                                                                                                                               'new_cycle_start_date', v_today,
                                                                                                                                                                                     'notes', nullif(trim(coalesce(p_notes, '')), '')
                                                                                                                                                                                         ),
                                                                                                                                                                                             auth.uid()
                                                                                                                                                                                               );

                                                                                                                                                                                                 RETURN v_new_cycle_id;
                                                                                                                                                                                                 END;
                                                                                                                                                                                                 $function$
