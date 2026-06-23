/**
 * error-handler.test.ts
 *
 * Tests for the error classification, retry-config, and logging helpers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ErrorCategory,
  classifyError,
  isRetryable,
  buildRetryConfig,
  logError,
} from './error-handler';

describe('classifyError', () => {
  it('classifies timeout errors as DEEPSEEK_TIMEOUT', () => {
    assert.strictEqual(
      classifyError(new Error('Request timed out')),
      ErrorCategory.DEEPSEEK_TIMEOUT,
    );
    assert.strictEqual(
      classifyError(new Error('ETIMEDOUT')),
      ErrorCategory.DEEPSEEK_TIMEOUT,
    );
    assert.strictEqual(
      classifyError(new Error('ECONNABORTED')),
      ErrorCategory.DEEPSEEK_TIMEOUT,
    );
  });

  it('classifies JSON parse errors as DEEPSEEK_INVALID_JSON', () => {
    assert.strictEqual(
      classifyError(new Error('invalid json response')),
      ErrorCategory.DEEPSEEK_INVALID_JSON,
    );
    assert.strictEqual(
      classifyError(new Error('JSON parse error at position 42')),
      ErrorCategory.DEEPSEEK_INVALID_JSON,
    );
  });

  it('classifies 429 errors as GMAIL_RATE_LIMIT', () => {
    assert.strictEqual(
      classifyError(new Error('429 Too Many Requests')),
      ErrorCategory.GMAIL_RATE_LIMIT,
    );
    assert.strictEqual(
      classifyError(new Error('rate limit exceeded')),
      ErrorCategory.GMAIL_RATE_LIMIT,
    );
    assert.strictEqual(
      classifyError(new Error('user-rate-limit-exceeded')),
      ErrorCategory.GMAIL_RATE_LIMIT,
    );
    assert.strictEqual(
      classifyError(new Error('quota exceeded')),
      ErrorCategory.GMAIL_RATE_LIMIT,
    );
  });

  it('classifies Outlook auth expiry', () => {
    assert.strictEqual(
      classifyError(new Error('Outlook OAuth token expired')),
      ErrorCategory.OUTLOOK_AUTH_EXPIRED,
    );
    assert.strictEqual(
      classifyError(new Error('microsoft auth invalid_grant')),
      ErrorCategory.OUTLOOK_AUTH_EXPIRED,
    );
  });

  it('classifies dedup errors', () => {
    assert.strictEqual(
      classifyError(new Error('dedup check failed')),
      ErrorCategory.DEDUP_FAILED,
    );
    assert.strictEqual(
      classifyError(new Error('message already labeled')),
      ErrorCategory.DEDUP_FAILED,
    );
  });

  it('classifies network errors', () => {
    assert.strictEqual(
      classifyError(new Error('ECONNREFUSED')),
      ErrorCategory.NETWORK_ERROR,
    );
    assert.strictEqual(
      classifyError(new Error('ENOTFOUND example.com')),
      ErrorCategory.NETWORK_ERROR,
    );
    assert.strictEqual(
      classifyError(new Error('socket hang up')),
      ErrorCategory.NETWORK_ERROR,
    );
    assert.strictEqual(
      classifyError(new Error('fetch failed')),
      ErrorCategory.NETWORK_ERROR,
    );
  });

  it('returns UNKNOWN for unrecognised errors', () => {
    assert.strictEqual(
      classifyError(new Error('something unexpected happened')),
      ErrorCategory.UNKNOWN,
    );
    assert.strictEqual(classifyError('just a string'), ErrorCategory.UNKNOWN);
  });

  it('classifies error-like objects with status codes', () => {
    assert.strictEqual(
      classifyError({ status: 429, message: 'rate limited' }),
      ErrorCategory.GMAIL_RATE_LIMIT,
    );
    assert.strictEqual(
      classifyError({ status: 401, message: 'Outlook token expired' }),
      ErrorCategory.OUTLOOK_AUTH_EXPIRED,
    );
  });

  it('classifies generic 401 as UNKNOWN (no provider context)', () => {
    assert.strictEqual(
      classifyError({ status: 401, message: 'unauthorized' }),
      ErrorCategory.UNKNOWN,
    );
  });
});

describe('isRetryable', () => {
  it('returns true for transient categories', () => {
    assert.strictEqual(isRetryable(ErrorCategory.DEEPSEEK_TIMEOUT), true);
    assert.strictEqual(isRetryable(ErrorCategory.GMAIL_RATE_LIMIT), true);
    assert.strictEqual(isRetryable(ErrorCategory.NETWORK_ERROR), true);
  });

  it('returns false for permanent categories', () => {
    assert.strictEqual(isRetryable(ErrorCategory.DEEPSEEK_INVALID_JSON), false);
    assert.strictEqual(isRetryable(ErrorCategory.OUTLOOK_AUTH_EXPIRED), false);
    assert.strictEqual(isRetryable(ErrorCategory.DEDUP_FAILED), false);
    assert.strictEqual(isRetryable(ErrorCategory.UNKNOWN), false);
  });
});

describe('buildRetryConfig', () => {
  it('builds a config with the given values', () => {
    const config = buildRetryConfig(5, 1000);
    assert.strictEqual(config.maxRetries, 5);
    assert.strictEqual(config.delayMs, 1000);
  });
});

describe('logError', () => {
  it('writes structured JSON to stderr', () => {
    const write = process.stderr.write;
    let captured = '';
    process.stderr.write = ((chunk: unknown) => {
      captured += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      logError('TestContext', new Error('boom'), ErrorCategory.NETWORK_ERROR);
      const parsed = JSON.parse(captured.trim());
      assert.strictEqual(parsed.context, 'TestContext');
      assert.strictEqual(parsed.category, 'NETWORK_ERROR');
      assert.strictEqual(parsed.message, 'boom');
      assert.strictEqual(parsed.retryable, true);
      assert.ok(typeof parsed.timestamp === 'string');
    } finally {
      process.stderr.write = write;
    }
  });
});
