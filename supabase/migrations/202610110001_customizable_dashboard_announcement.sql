begin;

create or replace function public.announcement_valid_url(p_url text,p_asset boolean default false)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(p_url)<=2000 and (
  p_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
  or (p_asset and p_url ~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.-]*$' and position('..' in p_url)=0)
 ),false)
$$;
revoke all on function public.announcement_valid_url(text,boolean) from public,anon,authenticated,service_role;

create table if not exists public.platform_announcements(
 id text primary key check(id='dashboard'),
 revision integer not null default 1 check(revision>0),
 title text not null check(char_length(title) between 1 and 120),
 message text not null check(char_length(message) between 1 and 4000),
 image_url text check(image_url is null or public.announcement_valid_url(image_url,true)),
 image_alt text not null default '' check(char_length(image_alt)<=160),
 buttons jsonb not null default '[]' check(jsonb_typeof(buttons)='array' and jsonb_array_length(buttons)<=5),
 active boolean not null default true,
 show_popup boolean not null default true,
 show_card boolean not null default true,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
alter table public.platform_announcements enable row level security;
revoke all on public.platform_announcements from public,anon,authenticated,service_role;

-- Seed only once. Re-running this migration preserves edits made in the admin.
do $$ declare seeded integer; previous_group text; begin
 insert into public.platform_announcements(id,title,message,buttons) values(
  'dashboard','A comunidade está de casa nova',
  E'O grupo anterior será desativado após sofrer ataques. Criamos um novo grupo oficial para continuar nossos comunicados, conversas e atendimento.\n\nEntre pelo botão abaixo e continue com a gente!\n\nSomente os administradores do grupo da comunidade oficial representam o suporte da Eletrify.',
  '[{"label":"Entrar no novo grupo do WhatsApp","url":"https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni","style":"primary"}]'::jsonb
 ) on conflict(id) do nothing;
 get diagnostics seeded=row_count;
 if seeded=1 then
  select whatsapp_group into previous_group from public.platform_settings where id=1;
  update public.platform_settings set whatsapp_group='https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni' where id=1;
  insert into public.admin_audit(admin_id,action,details) values(null,'announcement_install',jsonb_build_object('previous_group',previous_group,'whatsapp_group','https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni','revision',1));
 end if;
end $$;

create or replace function public.announcement_current()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not blocked) then
  raise exception 'Acesso negado';
 end if;
 return (select to_jsonb(n)-'updated_by' from public.platform_announcements n where id='dashboard' and active);
end; $$;

create or replace function public.announcement_admin_get()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 return (select to_jsonb(n)||jsonb_build_object('whatsapp_group',(select whatsapp_group from public.platform_settings where id=1)) from public.platform_announcements n where id='dashboard');
end; $$;

create or replace function public.announcement_admin_save(p_data jsonb,p_expected_revision integer,p_republish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 before public.platform_announcements; caption text; body text; image text; alt text;
 links jsonb:='[]'; item jsonb; label text; target text; appearance text;
 enabled boolean; popup boolean; card boolean; changed boolean; group_link text;
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Dados do aviso inválidos'; end if;
 if jsonb_typeof(p_data->'title') is distinct from 'string' or jsonb_typeof(p_data->'message') is distinct from 'string' then
  raise exception 'Informe título e mensagem';
 end if;
 caption:=trim(p_data->>'title');body:=trim(p_data->>'message');
 if char_length(caption) not between 1 and 120 or char_length(body) not between 1 and 4000 then raise exception 'Confira o tamanho do título e da mensagem'; end if;
 if coalesce(jsonb_typeof(p_data->'image_url'),'null') not in ('null','string') or coalesce(jsonb_typeof(p_data->'image_alt'),'null') not in ('null','string') then raise exception 'Imagem inválida'; end if;
 image:=nullif(trim(p_data->>'image_url'),'');alt:=trim(coalesce(p_data->>'image_alt',''));
 if image is not null and not public.announcement_valid_url(image,true) then raise exception 'Use imagem HTTPS ou caminho /assets válido'; end if;
 if char_length(alt)>160 then raise exception 'Descrição da imagem limitada a 160 caracteres'; end if;
 if jsonb_typeof(p_data->'buttons') is distinct from 'array' then raise exception 'Botões inválidos'; end if;
 if jsonb_array_length(p_data->'buttons')>5 then raise exception 'Máximo de 5 botões por aviso'; end if;
 for item in select value from jsonb_array_elements(p_data->'buttons') loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'label') is distinct from 'string' or jsonb_typeof(item->'url') is distinct from 'string' then raise exception 'Informe texto e link de cada botão'; end if;
  label:=trim(item->>'label');target:=trim(item->>'url');appearance:=coalesce(item->>'style','primary');
  if char_length(label) not between 1 and 60 or not public.announcement_valid_url(target) or appearance not in ('primary','secondary') then raise exception 'Confira o texto, o link HTTPS e o estilo dos botões'; end if;
  links:=links||jsonb_build_array(jsonb_build_object('label',label,'url',target,'style',appearance));
 end loop;
 if jsonb_typeof(p_data->'active') is distinct from 'boolean' or jsonb_typeof(p_data->'show_popup') is distinct from 'boolean' or jsonb_typeof(p_data->'show_card') is distinct from 'boolean' then raise exception 'Configuração de exibição inválida'; end if;
 enabled:=(p_data->>'active')::boolean;popup:=(p_data->>'show_popup')::boolean;card:=(p_data->>'show_card')::boolean;
 if p_data ? 'whatsapp_group' then
  if jsonb_typeof(p_data->'whatsapp_group') is distinct from 'string' then raise exception 'Grupo do WhatsApp inválido'; end if;
  group_link:=trim(p_data->>'whatsapp_group');
  if group_link<>'' and group_link !~ '^https://chat[.]whatsapp[.]com/[A-Za-z0-9]+([?][^[:space:]<>"\\]*)?$' then raise exception 'Use um convite válido de chat.whatsapp.com'; end if;
 end if;
 select * into before from public.platform_announcements where id='dashboard' for update;
 if before.id is null then raise exception 'Aviso não encontrado'; end if;
 if p_expected_revision is null or before.revision<>p_expected_revision then raise exception 'O aviso foi alterado por outro administrador. Atualize a página antes de salvar'; end if;
 changed:=row(caption,body,image,alt,links,enabled,popup,card) is distinct from row(before.title,before.message,before.image_url,before.image_alt,before.buttons,before.active,before.show_popup,before.show_card);
 if changed or coalesce(p_republish,false) then
  update public.platform_announcements set title=caption,message=body,image_url=image,image_alt=alt,buttons=links,active=enabled,show_popup=popup,show_card=card,revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id='dashboard';
  insert into public.admin_audit(admin_id,action,details) values(auth.uid(),'announcement_publish',jsonb_build_object('previous_revision',before.revision,'revision',before.revision+1,'title',caption,'active',enabled,'republished',coalesce(p_republish,false)));
 end if;
 if group_link is not null and group_link is distinct from (select whatsapp_group from public.platform_settings where id=1) then
  update public.platform_settings set whatsapp_group=group_link where id=1;
  insert into public.admin_audit(admin_id,action,details) values(auth.uid(),'announcement_group_update',jsonb_build_object('whatsapp_group',group_link));
 end if;
 return public.announcement_admin_get();
end; $$;

revoke all on function public.announcement_current(),public.announcement_admin_get(),public.announcement_admin_save(jsonb,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.announcement_current(),public.announcement_admin_get(),public.announcement_admin_save(jsonb,integer,boolean) to authenticated;

commit;
