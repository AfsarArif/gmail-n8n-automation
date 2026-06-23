/**
 * env.test.ts
 *
 * Tests for the environment-configuration loader.
 *
 * Because getConfig() reads directly from process.env, each test saves and
 * restores the relevant variables to avoid cross-test contamination.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { getConfig } from './env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default env values that should produce a valid config. */
const VALID_ENV: Record<string, string> = {
  N8N_BASE_URL: 'https://n8n.example.com',
  WF0_SECRET_TOKEN: 'secret-token-123',
  DEEPSEEK_MODEL: 'deepseek-chat',
  DEEPSEEK_API_KEY: 'sk-test-key',
  GMAIL_ACCOUNTS: 'a@gmail.com,b@gmail.com',
  GMAIL_CREDENTIAL_NAMES: 'Gmail - a@gmail.com,Gmail - b@gmail.com',
  OUTLOOK_ACCOUNTS: 'x@hotmail.com',
  OUTLOOK_CREDENTIAL_NAMES: 'Outlook - x@hotmail.com',
};

const SAVED: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
}

function clearEnv(...keys: string[]): void {
  for (const k of keys) delete process.env[k];
}

beforeEach(() => {
  // Save everything we might touch.
  const allKeys = [...Object.keys(VALID_ENV), 'DEEPSEEK_BASE_URL', 'DEEPSEEK_TEMPERATURE',
    'DEEPSEEK_MAX_TOKENS', 'PRE_CLASSIFIER_ENABLED', 'DEFAULT_FALLBACK_CATEGORY',
    'SKIP_AI_IF_LABELED', 'SPAM_DELETE_SCHEDULE_CRON', 'SPAM_DELETE_BATCH_SIZE',
    'SPAM_OLDER_THAN_DAYS', 'GMAIL_POLL_INTERVAL_MINUTES', 'OUTLOOK_POLL_INTERVAL_MINUTES',
    'GMAIL_RATE_LIMIT_QPS', 'OUTLOOK_RATE_LIMIT_PER_10MIN', 'MAX_RETRIES', 'RETRY_DELAY_MS'];
  for (const k of allKeys) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = SAVED[k];
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getConfig', () => {
  it('returns valid config when all required vars are set', () => {
    setEnv(VALID_ENV);
    const config = getConfig();
    assert.strictEqual(config.n8nBaseUrl, 'https://n8n.example.com');
    assert.strictEqual(config.wf0SecretToken, 'secret-token-123');
    assert.strictEqual(config.deepseekModel, 'deepseek-chat');
    assert.deepStrictEqual(config.gmailAccounts, ['a@gmail.com', 'b@gmail.com']);
    assert.deepStrictEqual(config.outlookAccounts, ['x@hotmail.com']);
  });

  it('throws on missing N8N_BASE_URL', () => {
    setEnv({ ...VALID_ENV });
    clearEnv('N8N_BASE_URL');
    assert.throws(() => getConfig(), /N8N_BASE_URL/);
  });

  it('throws on missing WF0_SECRET_TOKEN', () => {
    setEnv({ ...VALID_ENV });
    clearEnv('WF0_SECRET_TOKEN');
    assert.throws(() => getConfig(), /WF0_SECRET_TOKEN/);
  });

  it('throws on invalid N8N_BASE_URL format', () => {
    setEnv({ ...VALID_ENV, N8N_BASE_URL: 'not-a-url' });
    assert.throws(() => getConfig(), /Invalid URL/);
  });

  it('throws when GMAIL_ACCOUNTS and GMAIL_CREDENTIAL_NAMES length mismatch', () => {
    setEnv({ ...VALID_ENV, GMAIL_CREDENTIAL_NAMES: 'only-one' });
    assert.throws(() => getConfig(), /same length/);
  });

  it('throws when OUTLOOK_ACCOUNTS and OUTLOOK_CREDENTIAL_NAMES length mismatch', () => {
    setEnv({ ...VALID_ENV, OUTLOOK_CREDENTIAL_NAMES: '' });
    assert.throws(() => getConfig(), /same length/);
  });

  it('throws on invalid DEFAULT_FALLBACK_CATEGORY', () => {
    setEnv({ ...VALID_ENV, DEFAULT_FALLBACK_CATEGORY: 'bogus' });
    assert.throws(() => getConfig(), /DEFAULT_FALLBACK_CATEGORY/);
  });

  it('applies defaults for optional numeric values', () => {
    setEnv(VALID_ENV);
    const config = getConfig();
    assert.strictEqual(config.deepseekTemperature, 0);
    assert.strictEqual(config.deepseekMaxTokens, 50);
    assert.strictEqual(config.maxRetries, 3);
    assert.strictEqual(config.retryDelayMs, 2000);
    assert.strictEqual(config.spamDeleteBatchSize, 50);
    assert.strictEqual(config.spamOlderThanDays, 1);
    assert.strictEqual(config.gmailPollIntervalMinutes, 1);
    assert.strictEqual(config.outlookPollIntervalMinutes, 1);
  });

  it('applies default fallback category "fyi" when unset', () => {
    setEnv(VALID_ENV);
    const config = getConfig();
    assert.strictEqual(config.defaultFallbackCategory, 'fyi');
  });

  it('applies default DeepSeek base URL when unset', () => {
    setEnv(VALID_ENV);
    const config = getConfig();
    assert.strictEqual(config.deepseekBaseUrl, 'https://api.deepseek.com/v1');
  });

  it('throws on out-of-range deepseek temperature', () => {
    setEnv({ ...VALID_ENV, DEEPSEEK_TEMPERATURE: '3' });
    assert.throws(() => getConfig(), /DEEPSEEK_TEMPERATURE/);
  });

  it('parses boolean PRE_CLASSIFIER_ENABLED correctly', () => {
    setEnv({ ...VALID_ENV, PRE_CLASSIFIER_ENABLED: 'false' });
    assert.strictEqual(getConfig().preClassifierEnabled, false);

    setEnv({ ...VALID_ENV, PRE_CLASSIFIER_ENABLED: '0' });
    assert.strictEqual(getConfig().preClassifierEnabled, false);

    setEnv({ ...VALID_ENV, PRE_CLASSIFIER_ENABLED: 'no' });
    assert.strictEqual(getConfig().preClassifierEnabled, false);

    setEnv({ ...VALID_ENV, PRE_CLASSIFIER_ENABLED: 'true' });
    assert.strictEqual(getConfig().preClassifierEnabled, true);
  });

  it('handles empty account lists', () => {
    setEnv({ ...VALID_ENV, GMAIL_ACCOUNTS: '', GMAIL_CREDENTIAL_NAMES: '' });
    const config = getConfig();
    assert.deepStrictEqual(config.gmailAccounts, []);
    assert.deepStrictEqual(config.gmailCredentialNames, []);
  });

  it('rejects negative MAX_RETRIES', () => {
    setEnv({ ...VALID_ENV, MAX_RETRIES: '-1' });
    assert.throws(() => getConfig(), /MAX_RETRIES/);
  });

  it('rejects non-numeric RETRY_DELAY_MS', () => {
    setEnv({ ...VALID_ENV, RETRY_DELAY_MS: 'abc' });
    assert.throws(() => getConfig(), /RETRY_DELAY_MS/);
  });
});
