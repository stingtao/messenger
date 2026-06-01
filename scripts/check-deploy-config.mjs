import { readFileSync } from 'node:fs';

const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const errors = [];

const database = wrangler.d1_databases?.find((binding) => binding.binding === 'DB');
if (!database) {
  errors.push('Missing D1 binding named DB.');
} else {
  if (database.database_name !== 'messenger-db') {
    errors.push(`D1 database_name must be messenger-db, got ${database.database_name}.`);
  }
  if (!database.database_id || database.database_id === '00000000-0000-0000-0000-000000000000') {
    errors.push('Replace the placeholder D1 database_id in wrangler.jsonc.');
  }
}

if (!wrangler.account_id && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  errors.push('Set wrangler.jsonc account_id or CLOUDFLARE_ACCOUNT_ID before non-interactive deploys.');
}

for (const binding of ['CHAT_ROOM', 'USER_HUB']) {
  const exists = wrangler.durable_objects?.bindings?.some((item) => item.name === binding);
  if (!exists) errors.push(`Missing Durable Object binding ${binding}.`);
}

const r2 = wrangler.r2_buckets?.find((binding) => binding.binding === 'ATTACHMENTS');
if (!r2 || r2.bucket_name !== 'messenger-attachments') {
  errors.push('Missing R2 binding ATTACHMENTS for bucket messenger-attachments.');
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('Cloudflare deploy config looks ready.');
