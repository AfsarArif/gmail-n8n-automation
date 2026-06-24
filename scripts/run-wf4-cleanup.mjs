/**
 * run-wf4-cleanup.mjs
 *
 * Logs into N8N, imports WF-4 workflow JSON, executes it, and monitors
 * progress. Uses the N8N REST API with cookie-based auth.
 *
 * Usage: node scripts/run-wf4-cleanup.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5678';

async function main() {
  // ── Step 1: Login ──────────────────────────────────────────────
  console.log('🔐 Logging into N8N...');
  const loginRes = await fetch(`${BASE}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrLdapLoginId: 'mohamedafsar.arif@gmail.com',
      password: 'TempPass123',
    }),
  });

  if (!loginRes.ok) {
    console.error('❌ Login failed:', loginRes.status, await loginRes.text());
    process.exit(1);
  }

  // Extract cookie
  const cookies = loginRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  console.log('✅ Logged in successfully\n');

  // Helper: make authenticated API call
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({ status: res.status }));
    return { ok: res.ok, status: res.status, data };
  }

  // ── Step 2: Read WF-4 workflow JSON ─────────────────────────────
  console.log('📄 Reading WF-4 workflow JSON...');
  const wfPath = resolve(__dirname, '..', 'src', 'workflows', 'wf4-initial-cleanup.json');
  const wfJson = JSON.parse(readFileSync(wfPath, 'utf-8'));
  console.log(`   Workflow: "${wfJson.name}"`);
  console.log(`   Nodes: ${wfJson.nodes.length}\n`);

  // ── Step 2.5: Resolve credential IDs ────────────────────────────
  console.log('🔑 Resolving credential IDs...');
  const credRes = await api('GET', '/rest/credentials');
  const creds = credRes.ok ? (credRes.data?.data ?? credRes.data ?? []) : [];

  // Patch Gmail credential references with real IDs
  for (const node of wfJson.nodes) {
    if (node.credentials?.gmailOAuth2) {
      const credName = node.credentials.gmailOAuth2.name;
      const realCred = creds.find(
        (c) => c.name === credName && c.type === 'gmailOAuth2',
      );
      if (realCred) {
        node.credentials.gmailOAuth2.id = realCred.id;
        console.log(`   ✅ ${credName} → ${realCred.id}`);
      } else {
        console.log(`   ⚠️ Credential "${credName}" not found in N8N`);
      }
    }
  }

  // ── Step 3: Deactivate any existing WF-4 duplicates ──────────────
  console.log('🧹 Deactivating existing WF-4 workflows...');
  const listRes = await api('GET', '/rest/workflows');
  const existingWf4s = listRes.ok
    ? (listRes.data.data ?? listRes.data ?? []).filter(
        (w) => w.name && w.name.includes('WF-4: Initial Cleanup'),
      )
    : [];

  for (const wf of existingWf4s) {
    // Try to deactivate to free up webhook paths
    const deactRes = await api('POST', `/rest/workflows/${wf.id}/deactivate`, {});
    if (deactRes.ok) {
      console.log(`   ✅ Deactivated stale WF-4: ${wf.id}`);
    } else {
      console.log(`   ⚠️ Could not deactivate ${wf.id}: ${deactRes.status}`);
    }
  }

  // ── Step 4: Create new WF-4 ─────────────────────────────────────
  console.log('   Creating new WF-4...');
  const createRes = await api('POST', '/rest/workflows', wfJson);
  let workflowId;

  if (createRes.ok) {
    // N8N wraps the response in { data: { id, name, ... } }
    const created = createRes.data.data ?? createRes.data;
    workflowId = created.id ?? created._id;
    console.log(`   ✅ Created WF-4 (id: ${workflowId})\n`);
  } else {
    console.error('   ❌ Create failed:', createRes.status, JSON.stringify(createRes.data).slice(0, 200));
    process.exit(1);
  }

  // ── Step 5: Activate and trigger WF-4 via webhook ─────────────────
  console.log('⚡ Activating WF-4...');
  // Get the full workflow to find its versionId
  const getRes = await api('GET', `/rest/workflows/${workflowId}`);
  const fullWf = (getRes.ok && getRes.data?.data) ? getRes.data.data : null;
  const versionId = fullWf?.versionId;

  if (versionId) {
    const actRes = await api('POST', `/rest/workflows/${workflowId}/activate`, { versionId });
    if (actRes.ok) {
      console.log(`   ✅ Workflow activated (versionId: ${versionId})`);
    } else {
      console.log(`   ⚠️ Activation: ${actRes.status} — ${JSON.stringify(actRes.data).slice(0, 150)}`);
    }
  } else {
    console.log('   ⚠️ Could not find versionId, trying activation without it...');
    await api('POST', `/rest/workflows/${workflowId}/activate`, {});
  }

  console.log('🚀 Triggering WF-4 via webhook...');
  const webhookUrl = `${BASE}/webhook/start-cleanup`;
  const triggerRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'manual', timestamp: new Date().toISOString() }),
  });

  if (triggerRes.ok) {
    console.log(`   ✅ Webhook triggered! (HTTP ${triggerRes.status})`);
    console.log('');
  } else {
    const errText = await triggerRes.text().catch(() => '');
    console.error(`   ⚠️ Webhook trigger returned ${triggerRes.status}: ${errText.slice(0, 250)}`);
    console.log('');
    console.log('   ℹ️  The workflow may need to be activated first. Try:');
    console.log('      1. Open http://localhost:5678');
    console.log('      2. Find "WF-4: Initial Cleanup"');
    console.log('      3. Toggle the "Active" switch (top right)');
    console.log('      4. Click "Execute Workflow" button');
    console.log('      5. OR: curl -X POST http://localhost:5678/webhook/start-cleanup');
    console.log('');
  }

  // ── Step 5: Summary ─────────────────────────────────────────────
  console.log('─── Done ───────────────────────────────────────────────');
  console.log('');
  console.log('📋 Your new temporary password: TempPass123');
  console.log('   Change it in N8N → Settings → Users after logging in.');
  console.log('');
  console.log('📊 Check N8N Executions list to see WF-4 results.');
  console.log('   http://localhost:5678');
  console.log('');
  console.log('📧 Check Gmail — emails should have AI/* labels applied.');
  console.log('   Spam → AI/Spam label → deleted by WF-3 at 8 AM.');
  console.log('────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('❌ Script error:', err.message);
  process.exit(1);
});
