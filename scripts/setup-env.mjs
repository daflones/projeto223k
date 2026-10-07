// Gera .env.local com os valores públicos do Supabase a partir do formulário
// privado do operador. Nunca imprime valores no terminal.
import {readFile, writeFile} from 'node:fs/promises';
const input = await readFile(new URL('../ELETRIFY-PREENCHER-PRODUCAO-DEVIN.md', import.meta.url), 'utf8');
const field = name => input.match(new RegExp(`^${name}\\s*=\\s*\\[([^\\]\\r\\n]+)\\]`, 'm'))?.[1]?.trim();
const url = input.match(/^SUPABASE_URL\s*=\s*(https:\/\/[a-z0-9]+\.supabase\.co)/m)?.[1]?.trim();
const key = field('SUPABASE_CHAVE_PUBLICA');
if (!url || !key) throw new Error('Campos SUPABASE_URL_DO_PROJETO/SUPABASE_CHAVE_PUBLICA ausentes no formulário.');
await writeFile(new URL('../.env.local', import.meta.url), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`);
console.log('.env.local criado apontando para ' + url);
