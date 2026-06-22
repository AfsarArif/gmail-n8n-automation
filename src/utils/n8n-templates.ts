/**
 * n8n-templates.ts
 *
 * Programmatic generation of n8n workflow JSON.
 * All types mirror the n8n REST API workflow schema so that exported
 * workflows can be imported directly via the n8n UI or API.
 */

// ---------------------------------------------------------------------------
// Core n8n types
// ---------------------------------------------------------------------------

/** n8n node position on the editor canvas (in pixels). */
export interface N8NNodePosition {
  x: number;
  y: number;
}

/**
 * Free-form parameters bag for a node.
 * n8n nodes have varying parameter schemas; we keep this generic so callers
 * can supply whichever parameters their chosen node type requires.
 */
export interface N8NNodeParameters {
  [key: string]: unknown;
}

/** A single node inside an n8n workflow. */
export interface N8NNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: N8NNodePosition;
  parameters: N8NNodeParameters;
  /** Optional credential reference, e.g. { id: "...", name: "..." }. */
  credentials?: Record<string, { id: string; name: string }>;
  /** Webhook IDs assigned at runtime by n8n. */
  webhookId?: string;
}

/**
 * Connection map: source node name -> target node name -> connection config.
 *
 * Example:
 * {
 *   "Webhook": { "main": [[ { "node": "Set", "type": "main", "index": 0 } ]] }
 * }
 */
export interface N8NConnections {
  [sourceNodeName: string]: {
    [outputName: string]: Array<Array<{ node: string; type: string; index: number }>>;
  };
}

