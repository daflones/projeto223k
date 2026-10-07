-- Supabase SQL Editor, como operador postgres. Execute após cadastrar e
-- confirmar a conta no aplicativo. Copie o UUID em Authentication > Users.
-- Altere SOMENTE o UUID abaixo. Este arquivo nunca promove todos os usuários.
begin;
do $$
declare admin_uuid uuid := '00000000-0000-0000-0000-000000000000';
begin
 if admin_uuid='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'Substitua admin_uuid pelo UUID da conta que será admin';
 end if;
 perform 1 from auth.users where id=admin_uuid and email_confirmed_at is not null;
 if not found then raise exception 'Conta inexistente ou e-mail ainda não confirmado'; end if;
 update public.profiles set is_admin=true where id=admin_uuid and blocked is false;
 if not found then raise exception 'Perfil inexistente ou conta bloqueada'; end if;
 insert into public.admin_audit(admin_id,action,details)
 values(null,'operator_grant_admin',jsonb_build_object('user_id',admin_uuid,'origin','SQL Editor'));
end $$;
commit;
-- Para revogar, execute com o UUID exato no SQL Editor:
-- update public.profiles set is_admin=false where id='UUID_DA_CONTA';
-- Revogação bloqueia a próxima chamada administrativa, mesmo com JWT antigo.
