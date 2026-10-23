/**
 * Provider-independent AI adapter contract. The execution engine only talks to
 * this interface; concrete adapters (anthropic, openai, mock) translate to the
 * provider wire format.
 */
export type ProviderContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: ProviderContent[];
}

export interface ProviderToolDef {
  /** tool id as known by the platform (e.g. "web.search") */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools: ProviderToolDef[];
  maxOutputTokens: number;
  temperature?: number | null;
  timeoutMs: number;
  signal?: AbortSignal;
  /** streaming text callback (optional, used by chat) */
  onTextDelta?: (delta: string) => void;
  metadata?: { taskId?: string; attempt?: number; agentName?: string; conversationId?: string };
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface CompletionUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** false when the provider did not return usage metadata */
  available: boolean;
}

export interface CompletionResult {
  content: ProviderContent[];
  stopReason: StopReason;
  usage: CompletionUsage;
  model: string;
  provider: string;
  refusal?: { category: string | null; explanation: string | null };
}

export interface AiProvider {
  readonly name: 'anthropic' | 'openai' | 'mock';
  readonly isMock: boolean;
  readonly supportsTemperature: (model: string) => boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  embed?(texts: string[], model?: string): Promise<number[][]>;
}

/** Provider tool names must match ^[a-zA-Z0-9_-]{1,64}$ so dots are replaced. */
export function toProviderToolName(id: string): string {
  return id.replace(/\./g, '__');
}
export function fromProviderToolName(name: string): string {
  return name.replace(/__/g, '.');
}

export function textOf(content: ProviderContent[]): string {
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

export function toolUsesOf(content: ProviderContent[]): Array<{ type: 'tool_use'; id: string; name: string; input: unknown }> {
  return content.filter((c): c is { type: 'tool_use'; id: string; name: string; input: unknown } => c.type === 'tool_use');
}

/** Rough token estimate used for budgeting before a provider reports actual usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
