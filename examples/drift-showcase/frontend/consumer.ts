// Example Next.js-style frontend consumer of the generated drift-showcase
// API client. This file is HAND-AUTHORED — the way an app developer would
// write it against a typed client — and imports the GENERATED module at
// ../generated/client/client.js, which scripts/check-drift-showcase.mjs
// derives from the SAME route descriptors (`schema body=`/`schema
// response=`) that the Express and FastAPI emitters consume for
// ../app.kern.
//
// scripts/check-drift-showcase.mjs typechecks this exact file twice:
//   1. against the client generated from the CURRENT app.kern route
//      contract — must PASS.
//   2. against a client regenerated from a MUTATED route contract (a
//      renamed response field) — must FAIL.
// That is the discriminating proof that a backend response-shape change
// breaks the frontend build at compile time, not just at runtime.
import { getApiItemsId, getApiStatus, postApiItems } from '../generated/client/client.js';

export async function renderStatusBadge(baseUrl: string): Promise<string> {
  const { body } = await getApiStatus(baseUrl);
  return `${body.service} v${body.version} — ${body.ok ? 'online' : 'offline'}`;
}

export async function renderItemPrice(baseUrl: string, id: string): Promise<string> {
  const { body } = await getApiItemsId(baseUrl, { id });
  return `${body.title}: $${body.price.toFixed(2)}`;
}

export async function renderCreatedItem(baseUrl: string): Promise<string> {
  const { body } = await postApiItems(baseUrl, { title: 'Gadget', price: 19.99 });
  return `Created ${body.id} (${body.title}) at ${body.createdAt} for $${body.price.toFixed(2)}`;
}
