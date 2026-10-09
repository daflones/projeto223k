begin;

create unique index withdrawals_one_active_per_day on public.withdrawals(user_id,day_key)
where status in ('requested','approved','processing','review','completed');
alter table public.withdrawals drop constraint withdrawals_user_id_day_key_key;

do $$
declare definition text;
  previous text := 'if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone ''America/Sao_Paulo'')::date) then raise exception ''Você já solicitou um saque hoje''; end if;';
  replacement text := 'if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone ''America/Sao_Paulo'')::date and status not in (''failed'',''rejected'')) then raise exception ''Você já solicitou um saque hoje''; end if;';
begin
 definition:=pg_get_functiondef('public.app_action_internal(text,jsonb)'::regprocedure);
 if length(definition)-length(replace(definition,previous,''))<>length(previous) then
  raise exception 'Versão inesperada de app_action_internal; migração recusada';
 end if;
 execute replace(definition,previous,replacement);
end $$;

commit;
