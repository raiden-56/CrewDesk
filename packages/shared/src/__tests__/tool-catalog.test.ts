import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG, TOOL_IDS, toolSummary, validateToolInput } from '../tools/catalog.js';

describe('tool catalog', () => {
  it('every high-risk tool requires approval and detailed audit', () => {
    for (const def of Object.values(TOOL_CATALOG)) {
      if (def.category === 'HIGH_RISK') {
        expect(def.requiresApproval).toBe(true);
        expect(def.audit).toBe('DETAILED');
        expect(['HIGH', 'CRITICAL']).toContain(def.risk);
      }
      if (def.category === 'READ') {
        expect(def.requiresApproval).toBe(false);
        expect(def.idempotent).toBe(true);
      }
      expect(def.id).toBe(Object.keys(TOOL_CATALOG).find((k) => TOOL_CATALOG[k] === def));
      expect(def.timeoutMs).toBeGreaterThan(0);
      expect(def.retryPolicy.maxAttempts).toBeGreaterThanOrEqual(1);
    }
  });

  it('non-idempotent write tools never auto-retry', () => {
    for (const def of Object.values(TOOL_CATALOG)) {
      if (!def.idempotent) expect(def.retryPolicy.retryOn).toEqual([]);
    }
  });

  it('validates tool inputs against schemas', () => {
    expect(validateToolInput('web.search', { query: 'cloud storage pricing' }).ok).toBe(true);
    expect(validateToolInput('web.search', { query: 'x' }).ok).toBe(false);
    expect(validateToolInput('report.generate', { title: 'R', content: 'c', format: 'DOCX' }).ok).toBe(false);
    expect(validateToolInput('nope', {}).ok).toBe(false);
    const parsed = validateToolInput('web.search', { query: 'hello world' });
    expect(parsed.ok && (parsed.data as { limit: number }).limit).toBe(5);
  });

  it('produces serializable summaries with JSON schemas', () => {
    for (const id of TOOL_IDS) {
      const s = toolSummary(TOOL_CATALOG[id]!);
      expect(JSON.parse(JSON.stringify(s)).inputSchema.type).toBe('object');
    }
  });
});
