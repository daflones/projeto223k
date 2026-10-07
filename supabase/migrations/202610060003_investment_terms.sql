begin;

-- Revised launch terms. Purchases snapshot these settings; existing contracts
-- keep the conditions recorded when acquired.
alter table public.platform_settings alter column return_principal set default true;
update public.platform_settings set return_principal=true where id=1;
alter table public.positions alter column return_principal set default true;
alter table public.products alter column daily_bps set default 500;
alter table public.products alter column duration_days drop default;

-- A missing duration uses the category's initial term. An explicit admin value
-- always takes precedence, including terms shorter/longer than 10 or 15 days.
create function public.product_default_terms() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.duration_days is null then
  new.duration_days:=case when new.category='distribution' then 15 else 10 end;
 end if;
 if new.daily_bps is null then new.daily_bps:=500; end if;
 return new;
end; $$;
create trigger product_default_terms before insert on public.products
for each row execute function public.product_default_terms();
revoke all on function public.product_default_terms() from public,anon,authenticated;
grant execute on function public.product_default_terms() to service_role;

-- Update the original untouched draft catalog without resetting custom terms.
update public.products p
set daily_bps=v.daily_bps,duration_days=v.duration_days
from (values
 ('Patinete urbano','/assets/patinete-bateria-componentes.png',500,10),
 ('Drone inteligente','/assets/drone-eletronica-carcaca-bateria.png',600,10),
 ('Moto elétrica','/assets/moto-estrutura-bateria-motor.png',700,10),
 ('SUV elétrico','/assets/carro-carroceria-chassi-baterias.png',800,10),
 ('Lote de patinetes','/assets/lote-quatro-patinetes-eletricos.png',500,15),
 ('Lote de drones','/assets/lote-tres-drones-maleta-transporte.png',600,15),
 ('Lote de motos','/assets/lote-tres-motos-eletricas.png',700,15),
 ('Lote de SUVs','/assets/lote-tres-carros-eletricos.png',800,15)
) as v(name,image,daily_bps,duration_days)
where p.name=v.name and p.image=v.image and p.daily_bps=0 and p.duration_days=30
and p.category=case when v.duration_days=15 then 'distribution' else 'production' end;

commit;
