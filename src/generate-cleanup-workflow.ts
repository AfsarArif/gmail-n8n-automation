/**
 * generate-cleanup-workflow.ts
 *
 * CLI script: generates WF-4 Initial Cleanup workflow JSON files for each
 * configured Gmail account.
 *
 * Usage:
 *   npx ts-node src/generate-cleanup-workflow.ts
 *   npm run generate:cleanup-workflow
 *
 * Reads .env for GMAIL_ACCOUNTS, GMAIL_CREDENTIAL_NAMES, N8N_BASE_URL,
 * and WF0_SECRET_TOKEN. Writes one JSON file per Gmail account to
 * src/workflows/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildCleanupWorkflow } from './code/initial-cleanup';
import type { CleanupWorkflowConfig } from './code/initial-cleanup';

// ---------------------------------------------------------------------------
// Simple .env loader (avoids adding dotenv dependency)
// ---------------------------------------------------------------------------

function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠  No .env file found at ${filePath} — using existing env vars`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already defined (env vars take precedence)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Load .env
  const envPath = path.resolve(__dirname, '..', '.env');
  loadEnv(envPath);

  // Read accounts
  const accountsRaw = process.env.GMAIL_ACCOUNTS || '';
  const credentialsRaw = process.env.GMAIL_CREDENTIAL_NAMES || '';
  const n8nBaseUrl = process.env.N8N_BASE_URL || 'http://localhost:5678';
  const wf0Token = process.env.WF0_SECRET_TOKEN || '';

  const accounts = accountsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const credentials = credentialsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (accounts.length === 0) {
    console.error(
      '❌ No Gmail accounts configured. Set GMAIL_ACCOUNTS in .env',
    );
    process.exit(1);
  }

  if (accounts.length !== credentials.length) {
    console.error(
      `❌ Mismatch: ${accounts.length} Gmail account(s) but ${credentials.length} credential name(s).`,
    );
    console.error(
      '   Ensure GMAIL_ACCOUNTS and GMAIL_CREDENTIAL_NAMES have the same number of entries.',
    );
    process.exit(1);
  }

  console.log('🔧 Generating WF-4 Initial Cleanup workflows...\n');
  console.log(`   N8N Base URL: ${n8nBaseUrl}`);
  console.log(`   Accounts:     ${accounts.length}\n`);

  const workflowsDir = path.resolve(__dirname, 'workflows');

  // Ensure workflows directory exists
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const generatedFiles: string[] = [];

  for (let i = 0; i < accounts.length; i++) {
    const config: CleanupWorkflowConfig = {
      credentialName: credentials[i],
      emailAddress: accounts[i],
      n8nBaseUrl,
      wf0Token,
    };

    const workflow = buildCleanupWorkflow(config);

    // Determine filename — for single account, use the canonical name
    const suffix = accounts.length === 1 ? '' : `-${i + 1}`;
    const filename = `wf4-initial-cleanup${suffix}.json`;
    const filePath = path.join(workflowsDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
    generatedFiles.push(filePath);

    console.log(`   ✅ ${filename}  (${workflow.nodes.length} nodes)`);
    console.log(`      Account:    ${accounts[i]}`);
    console.log(`      Credential: ${credentials[i]}`);
  }

  // Print summary
  console.log(`\n📁 ${generatedFiles.length} workflow file(s) generated:`);
  for (const f of generatedFiles) {
    console.log(`   ${f}`);
  }

  console.log('\n─── Next Steps ───────────────────────────────────────────');
  console.log('1. Import the workflow JSON into N8N:');
  console.log('   N8N → Workflows → Import from File');
  console.log('');
  console.log('2. Open the imported workflow and verify:');
  console.log('   - Gmail "Get Unlabeled Emails" node shows the correct credential');
  console.log('   - "POST to WF-0 Classifier" has the correct webhook URL');
  console.log('');
  console.log('3. Execute the workflow manually:');
  console.log('   Click "Execute Workflow" in the N8N editor');
  console.log('');
  console.log('4. Check Gmail — emails should now have AI/* labels');
  console.log('');
  console.log('5. Re-running is safe (idempotent):');
  console.log(
    '   Already-labeled emails are excluded by the -label:AI/* query',
  );
  console.log('────────────────────────────────────────────────────────\n');
}

main();
