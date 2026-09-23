// Built-in plugin: lets the assistant answer numbers questions ("revenue last month", "top products")
// by writing a read-only SELECT against your Postgres database. Every query runs in a read-only
// transaction with a timeout and a row cap. Describe your tables in "Schema notes" so it writes good SQL.
import pg from 'pg';

const WRITE = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge|comment|vacuum|reindex|refresh|lock|listen|notify|set|reset)\b/i;

// returns { sql } ready to run, or { error }
export function guardSql(sql, maxRows = 300) {
  let q = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(q)) return { error: '只允许 SELECT 查询' };
  if (q.includes(';')) return { error: '只允许单条查询' };
  if (WRITE.test(q.replace(/'(?:[^']|'')*'/g, "''"))) return { error: '只读：不允许写操作' };   // ignore keywords inside string literals
  if (!/\blimit\s+\d+/i.test(q)) q += ` limit ${maxRows}`;
  return { sql: q };
}

async function query(api, sql) {
  const g = guardSql(sql, Number(api.cfg.maxRows) || 300);
  if (g.error) return g;
  const c = new pg.Client({
    connectionString: api.cfg.dbUrl,
    ssl: api.cfg.ssl === false ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000, statement_timeout: 15000, query_timeout: 15000,
  });
  try {
    await c.connect();
    await c.query('begin read only');
    const { rows } = await c.query(g.sql);
    await c.query('rollback');
    return { rows: rows.slice(0, Number(api.cfg.maxRows) || 300), rowCount: rows.length };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
  finally { try { await c.end(); } catch {} }
}

export default {
  name: 'sql-readonly',
  description: 'Read-only SQL over your Postgres database, so the assistant can answer number questions (run_sql tool)',
  version: '1.0.0',
  configSchema: [
    { key: 'dbUrl', label: 'Postgres connection URL', type: 'secret', required: true, help: 'Use a database user that only has SELECT rights' },
    { key: 'schema', label: 'Schema notes', type: 'string', help: 'Tables, columns and what they mean, e.g. "orders(date, total) — total is AUD incl. GST"' },
    { key: 'ssl', label: 'Use SSL', type: 'bool', default: true },
    { key: 'maxRows', label: 'Max rows per query', type: 'number', default: 300 },
  ],

  tools: [{
    name: 'run_sql',
    description: '查询业务数据库（只读 Postgres）。当问到上下文里没有的具体数字/统计/趋势时，写一条只读 SELECT 取数。',
    parameters: { type: 'object', properties: { sql: { type: 'string', description: '一条只读 SELECT 语句' } }, required: ['sql'] },
    readOnly: true,
    progress: (a) => `查询数据中… ${String(a.sql || '').replace(/\s+/g, ' ').slice(0, 70)}`,
    run: ({ sql }, api) => query(api, sql),
  }],

  context: (api) => (api.cfg.schema ? `【数据库（可用 run_sql 只读查询）】${String(api.cfg.schema).slice(0, 3000)}` : ''),
};
