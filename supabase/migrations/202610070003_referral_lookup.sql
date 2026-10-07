begin;

-- Consulta pública de código de indicação para o cadastro.
-- Revela apenas se o código existe; não expõe nome, contato ou vínculo do indicador.
create or replace function public.referral_lookup(p_code text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles
    where referral_code=p_code and length(p_code) between 6 and 64
  )
$$;

revoke all on function public.referral_lookup(text) from public,anon,authenticated;
grant execute on function public.referral_lookup(text) to anon,authenticated;

commit;
