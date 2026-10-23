import { HIGH_RISK_ADAPTERS } from './adapters/high-risk.js';
import { READ_ADAPTERS } from './adapters/read.js';
import { WRITE_ADAPTERS } from './adapters/write.js';
import { registerAdapter } from './registry.js';

export * from './registry.js';

let registered = false;
/** Register every built-in adapter exactly once. */
export function registerBuiltinTools(): void {
  if (registered) return;
  for (const a of [...READ_ADAPTERS, ...WRITE_ADAPTERS, ...HIGH_RISK_ADAPTERS]) registerAdapter(a);
  registered = true;
}