/** Top-level n8n workflow document. */
export interface N8NWorkflow {
  name: string;
  nodes: N8NNode[];
  connections: N8NConnections;
  /** n8n settings bag (timezone, error workflow, etc.). */
  settings?: Record<string, unknown>;
  /** n8n static data keyed by node name. */
  staticData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nodeCounter = 0;

/** Return a per-process-unique node id. */
function nextNodeId(): string {
  _nodeCounter += 1;
  return `node-${_nodeCounter}`;
}

/**
 * Connect `source` -> `target` on the `main` output at index 0.
 * Modifies the connections map in place.
 */
export function connect(
  connections: N8NConnections,
  source: { node: string; index?: number },
  target: { node: string; index?: number },
): void {
  const srcIdx = source.index ?? 0;
  const tgtIdx = target.index ?? 0;

  connections[source.node] ??= {};
  const outputs = (connections[source.node].main ??= [[]]);
  while (outputs.length <= srcIdx) outputs.push([]);
  outputs[srcIdx].push({ node: target.node, type: 'main', index: tgtIdx });
}

// ---------------------------------------------------------------------------
// Node factory helpers
// ---------------------------------------------------------------------------

interface NodeParams {
  /** Display name in the n8n editor. */
  name: string;
  /** Canvas position. */
  position: N8NNodePosition;
  /** Node-type specific parameters. */
  parameters?: N8NNodeParameters;
  /** Optional credential reference. */
  credentials?: Record<string, { id: string; name: string }>;
}

function makeNode(
  type: string,
  typeVersion: number,
  params: NodeParams,
): N8NNode {
  return {
    id: nextNodeId(),
    name: params.name,
    type,
    typeVersion,
    position: params.position,
    parameters: params.parameters ?? {},
    credentials: params.credentials,
  };
}

// ---------------------------------------------------------------------------
// Public node-creation functions
// ---------------------------------------------------------------------------

/** Create a Webhook trigger node. */
export function createWebhookNode(params: NodeParams & {
  httpMethod?: string;
  path?: string;
  authentication?: 'none' | 'headerAuth' | 'basicAuth';
  responseMode?: 'immediately' | 'whenLastNodeExecutes';
}): N8NNode {
  return makeNode('n8n-nodes-base.webhook', 2, {
    ...params,
    parameters: {
      httpMethod: params.httpMethod ?? 'POST',
      path: params.path ?? 'webhook',
      authentication: params.authentication ?? 'headerAuth',
      responseMode: params.responseMode ?? 'immediately',
      ...params.parameters,
    },
  });
}

/** Create a generic Code node (JavaScript). */
export function createCodeNode(params: NodeParams & {
  jsCode?: string;
}): N8NNode {
  return makeNode('n8n-nodes-base.code', 2, {
    ...params,
    parameters: {
      jsCode: params.jsCode ?? '',
      ...params.parameters,
    },
  });
}

/** Create a Set node (for building / transforming payloads). */
export function createSetNode(params: NodeParams & {
  values?: Record<string, string>;
  keepOnlySet?: boolean;
}): N8NNode {
  return makeNode('n8n-nodes-base.set', 3, {
    ...params,
    parameters: {
      values: params.values ?? {},
      keepOnlySet: params.keepOnlySet ?? false,
      ...params.parameters,
    },
  });
}

/** Create a Switch node (routes based on value matching). */
export function createSwitchNode(params: NodeParams & {
  rules?: Array<{ value1: string; operation: string; value2: string }>;
  fallbackOutput?: boolean;
}): N8NNode {
  return makeNode('n8n-nodes-base.switch', 3, {
    ...params,
    parameters: {
      dataPropertyName: params.parameters?.dataPropertyName ?? 'final_category',
      rules: params.rules ?? [],
      fallbackOutput: params.fallbackOutput ?? true,
      ...params.parameters,
    },
  });
}

/** Create an IF node (simple true/false branching). */
export function createIfNode(params: NodeParams & {
  conditions?: Record<string, unknown>;
}): N8NNode {
  return makeNode('n8n-nodes-base.if', 2, {
    ...params,
    parameters: {
      conditions: params.conditions ?? {},
      ...params.parameters,
    },
  });
}

/** Create an HTTP Request node. */
export function createHttpRequestNode(params: NodeParams & {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): N8NNode {
  return makeNode('n8n-nodes-base.httpRequest', 4, {
    ...params,
    parameters: {
      method: params.method ?? 'POST',
      url: params.url ?? '',
      sendHeaders: params.headers ?? {},
      sendBody: params.body ? true : false,
      bodyParameters: params.body ? { parameters: [{ name: 'body', value: params.body }] } : undefined,
      ...params.parameters,
    },
  });
}

/** Create a Gmail node. */
export function createGmailNode(params: NodeParams & {
  resource?: string;
  operation?: string;
  credentialName?: string;
}): N8NNode {
  return makeNode('n8n-nodes-base.gmail', 2, {
    ...params,
    credentials: params.credentialName
      ? { gmailOAuth2Api: { id: '1', name: params.credentialName } }
      : undefined,
    parameters: {
      resource: params.resource ?? 'message',
      operation: params.operation ?? 'addLabels',
      ...params.parameters,
    },
  });
}

/** Create a Microsoft Outlook node. */
export function createOutlookNode(params: NodeParams & {
  resource?: string;
  operation?: string;
  credentialName?: string;
}): N8NNode {
  return makeNode('n8n-nodes-base.microsoftOutlook', 2, {
    ...params,
    credentials: params.credentialName
      ? { microsoftOutlookOAuth2Api: { id: '1', name: params.credentialName } }
      : undefined,
    parameters: {
      resource: params.resource ?? 'message',
      operation: params.operation ?? 'update',
      ...params.parameters,
    },
  });
}

/** Create a Basic LLM Chain node (DeepSeek / OpenAI-compatible). */
export function createLlmChainNode(params: NodeParams & {
  prompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): N8NNode {
  return makeNode('n8n-nodes-base.llmChain', 1, {
    ...params,
    parameters: {
      prompt: params.prompt ?? '',
      options: {
        temperature: params.temperature ?? 0,
        maxTokens: params.maxTokens ?? 50,
      },
      ...params.parameters,
    },
  });
}

/** Create a Markdown conversion node (HTML -> plain-text). */
export function createMarkdownNode(params: NodeParams & {
  mode?: 'htmlToMarkdown' | 'markdownToHtml';
}): N8NNode {
  return makeNode('n8n-nodes-base.markdown', 1, {
    ...params,
    parameters: {
      mode: params.mode ?? 'htmlToMarkdown',
      ...params.parameters,
    },
  });
}

/** Create a Schedule Trigger node (cron-based). */
export function createScheduleTriggerNode(params: NodeParams & {
  rule?: { interval?: Array<{ field: string; minutesInterval?: number }> };
  cronExpression?: string;
}): N8NNode {
  const parameters: N8NNodeParameters = {};
  if (params.cronExpression) {
    parameters.rule = {
      interval: [{ field: 'cronExpression', expression: params.cronExpression }],
    };
  } else if (params.rule) {
    parameters.rule = params.rule;
  }
  return makeNode('n8n-nodes-base.scheduleTrigger', 2, {
    ...params,
    parameters: { ...parameters, ...params.parameters },
  });
}

/** Create a Split In Batches node. */
export function createSplitInBatchesNode(params: NodeParams & {
  batchSize?: number;
}): N8NNode {
  return makeNode('n8n-nodes-base.splitInBatches', 2, {
    ...params,
    parameters: {
      batchSize: params.batchSize ?? 1,
      ...params.parameters,
    },
  });
}

/** Create a Merge node (combines two parallel branches). */
export function createMergeNode(params: NodeParams & {
  mode?: 'append' | 'combine' | 'multiplex' | 'passThrough' | 'wait';
}): N8NNode {
  return makeNode('n8n-nodes-base.merge', 2, {
    ...params,
    parameters: {
      mode: params.mode ?? 'combine',
      ...params.parameters,
    },
  });
}

// ---------------------------------------------------------------------------
// High-level workflow constructor
// ---------------------------------------------------------------------------

/**
 * Create a complete n8n workflow document from an array of nodes and a
 * connection map.
 *
 * @example
 * ```
 * const nodes: N8NNode[] = [createWebhookNode({...}), createCodeNode({...})];
 * const connections: N8NConnections = {};
 * connect(connections, {node:"Webhook"}, {node:"Code"});
 * const wf = createN8NWorkflow("My Workflow", nodes, connections);
 * ```
 */
export function createN8NWorkflow(
  name: string,
  nodes: N8NNode[],
  connections: N8NConnections,
  settings?: Record<string, unknown>,
): N8NWorkflow {
  return {
    name,
    nodes,
    connections,
    settings: settings ?? { timezone: 'UTC' },
  };
}
