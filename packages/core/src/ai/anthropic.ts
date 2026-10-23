import Anthropic from '@anthropic-ai/sdk';
import { ExecutionError } from '@collabspace/shared';
import type { AiProvider, CompletionRequest, CompletionResult, ProviderContent, ProviderMessage, StopReason } from './provider.js';
import { fromProviderToolName, toProviderToolName } from './provider.js';

/** Models prior to the 4.6 generation still accept sampling parameters. */
const LEGACY_SAMPLING = /claude-(3|opus-4-5|sonnet-4-5|haiku-4-5|opus-4-1|sonnet-4-|opus-4-20)/;

function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((c): Anthropic.ContentBlockParam => {
      if (c.type === 'text') return { type: 'text', text: c.text || ' ' };
      if (c.type === 'tool_use') return { type: 'tool_use', id: c.id, name: toProviderToolName(c.name), input: c.input as Record<string, unknown> };
      return { type: 'tool_result', tool_use_id: c.toolUseId, content: c.content, is_error: c.isError ?? false };
    }),
  }));
}

function fromAnthropicContent(content: Anthropic.ContentBlock[]): ProviderContent[] {
  const out: ProviderContent[] = [];
  for (const block of content) {
    if (block.type === 'text') out.push({ type: 'text', text: block.text });
    else if (block.type === 'tool_use') out.push({ type: 'tool_use', id: block.id, name: fromProviderToolName(block.name), input: block.input });
  }
  return out;
}

function mapStop(reason: Anthropic.Message['stop_reason']): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export function createAnthropicProvider(apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    name: 'anthropic',
    isMock: false,
    supportsTemperature: (model) => LEGACY_SAMPLING.test(model),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const tools: Anthropic.Tool[] = req.tools.map((t) => ({
        name: toProviderToolName(t.name),
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
      const params: Anthropic.MessageCreateParams = {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        ...(tools.length ? { tools, tool_choice: { type: 'auto' } } : {}),
        ...(req.temperature !== null && req.temperature !== undefined && LEGACY_SAMPLING.test(req.model) ? { temperature: req.temperature } : {}),
      };
      const options = { timeout: req.timeoutMs, signal: req.signal };
      try {
        let message: Anthropic.Message;
        if (req.onTextDelta) {
          const stream = client.messages.stream(params, options);
          stream.on('text', (delta) => req.onTextDelta?.(delta));
          message = await stream.finalMessage();
        } else {
          message = await client.messages.create(params, options);
        }
        const stopReason = mapStop(message.stop_reason);
        const result: CompletionResult = {
          content: fromAnthropicContent(message.content),
          stopReason,
          usage: {
            inputTokens: message.usage?.input_tokens ?? null,
            outputTokens: message.usage?.output_tokens ?? null,
            available: typeof message.usage?.input_tokens === 'number',
          },
          model: message.model,
          provider: 'anthropic',
        };
        if (stopReason === 'refusal') {
          const details = (message as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details ?? null;
          result.refusal = { category: details?.category ?? null, explanation: details?.explanation ?? null };
        }
        return result;
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) throw new ExecutionError(`Anthropic rate limit: ${err.message}`, 'RATE_LIMITED');
        if (err instanceof Anthropic.AuthenticationError) throw new ExecutionError('Anthropic authentication failed. Check ANTHROPIC_API_KEY.', 'PERMISSION');
        if (err instanceof Anthropic.BadRequestError) throw new ExecutionError(`Anthropic rejected the request: ${err.message}`, 'PERMANENT');
        if (err instanceof Anthropic.InternalServerError) throw new ExecutionError(`Anthropic server error: ${err.message}`, 'TRANSIENT');
        if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ExecutionError('Anthropic request timed out', 'TIMEOUT');
        if (err instanceof Anthropic.APIConnectionError) throw new ExecutionError(`Anthropic connection error: ${err.message}`, 'TRANSIENT');
        if (err instanceof Anthropic.APIError) throw new ExecutionError(`Anthropic API error ${err.status}: ${err.message}`, (err.status ?? 500) >= 500 ? 'TRANSIENT' : 'PERMANENT');
        if ((err as Error).name === 'AbortError') throw new ExecutionError('Model request aborted', 'TIMEOUT');
        throw err;
      }
    },
  };
}
