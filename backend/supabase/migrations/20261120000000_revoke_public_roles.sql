-- Endurecimiento de acceso (20 de noviembre de 2026).
-- La API se conecta directo a Postgres con el rol postgres y nunca usa la API REST de Supabase.
-- Supabase da por defecto todos los permisos (incluido TRUNCATE) a los roles públicos anon y
-- authenticated; hasta ahora solo RLS los frenaba. Se retiran, también para tablas futuras,
-- para que la protección no dependa de acordarse de activar RLS en cada tabla nueva.
-- En una base sin esos roles (pruebas locales) no hace nada.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke all on all functions in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on functions from anon, authenticated';
  end if;
end $$;
