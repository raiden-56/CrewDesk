import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Step, StepLabel, Stepper, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, useMediaQuery, useTheme, CircularProgress } from '@mui/material';
import Editor from '@monaco-editor/react';
import { useQueryClient } from '@tanstack/react-query';
import { AGENT_CATEGORIES, AGENT_CATEGORY_LABELS, AGENT_TEMPLATES, renderInstructions, TOOL_CATALOG, TOOL_GROUPS, type AgentCategory, type AgentDto, type CreateAgentInput, type InstructionSet, type ModelConfig } from '@collabspace/shared';
import { useUiStore } from '@/store/ui';
import { useCan } from '@/store/auth';
import { useAgent, useHealth, useKnowledge, useProjects, useTools } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { RiskChip } from '@/components/common/StatusChip';
import { useResolvedMode } from '@/theme/ThemeProvider';
import { Markdown } from '@/components/common/Markdown';

const STEPS = ['Identity', 'Role & instructions', 'Model', 'Tools & permissions', 'Knowledge', 'Review & test'];
const AVATARS = ['researcher', 'planner', 'qa', 'docs', 'general', 'analyst', 'meeting', 'product', 'code', 'support', 'security', 'coordinator'];
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6', '#06b6d4', '#ef4444', '#a855f7'];
const SECTIONS: Array<{ key: keyof InstructionSet; label: string; rows: number }> = [
  { key: 'role', label: 'Role', rows: 2 },
  { key: 'responsibilities', label: 'Responsibilities', rows: 4 },
  { key: 'goals', label: 'Goals', rows: 2 },
  { key: 'operatingRules', label: 'Operating rules', rows: 5 },
  { key: 'outputFormat', label: 'Expected output format', rows: 3 },
  { key: 'constraints', label: 'Constraints', rows: 2 },
  { key: 'escalationRules', label: 'Escalation rules', rows: 2 },
  { key: 'examples', label: 'Examples', rows: 3 },
];
const HEADING_TO_KEY: Record<string, keyof InstructionSet> = { role: 'role', responsibilities: 'responsibilities', goals: 'goals', 'operating rules': 'operatingRules', 'expected output format': 'outputFormat', constraints: 'constraints', 'escalation rules': 'escalationRules', examples: 'examples' };

function parseMarkdown(md: string, base: InstructionSet): InstructionSet {
  const out: InstructionSet = { ...base };
  const parts = md.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const [heading, ...rest] = part.split('\n');
    const key = HEADING_TO_KEY[(heading ?? '').trim().toLowerCase()];
    if (key) out[key] = rest.join('\n').trim();
  }
  return out;
}

const DEFAULT_MODEL: ModelConfig = { provider: null, model: null, temperature: null, maxOutputTokens: 4096, timeoutMs: 600000, maxRetries: 2, maxTokensPerTask: null, budgetUsd: null };

type Draft = CreateAgentInput;

function draftFromAgent(a: AgentDto): Draft {
  return { name: a.name, avatar: a.avatar, color: a.color, description: a.description, category: a.category, projectId: a.projectId, instructions: a.instructions, modelConfig: { ...DEFAULT_MODEL, ...a.modelConfig }, tools: a.tools, knowledge: a.knowledge };
}

function freshDraft(): Draft {
  const t = AGENT_TEMPLATES.RESEARCHER;
  return { name: '', avatar: t.avatar, color: t.color, description: '', category: 'RESEARCHER', projectId: null, instructions: { ...t.instructions }, modelConfig: { ...DEFAULT_MODEL }, tools: [...t.defaultTools], knowledge: { sourceIds: [], allowWorkspaceKnowledge: false, allowProjectDocuments: true, allowPreviousReports: false } };
}

