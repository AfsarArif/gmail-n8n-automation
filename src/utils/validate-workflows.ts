/**
 * validate-workflows.ts
 *
 * CLI tool that reads all JSON workflow files from `src/workflows/` and
 * runs a battery of validation checks, printing a report to stdout.
 *
 * Usage:
 *   npx tsx src/utils/validate-workflows.ts
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface N8NWorkflowFile {
  name: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    position: [number, number];
    parameters: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    webhookId?: string;
  }>;
  connections: Record<
    string, // source node name
    { main: Array<Array<{ node: string; type: string; index: number }>> }
  >;
  settings?: Record<string, unknown>;
}

interface ValidationIssue {
  workflow: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
}

// ---------------------------------------------------------------------------
// Required nodes per workflow type
// ---------------------------------------------------------------------------

/** Workflows that MUST contain these node types (substring match). */
const REQUIRED_NODES: Record<string, string[]> = {
  shared_classifier: ['webhook', 'switch', 'code'],
  gmail_trigger:     ['gmail', 'set', 'httpRequest'],
  outlook_trigger:   ['microsoftOutlook', 'set', 'httpRequest'],
  spam_deletion:     ['scheduleTrigger', 'splitInBatches'],
  initial_cleanup:   ['manualTrigger', 'gmail', 'splitInBatches', 'code', 'httpRequest'],
};

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

function loadWorkflows(dir: string): Map<string, N8NWorkflowFile> {
  const workflows = new Map<string, N8NWorkflowFile>();
  if (!existsSync(dir)) {
    console.warn(`⚠ Workflow directory not found: ${dir}`);
    return workflows;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8');
    try {
      const wf = JSON.parse(raw) as N8NWorkflowFile;
      workflows.set(file.replace('.json', ''), wf);
    } catch (e) {
      console.error(`Invalid JSON in ${file}: ${(e as Error).message}`);
    }
  }
  return workflows;
}

function checkRequiredNodes(
  wf: N8NWorkflowFile,
  name: string,
  issues: ValidationIssue[],
): void {
  // Determine which set of required nodes applies.
  let required: string[] = [];
  for (const [key, nodes] of Object.entries(REQUIRED_NODES)) {
    if (name.toLowerCase().includes(key) || wf.name?.toLowerCase().includes(key)) {
      required = nodes;
      break;
    }
  }
  if (required.length === 0) return;

  const nodeTypes = wf.nodes.map((n) => n.type.toLowerCase());
  for (const req of required) {
    if (!nodeTypes.some((t) => t.includes(req))) {
      issues.push({
        workflow: name,
        severity: 'error',
        message: `Missing required node type "${req}"`,
      });
    }
  }
}

function checkOrphans(
  wf: N8NWorkflowFile,
  name: string,
  issues: ValidationIssue[],
): void {
  const nodeNames = new Set(wf.nodes.map((n) => n.name));

  // Gather all nodes that appear as targets in connections.
  const connected = new Set<string>();
  for (const [, outputs] of Object.entries(wf.connections)) {
    for (const connections of Object.values(outputs)) {
      if (!Array.isArray(connections)) continue;
      for (const batch of connections as Array<Array<{ node: string }>>) {
        if (!Array.isArray(batch)) continue;
        for (const { node } of batch) {
          connected.add(node);
        }
      }
    }
  }

  // Also gather sources.
  for (const src of Object.keys(wf.connections)) {
    connected.add(src);
  }

  for (const nodeName of nodeNames) {
    if (!connected.has(nodeName)) {
      issues.push({
        workflow: name,
        severity: 'warn',
        message: `Orphan node "${nodeName}" has no connections`,
      });
    }
  }
}

function checkWebhookAuth(
  wf: N8NWorkflowFile,
  name: string,
  issues: ValidationIssue[],
): void {
  for (const node of wf.nodes) {
    if (node.type.includes('webhook')) {
      const auth = node.parameters?.authentication;
      if (!auth || auth === 'none') {
        issues.push({
          workflow: name,
          severity: 'error',
          message: `Webhook node "${node.name}" has no authentication configured`,
        });
      }
    }
  }
}

function checkPlaceholders(
  wf: N8NWorkflowFile,
  name: string,
  issues: ValidationIssue[],
): void {
  const placeholderPattern = /\{\{\s*\$?(?:json|node|env|execution|input|binary|now|today)\b|\{\{\s*\$now\b/;
  let found = 0;

  const walk = (obj: unknown): void => {
    if (typeof obj === 'string') {
      if (placeholderPattern.test(obj)) found++;
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === 'object') {
      for (const v of Object.values(obj)) walk(v);
    }
  };

  for (const node of wf.nodes) {
    walk(node.parameters);
  }

  issues.push({
    workflow: name,
    severity: 'info',
    message: `Found ${found} n8n expression placeholder(s) — ensure all are documented`,
  });
}

/**
 * Validate that a switch node has proper rules/fallback configured.
 * Optional but useful for early detection of misconfigured routing.
 */
function checkSwitchNodes(
  wf: N8NWorkflowFile,
  name: string,
  issues: ValidationIssue[],
): void {
  for (const node of wf.nodes) {
    if (node.type.includes('switch')) {
      const rules = node.parameters?.rules;
      const fallback = node.parameters?.fallbackOutput;
      if (!Array.isArray(rules) || rules.length === 0) {
        issues.push({
          workflow: name,
          severity: 'warn',
          message: `Switch node "${node.name}" has no routing rules defined`,
        });
      }
      if (fallback === undefined || fallback === false) {
        issues.push({
          workflow: name,
          severity: 'warn',
          message: `Switch node "${node.name}" has fallback output disabled — unmatched values will be dropped`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report & entrypoint
// ---------------------------------------------------------------------------

function printReport(issues: ValidationIssue[]): void {
  console.log('\n══════════════════════════════════════════');
  console.log('  N8N Workflow Validation Report');
  console.log('══════════════════════════════════════════\n');

  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');
  const infos = issues.filter((i) => i.severity === 'info');

  for (const issue of issues) {
    const icon = issue.severity === 'error' ? '✖' : issue.severity === 'warn' ? '⚠' : 'ℹ';
    console.log(`  ${icon} [${issue.workflow}] ${issue.message}`);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`  Total: ${issues.length} issues`);
  console.log(`    ✖ Errors:  ${errors.length}`);
  console.log(`    ⚠ Warnings: ${warns.length}`);
  console.log(`    ℹ Info:     ${infos.length}`);
  console.log(`──────────────────────────────────────────\n`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

function main(): void {
  const workflowsDir = resolve(process.argv[2] ?? 'src/workflows');
  const workflows = loadWorkflows(workflowsDir);

  if (workflows.size === 0) {
    console.log('No workflow JSON files found. Nothing to validate.');
    return;
  }

  const issues: ValidationIssue[] = [];

  for (const [name, wf] of workflows) {
    checkRequiredNodes(wf, name, issues);
    checkOrphans(wf, name, issues);
    checkWebhookAuth(wf, name, issues);
    checkPlaceholders(wf, name, issues);
    checkSwitchNodes(wf, name, issues);
  }

  printReport(issues);
}

main();
