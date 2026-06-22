/**
 * rate-limiter.test.ts
 *
 * Tests for the sliding-window rate limiter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  describe('checkLimit', () => {
    it('allows requests when under the limit', () => {
      const rl = new RateLimiter();
      assert.strictEqual(rl.checkLimit('gmail'), true);
      assert.strictEqual(rl.checkLimit('outlook'), true);
    });

    it('blocks requests when at the limit for gmail', () => {
      const rl = new RateLimiter();
      // Fill the window (250 requests in 1s).
      for (let i = 0; i < 250; i++) {
        rl.recordRequest('gmail');
      }
      assert.strictEqual(rl.checkLimit('gmail'), false);
    });

    it('allows outlook requests while gmail is limited', () => {
      const rl = new RateLimiter();
      for (let i = 0; i < 250; i++) {
        rl.recordRequest('gmail');
      }
      assert.strictEqual(rl.checkLimit('gmail'), false);
      assert.strictEqual(rl.checkLimit('outlook'), true);
    });

    it('blocks outlook at 10 000 requests', () => {
      const rl = new RateLimiter();
      for (let i = 0; i < 10_000; i++) {
        rl.recordRequest('outlook');
      }
      assert.strictEqual(rl.checkLimit('outlook'), false);
    });
  });

  describe('recordRequest', () => {
    it('tracks requests independently per account type', () => {
      const rl = new RateLimiter();
      rl.recordRequest('gmail');
      rl.recordRequest('gmail');
      rl.recordRequest('outlook');
      assert.strictEqual(rl.checkLimit('gmail'), true); // 2 < 250
      assert.strictEqual(rl.checkLimit('outlook'), true); // 1 < 10000
    });
  });

  describe('waitIfNeeded', () => {
    it('returns immediately when under the limit', async () => {
      const rl = new RateLimiter();
      const start = Date.now();
      await rl.waitIfNeeded('gmail');
      assert.ok(Date.now() - start < 50); // should be near-instant
    });

    it('blocks until a slot opens when at capacity', async () => {
      const rl = new RateLimiter();
      // Fill the gmail window to capacity (250 requests in 1s).
      for (let i = 0; i < 250; i++) {
        rl.recordRequest('gmail');
      }
      // checkLimit should now report blocked.
      assert.strictEqual(rl.checkLimit('gmail'), false);

      // waitIfNeeded should resolve after ~1s when the window slides.
      const start = Date.now();
      await rl.waitIfNeeded('gmail');
      const elapsed = Date.now() - start;
      // Should have waited close to 1 second (plus small overhead).
      assert.ok(elapsed >= 900, `expected >= 900ms but got ${elapsed}ms`);
      // After waiting, the limit should be open again.
      assert.strictEqual(rl.checkLimit('gmail'), true);
    });
  });

  describe('sliding window pruning', () => {
    it('recovers capacity after the window slides (indirect pruning test)', async () => {
      const rl = new RateLimiter();
      // Fill the gmail window to capacity.
      for (let i = 0; i < 250; i++) {
        rl.recordRequest('gmail');
      }
      assert.strictEqual(rl.checkLimit('gmail'), false);

      // After waiting for the 1-second window to elapse, capacity recovers.
      await new Promise((r) => setTimeout(r, 1100));
      assert.strictEqual(rl.checkLimit('gmail'), true);
    });

    it('keeps capacity when requests are within the window', () => {
      const rl = new RateLimiter();
      // Record 100 requests — well under the 250 limit.
      for (let i = 0; i < 100; i++) {
        rl.recordRequest('gmail');
      }
      assert.strictEqual(rl.checkLimit('gmail'), true);
      // Outlook should be unaffected.
      assert.strictEqual(rl.checkLimit('outlook'), true);
    });
  });
});
