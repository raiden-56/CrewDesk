import { describe, expect, it } from 'vitest';
import { CreateAgentSchema, CreateTaskSchema, ModelConfigSchema } from '../schemas/api.js';
import { AGENT_TEMPLATES, renderInstructions } from '../agent-templates.js';

describe('agent configuration validation', () => {
  it('accepts a template-based agent', () => {
    const t = AGENT_TEMPLATES.RESEARCHER;
    const parsed = CreateAgentSchema.safeParse({
      name: 'Alex',
      category: 'RESEARCHER',
      instructions: t.instructions,
      modelConfig: {},
      tools: t.defaultTools,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.modelConfig.maxOutputTokens).toBe(4096);
      expect(parsed.data.knowledge.allowProjectDocuments).toBe(true);
    }
  });

  it('rejects unknown tools and bad model values', () => {
    expect(CreateAgentSchema.safeParse({ name: 'A', category: 'RESEARCHER', instructions: {}, modelConfig: {}, tools: ['shell.exec'] }).success).toBe(false);
    expect(ModelConfigSchema.safeParse({ temperature: 5 }).success).toBe(false);
    expect(ModelConfigSchema.safeParse({ provider: 'gemini' }).success).toBe(false);
    expect(CreateAgentSchema.safeParse({ name: 'A', category: 'WIZARD', instructions: {}, modelConfig: {} }).success).toBe(false);
  });

  it('renders instruction sets to markdown and skips empty sections', () => {
    const md = renderInstructions({ ...AGENT_TEMPLATES.GENERAL_ASSISTANT.instructions, examples: '' });
    expect(md).toContain('## Role');
    expect(md).not.toContain('## Examples');
  });

  it('validates task creation input', () => {
    const ok = CreateTaskSchema.safeParse({ title: 'Research', agentId: 'a1' });
    expect(ok.success).toBe(true);
    expect(CreateTaskSchema.safeParse({ title: 'R', agentId: 'a1' }).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ title: 'Research', agentId: 'a1', deadline: 'tomorrow' }).success).toBe(false);
  });

  it('every template has default tools that exist in the catalog', async () => {
    const { TOOL_CATALOG } = await import('../tools/catalog.js');
    for (const t of Object.values(AGENT_TEMPLATES)) {
      for (const tool of t.defaultTools) expect(TOOL_CATALOG[tool], `${t.name} -> ${tool}`).toBeDefined();
    }
  });
});
