/**
 * Tiny, safe expression evaluator for workflow Condition nodes. No eval / Function.
 * Supports: identifiers with dot paths (input.x, nodes.a.output.text, prev.a.result),
 * string/number/boolean/null literals, comparison (== != > < >= <=), logical (&& || !),
 * parentheses, and the `contains` operator for strings/arrays.
 */
type Token = { type: 'num'; value: number } | { type: 'str'; value: string } | { type: 'id'; value: string } | { type: 'op'; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      tokens.push({ type: 'num', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) {
          out += src[j + 1];
          j += 2;
        } else out += src[j++];
      }
      tokens.push({ type: 'str', value: out });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j]!)) j++;
      tokens.push({ type: 'id', value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('()!<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in expression`);
  }
  return tokens;
}

export function evaluateExpression(src: string, scope: Record<string, unknown>): unknown {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const lookup = (path: string): unknown => {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    return path.split('.').reduce<unknown>((acc, key) => (acc !== null && acc !== undefined && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), scope);
  };
  const primary = (): unknown => {
    const t = next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.type === 'num' || t.type === 'str') return t.value;
    if (t.type === 'id') return lookup(t.value);
    if (t.type === 'op' && t.value === '(') {
      const v = orExpr();
      const close = next();
      if (!close || close.type !== 'op' || close.value !== ')') throw new Error('Expected )');
      return v;
    }
    if (t.type === 'op' && t.value === '!') return !primary();
    throw new Error(`Unexpected token ${t.value}`);
  };
  const comparison = (): unknown => {
    let left = primary();
    while (true) {
      const t = peek();
      if (t?.type === 'op' && ['==', '!=', '>', '<', '>=', '<='].includes(t.value)) {
        next();
        const right = primary();
        const l = left as number;
        const r = right as number;
        if (t.value === '==') left = left == right; // eslint-disable-line eqeqeq
        else if (t.value === '!=') left = left != right; // eslint-disable-line eqeqeq
        else if (t.value === '>') left = l > r;
        else if (t.value === '<') left = l < r;
        else if (t.value === '>=') left = l >= r;
        else left = l <= r;
      } else if (t?.type === 'id' && t.value === 'contains') {
        next();
        const right = primary();
        if (typeof left === 'string') left = left.toLowerCase().includes(String(right).toLowerCase());
        else if (Array.isArray(left)) left = left.includes(right);
        else left = false;
      } else break;
    }
    return left;
  };
  const andExpr = (): unknown => {
    let left = comparison();
    while (peek()?.type === 'op' && peek()?.value === '&&') {
      next();
      const right = comparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  };
  const orExpr = (): unknown => {
    let left = andExpr();
    while (peek()?.type === 'op' && peek()?.value === '||') {
      next();
      const right = andExpr();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  };
  const value = orExpr();
  if (pos < tokens.length) throw new Error(`Unexpected token ${tokens[pos]?.value}`);
  return value;
}
