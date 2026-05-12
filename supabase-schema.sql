-- =============================================
--  GASTOS DEL EQUIPO — Schema para Supabase
--  Ejecutá esto en el SQL Editor de Supabase
-- =============================================

-- 1. Tabla de compras
create table purchases (
  id          bigserial primary key,
  buyer       text not null,
  description text not null,
  amount      numeric(10,2) not null,
  comercio    text,
  receipt_url text,
  date        timestamptz default now()
);

-- 2. Acceso público (sin login requerido)
alter table purchases enable row level security;

create policy "Lectura pública"
  on purchases for select
  using (true);

create policy "Inserción pública"
  on purchases for insert
  with check (true);

-- 3. Bucket para fotos de facturas
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true);

create policy "Subida pública de facturas"
  on storage.objects for insert
  with check (bucket_id = 'receipts');

create policy "Lectura pública de facturas"
  on storage.objects for select
  using (bucket_id = 'receipts');
