import {readFile, readdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Git for Windows can check out SQL files with CRLF. Only line endings are
// canonicalized; SQL content must still match the generated bundle exactly.
export function normalizeSqlLineEndings(sql) {
  return sql.replace(/\r\n/g, '\n');
}

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);

export async function installationSql(dir = migrationsDir) {
  const files = (await readdir(dir)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const parts = await Promise.all(files.map(async name => {
    const sql = normalizeSqlLineEndings(await readFile(new URL(name, dir), 'utf8')).trim();
    const wrapped = /^begin;\s*([\s\S]*?)\s*commit;$/i.exec(sql);
    if ((/^begin;/i.test(sql) || /commit;$/i.test(sql)) && !wrapped) throw new Error(`Transação incompleta: ${name}`);
    return `-- Migração: ${name}\n${wrapped ? wrapped[1] : sql}`;
  }));
  return `-- ELETRIFY: instalação inicial completa no Supabase SQL Editor.
-- Gerado por npm run build:sql a partir das migrações. Não editar esta cópia.
-- Banco já instalado: aplicar apenas as migrações pendentes; veja docs/INSTALACAO-SUPABASE.md.
-- Não concede admin, não configura segredos nem agenda o cron.
begin;
do $$ begin
 if to_regclass('auth.users') is null then
  raise exception 'Execute no banco Supabase: auth.users não existe';
 end if;
 if to_regclass('public.platform_settings') is not null then
  raise exception 'Eletrify já instalada. Aplique apenas migrações pendentes';
 end if;
end $$;

${parts.join('\n\n')}

commit;
`;
}

export async function trackedInstallationSql(dir = migrationsDir) {
  const files = (await readdir(dir)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const entries = await Promise.all(files.map(async file => {
    const [, version, name] = /^(\d+)_(.+)\.sql$/.exec(file);
    return `(${quote(version)},${quote(name)},ARRAY[${quote(normalizeSqlLineEndings(await readFile(new URL(file, dir), 'utf8')))}]::text[])`;
  }));
  const guard = `do $$ begin
    if exists(select 1 from pg_catalog.pg_tables where schemaname='public')
      or exists(select 1 from auth.users)
      or exists(select 1 from pg_catalog.pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal)
      or to_regclass('supabase_migrations.schema_migrations') is not null then
      raise exception 'Instalação automática exige banco novo, sem tabelas, usuários, triggers ou histórico';
    end if;
  end $$;`;
  const history = `create schema if not exists supabase_migrations;
    revoke all on schema supabase_migrations from public,anon,authenticated;
    create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
    revoke all on supabase_migrations.schema_migrations from public,anon,authenticated;
    insert into supabase_migrations.schema_migrations(version,name,statements) values ${entries.join(',\n')};`;
  return (await installationSql(dir)).replace('begin;\n', () => `begin;\n${guard}\n`).replace(/\ncommit;\s*$/, () => `\n${history}\ncommit;\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = new URL('../supabase/INSTALAR_ELETRIFY.sql', import.meta.url);
  await writeFile(output, await installationSql());
  console.log('Gerado: supabase/INSTALAR_ELETRIFY.sql');
}
