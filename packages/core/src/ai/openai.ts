import OpenAI from 'openai';
import { ExecutionError } from '@collabspace/shared';
import type { AiProvider, CompletionRequest, CompletionResult, ProviderContent, ProviderMessage, StopReason } from './provider.js';
import { fromProviderToolName, toProviderToolName } from './provider.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAiMessages(system: string, messages: ProviderMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
      const results = m.content.filter((c) => c.type === 'tool_result');
      for (const r of results) {
        if (r.type === 'tool_result') out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
      }
      if (text.trim()) out.push({ role: 'user', content: text });
    } else {
      const text = m.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
      const toolCalls = m.content
        .filter((c) => c.type === 'tool_use')
        .map((c) => {
          const t = c as { id: string; name: string; input: unknown };
          return { id: t.id, type: 'function' as const, function: { name: toProviderToolName(t.name), arguments: JSON.stringify(t.input ?? {}) } };
        });
      out.push({ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    }
  }
  return out;
}

function mapFinish(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

export function createOpenAiProvider(apiKey: string, baseURL?: string, embeddingsModel = 'text-embedding-3-small'): AiProvider {
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined, maxRetries: 2 });
  return {
    name: 'openai',
    isMock: false,
    supportsTemperature: () => true,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const tools = req.tools.map((t) => ({
        type: 'function' as const,
        function: { name: toProviderToolName(t.name), description: t.description, parameters: t.inputSchema },
      }));
      try {
        const response = await client.chat.completions.create(
          {
            model: req.model,
            messages: toOpenAiMessages(req.system, req.messages),
            ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
            max_completion_tokens: req.maxOutputTokens,
            ...(req.temperature !== null && req.temperature !== undefined ? { temperature: req.temperature } : {}),
          },
          { timeout: req.timeoutMs, signal: req.signal },
        );
        const choice = response.choices[0];
        const content: ProviderContent[] = [];
        const msg = choice?.message;
        if (msg?.content) {
          content.push({ type: 'text', text: msg.content });
          req.onTextDelta?.(msg.content);
        }
        for (const call of msg?.tool_calls ?? []) {
          if (call.type !== 'function') continue;
          let input: unknown = {};
          try {
            input = JSON.parse(call.function.arguments || '{}');
          } catch {
            input = { __parseError: call.function.arguments };
          }
          content.push({ type: 'tool_use', id: call.id, name: fromProviderToolName(call.function.name), input });
        }
        let stopReason = mapFinish(choice?.finish_reason);
        if (stopReason === 'end_turn' && content.some((c) => c.type === 'tool_use')) stopReason = 'tool_use';
        return {
          content,
          stopReason,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? null,
            outputTokens: response.usage?.completion_tokens ?? null,
            available: typeof response.usage?.prompt_tokens === 'number',
          },
          model: response.model,
          provider: 'openai',
          ...(stopReason === 'refusal' ? { refusal: { category: 'content_filter', explanation: msg?.refusal ?? null } } : {}),
        };
      } catch (err) {
        if (err instanceof OpenAI.RateLimitError) throw new ExecutionError(`OpenAI rate limit: ${err.message}`, 'RATE_LIMITED');
        if (err instanceof OpenAI.AuthenticationError) throw new ExecutionError('OpenAI authentication failed. Check OPENAI_API_KEY.', 'PERMISSION');
        if (err instanceof OpenAI.BadRequestError) throw new ExecutionError(`OpenAI rejected the request: ${err.message}`, 'PERMANENT');
        if (err instanceof OpenAI.APIConnectionTimeoutError) throw new ExecutionError('OpenAI request timed out', 'TIMEOUT');
        if (err instanceof OpenAI.APIConnectionError) throw new ExecutionError(`OpenAI connection error: ${err.message}`, 'TRANSIENT');
        if (err instanceof OpenAI.APIError) throw new ExecutionError(`OpenAI API error ${err.status}: ${err.message}`, (err.status ?? 500) >= 500 ? 'TRANSIENT' : 'PERMANENT');
        throw err;
      }
    },
    async embed(texts: string[], model = embeddingsModel): Promise<number[][]> {
      const res = await client.embeddings.create({ model, input: texts });
      return res.data.map((d) => d.embedding);
    },
  };
}
