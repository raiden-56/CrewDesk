import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, IconButton, LinearProgress, MenuItem, Select, Switch, TextField, Tooltip, FormControlLabel } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw, Send, X, ListPlus, FileText, Paperclip, Wand2 } from 'lucide-react';
import type { MessageDto, TaskDto } from '@collabspace/shared';
import { useUiStore } from '@/store/ui';
import { useCan } from '@/store/auth';
import { useAgents, useConversation, useMessages, useTask, useApprovals } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { onRealtime } from '@/lib/realtime';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { Markdown } from '@/components/common/Markdown';
import { StatusChip } from '@/components/common/StatusChip';
import { ShimmerConversation } from '@/components/shimmer';
import { EmptyState, ErrorState } from '@/components/common/States';
import { TaskComposer } from '@/pages/tasks/TaskComposer';
import { timeAgo } from '@/lib/format';

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const chatAgentId = useUiStore((s) => s.chatAgentId);
  const setChatAgentId = useUiStore((s) => s.setChatAgentId);
  const notify = useUiStore((s) => s.notify);
  const canChat = useCan('chat.use');
  const canCreateTask = useCan('task.create');
  const agents = useAgents({ status: undefined });
  const agentList = useMemo(() => (agents.data?.items ?? []).filter((a) => a.status !== 'ARCHIVED'), [agents.data]);
  const agentId = chatAgentId ?? agentList[0]?.id ?? null;
  const agent = agentList.find((a) => a.id === agentId) ?? null;
  const conversation = useConversation(agentId);
  const messages = useMessages(conversation.data?.id);
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [taskMode, setTaskMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onRealtime((e) => {
      if (e.type === 'message.delta' && e.conversationId === conversation.data?.id) setDeltas((d) => ({ ...d, [e.messageId]: e.delta }));
      if (e.type === 'message.created' && e.conversationId === conversation.data?.id) setDeltas((d) => { const { [e.message.id]: _drop, ...rest } = d; void _drop; return rest; });
    });
  }, [conversation.data?.id]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.data?.items.length, deltas]);

  const send = async () => {
    const content = input.trim();
    if (!content || !conversation.data || !agentId) return;
    setSending(true);
    try {
      if (taskMode) {
        const task = await api.post<TaskDto>('/agent-tasks', { title: content.slice(0, 120), description: content, agentId, conversationId: conversation.data.id });
        await api.post(`/conversations/${conversation.data.id}/messages`, { content: `[Task created: ${task.title}]` }).catch(() => undefined);
        notify('Task submitted to the queue', 'success');
        void qc.invalidateQueries({ queryKey: ['tasks'] });
      } else {
        await api.post(`/conversations/${conversation.data.id}/messages`, { content });
      }
      setInput('');
      void qc.invalidateQueries({ queryKey: ['messages', conversation.data.id] });
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const retry = async (m: MessageDto) => {
    if (!conversation.data) return;
    await api.post(`/conversations/${conversation.data.id}/messages/${m.id}/retry`).catch((err) => notify(errorMessage(err), 'error'));
    void qc.invalidateQueries({ queryKey: ['messages', conversation.data.id] });
  };

  return (
    <div className="h-full flex flex-col bg-surface" data-testid="chat-panel">
      <div className="flex items-center gap-2 px-3 h-[var(--cs-header-h)] border-b border-border">
        {agent && <AgentAvatar avatar={agent.avatar} color={agent.color} name={agent.name} size={32} status={agent.status} />}
        <div className="min-w-0 flex-1">
          <Select size="small" value={agentId ?? ''} onChange={(e) => setChatAgentId(e.target.value)} displayEmpty variant="standard" disableUnderline sx={{ fontWeight: 600, fontSize: 13.5 }} inputProps={{ 'aria-label': 'Select agent' }}>
            {agentList.map((a) => (
              <MenuItem key={a.id} value={a.id}>{a.name} · {a.category.toLowerCase().replace(/_/g, ' ')}</MenuItem>
            ))}
          </Select>
          <div className="text-[11px] text-text-3 truncate">{taskMode ? 'Task mode: messages become queued tasks with real execution' : 'Conversational mode: no tools, knowledge-grounded answers'}</div>
        </div>
        <IconButton size="small" onClick={onClose} aria-label="Close chat"><X size={16} /></IconButton>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {!canChat && <EmptyState title="Chat is not available for your role" description="Ask a workspace admin for chat access." compact />}
        {canChat && (conversation.isPending || messages.isPending) && <ShimmerConversation />}
        {canChat && messages.isError && <ErrorState error={messages.error} onRetry={() => messages.refetch()} compact />}
        {canChat && messages.data && messages.data.items.length === 0 && <EmptyState icon={Wand2} title={`Say hello to ${agent?.name ?? 'your agent'}`} description="Ask a question, or switch to task mode to assign real work with tools, approvals and artifacts." compact />}
        {messages.data?.items.map((m) => (
          <MessageBubble key={m.id} message={m} agent={agent} delta={deltas[m.id]} onRetry={() => retry(m)} onCreateTask={canCreateTask ? () => setComposerSeed(m.content) : undefined} />
        ))}
      </div>

      <div className="border-t border-border p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <FormControlLabel control={<Switch size="small" checked={taskMode} onChange={(e) => setTaskMode(e.target.checked)} disabled={!canCreateTask} />} label={<span className="text-[12px]">Task mode</span>} />
          <Tooltip title="Attach files by assigning a task with input files"><span><IconButton size="small" disabled aria-label="Attach"><Paperclip size={15} /></IconButton></span></Tooltip>
        </div>
        <div className="flex gap-2 items-end">
          <TextField fullWidth multiline maxRows={5} size="small" placeholder={taskMode ? 'Describe the job to run as a task…' : `Message ${agent?.name ?? 'agent'}…`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} disabled={!canChat || sending} inputProps={{ 'aria-label': 'Message input', 'data-testid': 'chat-input' }} />
          <Button variant="contained" onClick={send} disabled={!canChat || sending || !input.trim()} sx={{ minWidth: 40, px: 1.5 }} aria-label="Send" data-testid="chat-send"><Send size={16} /></Button>
        </div>
      </div>
      {composerSeed !== null && agentId && <TaskComposer open onClose={() => setComposerSeed(null)} initial={{ agentId, title: composerSeed.split('\n')[0]?.slice(0, 100) ?? 'Follow-up task', description: composerSeed, conversationId: conversation.data?.id }} />}
    </div>
  );
}

function MessageBubble({ message: m, agent, delta, onRetry, onCreateTask }: { message: MessageDto; agent: { name: string; avatar: string; color: string } | null; delta?: string; onRetry: () => void; onCreateTask?: () => void }) {
  const isUser = m.role === 'USER';
  const streaming = m.status === 'STREAMING' || m.status === 'PENDING';
  const text = streaming && delta ? delta : m.content;
  const sources = (m.metadata?.sources as Array<{ title: string; url: string | null }> | undefined) ?? [];
  if (m.kind === 'EXECUTION' || m.kind === 'ERROR') return <ExecutionCard message={m} agent={agent} />;
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && agent && <AgentAvatar avatar={agent.avatar} color={agent.color} name={agent.name} size={28} />}
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${isUser ? 'bg-primary text-white rounded-br-md' : 'bg-surface-2 border border-border rounded-bl-md'}`}>
        {streaming && !text && <div className="flex items-center gap-1 py-1" aria-label="Agent is typing"><span className="h-1.5 w-1.5 rounded-full bg-text-3 animate-bounce" /><span className="h-1.5 w-1.5 rounded-full bg-text-3 animate-bounce [animation-delay:120ms]" /><span className="h-1.5 w-1.5 rounded-full bg-text-3 animate-bounce [animation-delay:240ms]" /></div>}
        {isUser ? <div className="whitespace-pre-wrap text-[13.5px]">{text}</div> : text && <Markdown>{text}</Markdown>}
        {!isUser && sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {sources.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10.5px] text-text-2"><FileText size={10} /> {s.title}</span>
            ))}
          </div>
        )}
        {!isUser && !streaming && (
          <div className="mt-1.5 flex items-center gap-1 text-text-3">
            <span className="text-[10.5px] mr-auto">{timeAgo(m.createdAt)}{m.metadata?.isMock ? ' · mock provider' : ''}{m.usage ? ` · ${m.usage.inputTokens ?? '?'}/${m.usage.outputTokens ?? '?'} tokens` : ''}</span>
            <Tooltip title="Copy"><IconButton size="small" onClick={() => navigator.clipboard?.writeText(m.content)} aria-label="Copy response"><Copy size={13} /></IconButton></Tooltip>
            <Tooltip title="Regenerate"><IconButton size="small" onClick={onRetry} aria-label="Retry response"><RefreshCw size={13} /></IconButton></Tooltip>
            {onCreateTask && <Tooltip title="Create task from response"><IconButton size="small" onClick={onCreateTask} aria-label="Create task from response"><ListPlus size={13} /></IconButton></Tooltip>}
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionCard({ message: m, agent }: { message: MessageDto; agent: { name: string; avatar: string; color: string } | null }) {
  const task = useTask(m.taskId);
  const approvals = useApprovals({ taskId: m.taskId ?? undefined, status: 'PENDING', pageSize: 1 });
  const t = task.data;
  const pending = approvals.data?.items[0];
  return (
    <div className="flex gap-2">
      {agent && <AgentAvatar avatar={agent.avatar} color={agent.color} name={agent.name} size={28} />}
      <div className="flex-1 cs-card p-3 flex flex-col gap-2 bg-surface-2">
        <div className="flex items-center gap-2">
          <span className="cs-label">{m.kind === 'ERROR' ? 'Execution failed' : 'Task execution'}</span>
          {t && <StatusChip status={t.status} pulse={t.status === 'RUNNING'} />}
          {m.taskId && <Link to={`/tasks/${m.taskId}`} className="ml-auto text-[11.5px] text-accent hover:underline">Open task</Link>}
        </div>
        {t && t.status === 'RUNNING' && (
          <div>
            <LinearProgress variant="determinate" value={t.progress} />
            <div className="text-[11px] text-text-3 mt-1">{t.progressMessage}</div>
          </div>
        )}
        {pending && (
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-2.5 py-2 text-[12px]">
            <div className="font-semibold text-warning">Approval required: {pending.actionTitle}</div>
            <div className="text-text-2 mt-0.5">{pending.targetResource ?? pending.actionDescription}</div>
            <Link to={`/approvals/${pending.id}`} className="text-accent hover:underline">Review in Approval Center</Link>
          </div>
        )}
        <Markdown className="text-[13px]">{m.content}</Markdown>
        {t && t.artifactCount > 0 && <div className="text-[11.5px] text-text-3">{t.artifactCount} artifact(s) produced — see Files or the task.</div>}
      </div>
    </div>
  );
}