export function AgentWizard() {
  const open = useUiStore((s) => s.wizardOpen);
  const editId = useUiStore((s) => s.wizardAgentId);
  const setOpen = useUiStore((s) => s.setWizardOpen);
  const notify = useUiStore((s) => s.notify);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const mode = useResolvedMode();
  const canModel = useCan('agent.model.configure');
  const existing = useAgent(editId);
  const projects = useProjects();
  const tools = useTools();
  const knowledge = useKnowledge({ pageSize: 100 });
  const health = useHealth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const [editorMode, setEditorMode] = useState<'structured' | 'markdown'>('structured');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [testPrompt, setTestPrompt] = useState('Summarize what you can help with and which tools you would use.');
  const [testResult, setTestResult] = useState<{ text: string; provider: string; model: string; isMock: boolean; durationMs: number; usage: { inputTokens: number | null; outputTokens: number | null; available: boolean } } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    setValidation(null);
    setTestResult(null);
    setEditorMode('structured');
    if (!editId) setDraft(freshDraft());
  }, [open, editId]);
  useEffect(() => {
    if (open && editId && existing.data) setDraft(draftFromAgent(existing.data));
  }, [open, editId, existing.data]);

  const applyTemplate = (category: AgentCategory) => {
    const t = AGENT_TEMPLATES[category];
    setDraft((d) => ({ ...d, category, avatar: t.avatar, color: t.color, instructions: { ...t.instructions }, tools: [...t.defaultTools], description: d.description || t.description }));
  };
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const toolItems = tools.data?.items ?? [];
  const selectedTools = draft.tools.map((id) => TOOL_CATALOG[id]).filter(Boolean);
  const summary = useMemo(() => ({ read: selectedTools.filter((t) => t!.category === 'READ').length, write: selectedTools.filter((t) => t!.category === 'WRITE').length, high: selectedTools.filter((t) => t!.category === 'HIGH_RISK').length, approvals: selectedTools.filter((t) => t!.requiresApproval).length, unavailable: draft.tools.filter((id) => toolItems.find((t) => t.id === id && !t.available)).length }), [selectedTools, draft.tools, toolItems]);

  const canNext = step === 0 ? draft.name.trim().length >= 2 : true;

  const validate = async () => {
    try {
      const v = await api.post<{ valid: boolean; errors: string[]; warnings: string[] }>('/agents/validate', draft);
      setValidation(v);
      return v.valid;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const goNext = async () => {
    setError(null);
    if (step === 1 && editorMode === 'markdown') update({ instructions: parseMarkdown(markdown, draft.instructions) });
    if (step === 4) await validate();
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(await api.post('/agents/test', { prompt: testPrompt, config: draft }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { ...draft, changeSummary: editId ? 'Edited in wizard' : 'Created in wizard' };
      const agent = editId ? await api.patch<AgentDto>(`/agents/${editId}`, payload) : await api.post<AgentDto>('/agents', payload);
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', agent.id] });
      notify(editId ? `${agent.name} updated (version ${agent.currentVersion})` : `${agent.name} joined the team`, 'success');
      setOpen(false);
      navigate(`/team/${agent.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const models = health.data?.aiProvider.models ?? [];

  return (
    <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="md" fullScreen={fullScreen} data-testid="agent-wizard">
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600, pb: 1 }}>{editId ? `Edit ${existing.data?.name ?? 'agent'}` : 'New AI team member'}</DialogTitle>
      <div className="px-6 pb-2 overflow-x-auto">
        <Stepper activeStep={step} alternativeLabel={!fullScreen} sx={{ minWidth: 640 }}>
          {STEPS.map((label, i) => (
            <Step key={label} completed={i < step}><StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: 12 } }}>{label}</StepLabel></Step>
          ))}
        </Stepper>
      </div>
      <DialogContent dividers sx={{ minHeight: 380 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {editId && existing.isPending && <div className="flex justify-center py-10"><CircularProgress size={24} /></div>}

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <AgentAvatar avatar={draft.avatar} color={draft.color} name={draft.name || 'Agent'} size={56} />
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Agent name" value={draft.name} onChange={(e) => update({ name: e.target.value })} size="small" autoFocus inputProps={{ 'data-testid': 'wizard-name' }} />
                <TextField select label="Category" value={draft.category} onChange={(e) => applyTemplate(e.target.value as AgentCategory)} size="small" inputProps={{ 'data-testid': 'wizard-category' }}>
                  {AGENT_CATEGORIES.map((c) => (<MenuItem key={c} value={c}>{AGENT_CATEGORY_LABELS[c]}</MenuItem>))}
                </TextField>
              </div>
            </div>
            <TextField label="Description" value={draft.description} onChange={(e) => update({ description: e.target.value })} size="small" multiline minRows={2} helperText="Shown on the agent card. Changing the category loads that role's instruction template and default tools." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="cs-label mb-1.5">Avatar</div>
                <div className="flex flex-wrap gap-1.5">
                  {AVATARS.map((a) => (
                    <button type="button" key={a} onClick={() => update({ avatar: a })} className={`rounded-xl p-0.5 ${draft.avatar === a ? 'ring-2 ring-primary' : ''}`} aria-label={`Avatar ${a}`}>
                      <AgentAvatar avatar={a} color={draft.color} name={a} size={32} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="cs-label mb-1.5">Identity color</div>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map((c) => (
                    <button type="button" key={c} onClick={() => update({ color: c })} className={`h-7 w-7 rounded-full border-2 ${draft.color === c ? 'border-text' : 'border-transparent'}`} style={{ background: c }} aria-label={`Color ${c}`} />
                  ))}
                </div>
              </div>
            </div>
            <TextField select label="Project assignment (optional)" value={draft.projectId ?? ''} onChange={(e) => update({ projectId: e.target.value || null })} size="small">
              <MenuItem value="">No project</MenuItem>
              {(projects.data?.items ?? []).map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
            </TextField>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[12.5px] text-text-3">Template: <strong>{AGENT_CATEGORY_LABELS[draft.category as AgentCategory]}</strong>. <Button size="small" onClick={() => applyTemplate(draft.category as AgentCategory)}>Reset to template</Button></div>
              <ToggleButtonGroup size="small" exclusive value={editorMode} onChange={(_, v) => { if (!v) return; if (v === 'markdown') setMarkdown(renderInstructions(draft.instructions)); else update({ instructions: parseMarkdown(markdown, draft.instructions) }); setEditorMode(v); }}>
                <ToggleButton value="structured">Structured</ToggleButton>
                <ToggleButton value="markdown">Markdown editor</ToggleButton>
              </ToggleButtonGroup>
            </div>
            {editorMode === 'structured' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SECTIONS.map((s) => (
                  <TextField key={s.key} label={s.label} value={draft.instructions[s.key]} onChange={(e) => update({ instructions: { ...draft.instructions, [s.key]: e.target.value } })} size="small" multiline minRows={s.rows} className={s.key === 'operatingRules' || s.key === 'responsibilities' ? 'md:col-span-2' : ''} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg overflow-hidden border border-border" style={{ height: 380 }}>
                <Editor height="100%" defaultLanguage="markdown" value={markdown} onChange={(v) => setMarkdown(v ?? '')} theme={mode === 'dark' ? 'vs-dark' : 'light'} options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 13, lineNumbers: 'off', scrollBeyondLastLine: false }} />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            {!canModel && <Alert severity="info">Only workspace owners and admins can change the provider or model. Other settings are editable.</Alert>}
            {health.data && !health.data.aiProvider.configured && <Alert severity="warning">No AI provider is configured on the server ({health.data.aiProvider.reason}). Agents can be created but tasks will fail until AI_PROVIDER is set.</Alert>}
            {health.data?.aiProvider.isMock && <Alert severity="warning">The server runs the mock provider; model settings apply only once a real provider is configured.</Alert>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField select label="AI provider" value={draft.modelConfig.provider ?? ''} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, provider: (e.target.value || null) as ModelConfig['provider'], model: null } })} size="small" disabled={!canModel} helperText="Default uses the server's AI_PROVIDER">
                <MenuItem value="">Server default{health.data?.aiProvider.provider ? ` (${health.data.aiProvider.provider})` : ''}</MenuItem>
                <MenuItem value="anthropic">Anthropic</MenuItem>
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="mock">Mock (testing)</MenuItem>
              </TextField>
              <TextField select={models.length > 0 && !draft.modelConfig.provider} label="Model" value={draft.modelConfig.model ?? ''} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, model: e.target.value || null } })} size="small" disabled={!canModel} helperText={`Default: ${health.data?.aiProvider.defaultModel ?? 'server default'}`}>
                {models.length > 0 && !draft.modelConfig.provider && <MenuItem value="">Server default</MenuItem>}
                {models.length > 0 && !draft.modelConfig.provider && models.map((m) => (<MenuItem key={m.id} value={m.id}>{m.label} ({m.id})</MenuItem>))}
              </TextField>
              <Tooltip title="Current Anthropic models manage sampling internally; temperature only applies to providers/models that support it."><TextField label="Temperature (where supported)" type="number" value={draft.modelConfig.temperature ?? ''} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, temperature: e.target.value === '' ? null : Number(e.target.value) } })} size="small" inputProps={{ min: 0, max: 2, step: 0.1 }} /></Tooltip>
              <TextField label="Max output tokens" type="number" value={draft.modelConfig.maxOutputTokens} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, maxOutputTokens: Number(e.target.value) } })} size="small" inputProps={{ min: 256, max: 64000 }} />
              <TextField label="Task timeout (minutes)" type="number" value={Math.round(draft.modelConfig.timeoutMs / 60000)} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, timeoutMs: Math.max(1, Number(e.target.value)) * 60000 } })} size="small" inputProps={{ min: 1, max: 60 }} />
              <TextField label="Automatic retries (transient failures)" type="number" value={draft.modelConfig.maxRetries} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, maxRetries: Number(e.target.value) } })} size="small" inputProps={{ min: 0, max: 5 }} helperText="Exponential backoff with jitter" />
              <TextField label="Per-task token limit" type="number" value={draft.modelConfig.maxTokensPerTask ?? ''} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, maxTokensPerTask: e.target.value === '' ? null : Number(e.target.value) } })} size="small" helperText="Execution stops when exceeded" />
              <TextField label="Agent budget limit (USD, estimated)" type="number" value={draft.modelConfig.budgetUsd ?? ''} onChange={(e) => update({ modelConfig: { ...draft.modelConfig, budgetUsd: e.target.value === '' ? null : Number(e.target.value) } })} size="small" helperText="Lifetime estimated spend cap" />
            </div>
            <div className="text-[11.5px] text-text-3">Provider API keys live only in the server environment and are never sent to the browser.</div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            {TOOL_GROUPS.map((group) => (
              <div key={group.category}>
                <div className="flex items-baseline gap-2 mb-1.5"><span className="font-semibold text-[13px]">{group.label}</span><span className="text-[12px] text-text-3">{group.description}</span></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {toolItems.filter((t) => t.category === group.category).map((t) => {
                    const checked = draft.tools.includes(t.id);
                    return (
                      <label key={t.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${checked ? 'border-primary/50 bg-primary-soft/40' : 'border-border hover:bg-surface-2'}`}>
                        <Checkbox size="small" checked={checked} onChange={(e) => update({ tools: e.target.checked ? [...draft.tools, t.id] : draft.tools.filter((x) => x !== t.id) })} sx={{ p: 0.25 }} inputProps={{ 'aria-label': t.name }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap"><span className="text-[13px] font-medium">{t.name}</span><RiskChip risk={t.risk} />{t.requiresApproval && <Chip size="small" label="approval" variant="outlined" color="warning" />}{!t.available && <Chip size="small" label="unavailable" variant="outlined" />}</div>
                          <div className="text-[11.5px] text-text-3">{t.description}{!t.available && t.unavailableReason ? ` — ${t.unavailableReason}` : ''}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="cs-card p-3 bg-surface-2 text-[12.5px]">
              <div className="font-semibold mb-1">Permission summary</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-2">
                <span>{summary.read} read-only</span><span>{summary.write} write</span><span>{summary.high} high-risk</span><span>{summary.approvals} require approval</span>{summary.unavailable > 0 && <span className="text-warning">{summary.unavailable} currently unavailable (integration missing)</span>}
              </div>
              <div className="text-text-3 mt-1">Tool authorization is enforced by the backend on every call. Agents can never grant themselves tools or approve their own actions.</div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <FormControlLabel control={<Switch size="small" checked={draft.knowledge.allowProjectDocuments} onChange={(e) => update({ knowledge: { ...draft.knowledge, allowProjectDocuments: e.target.checked } })} />} label={<span className="text-[13px]">Project documents</span>} />
              <FormControlLabel control={<Switch size="small" checked={draft.knowledge.allowWorkspaceKnowledge} onChange={(e) => update({ knowledge: { ...draft.knowledge, allowWorkspaceKnowledge: e.target.checked } })} />} label={<span className="text-[13px]">Workspace knowledge base</span>} />
              <FormControlLabel control={<Switch size="small" checked={draft.knowledge.allowPreviousReports} onChange={(e) => update({ knowledge: { ...draft.knowledge, allowPreviousReports: e.target.checked } })} />} label={<span className="text-[13px]">Previous reports</span>} />
            </div>
            <div className="cs-label">Specific sources (uploaded files, approved URLs, folders)</div>
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {(knowledge.data?.items ?? []).map((k) => (
                <label key={k.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer">
                  <Checkbox size="small" checked={draft.knowledge.sourceIds.includes(k.id)} onChange={(e) => update({ knowledge: { ...draft.knowledge, sourceIds: e.target.checked ? [...draft.knowledge.sourceIds, k.id] : draft.knowledge.sourceIds.filter((x) => x !== k.id) } })} sx={{ p: 0.25 }} />
                  <span className="text-[13px] flex-1 truncate">{k.title}</span>
                  <span className="text-[11px] text-text-3">{k.type.toLowerCase()} · {k.status.toLowerCase()}</span>
                </label>
              ))}
              {knowledge.data && knowledge.data.items.length === 0 && <div className="text-[12.5px] text-text-3">No knowledge sources yet. Add documents or URLs on the Knowledge Base page.</div>}
            </div>
            <div className="text-[11.5px] text-text-3">Agents only read sources listed here or granted via the toggles. Retrieval enforces access at query time.</div>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-3">
            {validation && validation.errors.map((e, i) => (<Alert key={i} severity="error">{e}</Alert>))}
            {validation && validation.warnings.map((w, i) => (<Alert key={i} severity="warning">{w}</Alert>))}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="cs-card p-3 flex flex-col gap-2 text-[12.5px]">
                <div className="flex items-center gap-2"><AgentAvatar avatar={draft.avatar} color={draft.color} name={draft.name} size={36} /><div><div className="font-semibold text-[14px]">{draft.name}</div><div className="text-text-3">{AGENT_CATEGORY_LABELS[draft.category as AgentCategory]}</div></div></div>
                <div><span className="cs-label">Model</span><div>{draft.modelConfig.provider ?? 'server default'} / {draft.modelConfig.model ?? health.data?.aiProvider.defaultModel ?? 'default'} · {draft.modelConfig.maxOutputTokens} tokens · {Math.round(draft.modelConfig.timeoutMs / 60000)} min timeout · {draft.modelConfig.maxRetries} retries</div></div>
                <div><span className="cs-label">Tools ({draft.tools.length})</span><div className="flex flex-wrap gap-1 mt-1">{draft.tools.map((t) => (<Chip key={t} size="small" label={TOOL_CATALOG[t]?.name ?? t} variant="outlined" />))}{draft.tools.length === 0 && <span className="text-text-3">none</span>}</div></div>
                <div><span className="cs-label">Knowledge</span><div>{draft.knowledge.sourceIds.length} specific source(s){draft.knowledge.allowProjectDocuments ? ' · project docs' : ''}{draft.knowledge.allowWorkspaceKnowledge ? ' · workspace KB' : ''}{draft.knowledge.allowPreviousReports ? ' · previous reports' : ''}</div></div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border p-2 bg-surface-2"><Markdown>{renderInstructions(draft.instructions)}</Markdown></div>
              </div>
              <div className="cs-card p-3 flex flex-col gap-2">
                <div className="font-semibold text-[13px]">Sandbox test</div>
                <div className="text-[11.5px] text-text-3">Runs your draft instructions against the provider with no tools and no workspace data. Nothing is created or changed.</div>
                <TextField value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} size="small" multiline minRows={2} label="Test prompt" />
                <Button variant="outlined" onClick={runTest} disabled={testing} startIcon={testing ? <CircularProgress size={14} /> : undefined}>Run test</Button>
                {testResult && (
                  <div className="rounded-lg border border-border bg-surface-2 p-2 text-[12.5px]">
                    <div className="text-[11px] text-text-3 mb-1">{testResult.provider}/{testResult.model}{testResult.isMock ? ' (mock)' : ''} · {testResult.durationMs} ms · {testResult.usage.available ? `${testResult.usage.inputTokens}/${testResult.usage.outputTokens} tokens` : 'usage unavailable'}</div>
                    <Markdown>{testResult.text}</Markdown>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={() => setOpen(false)} color="inherit" disabled={busy}>Cancel</Button>
        <div className="flex-1" />
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button variant="contained" onClick={goNext} disabled={!canNext} data-testid="wizard-next">Next</Button>
        ) : (
          <Button variant="contained" onClick={save} disabled={busy || (validation ? !validation.valid : false)} data-testid="wizard-save">{editId ? 'Save new version' : 'Create agent'}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
