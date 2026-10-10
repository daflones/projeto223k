import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installationSql, trackedInstallationSql, normalizeSqlLineEndings} from '../scripts/build-supabase-sql.mjs';

test('SQL bundles are identical for LF, CRLF and mixed checkout line endings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eletrify-sql-eol-'));
  const migrations = [
    ['202610100001_first.sql', "begin;\ncreate table public.example(id integer);\ncommit;\n"],
    ['202610100002_second.sql', "begin;\ninsert into public.example(id) values(1);\ncommit;\n"],
  ];
  try {
    const dirs = {};
    for (const style of ['lf', 'crlf', 'mixed']) {
      const path = join(root, style);
      await mkdir(path);
      dirs[style] = pathToFileURL(path + sep);
      for (const [index, [name, sql]] of migrations.entries()) {
        await writeFile(join(path, name), style === 'crlf' || (style === 'mixed' && index === 0) ? sql.replaceAll('\n', '\r\n') : sql);
      }
    }
    for (const generate of [installationSql, trackedInstallationSql]) {
      const expected = await generate(dirs.lf);
      assert.equal(await generate(dirs.crlf), expected);
      assert.equal(await generate(dirs.mixed), expected);
      assert(!expected.includes('\r'));
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('SQL line-ending normalization still detects changed statements', () => {
  const bundle = 'begin;\nselect 1;\ncommit;\n';
  assert.equal(normalizeSqlLineEndings(bundle.replaceAll('\n', '\r\n')), bundle);
  assert.notEqual(normalizeSqlLineEndings(bundle.replace('select 1;', 'select 2;')), bundle);
  assert.notEqual(normalizeSqlLineEndings(bundle.replace('select 1;', 'select  1;')), bundle);
});
