export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { err } from '@/lib/api-response';
import * as fs from 'fs';
import * as path from 'path';

// Next.js sometimes doesn't inject non-NEXT_PUBLIC_ vars into route handlers in dev.
// Read .env.local directly as a fallback.
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of envFile.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch { /* file not found or unreadable — ignore */ }
}

async function buildContext(companyId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [monthlySales, arAging, apAging, topCustomers, growCycles] = await Promise.all([
    query(
      `SELECT to_char(invoice_date, 'YYYY-MM') AS month,
              COALESCE(SUM(total), 0)::numeric AS total,
              COUNT(*)::int AS count
         FROM sales_invoices
        WHERE company_id = $1
          AND status NOT IN ('draft','cancelled')
          AND invoice_date >= $2
        GROUP BY month ORDER BY month ASC`,
      [companyId, sixMonthsAgo],
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 0  AND 30  THEN balance ELSE 0 END), 0) AS current_amount,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 31 AND 60  THEN balance ELSE 0 END), 0) AS days_31_60,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 61 AND 90  THEN balance ELSE 0 END), 0) AS days_61_90,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 91 AND 120 THEN balance ELSE 0 END), 0) AS days_91_120,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) > 120               THEN balance ELSE 0 END), 0) AS over_120,
         COALESCE(SUM(balance), 0) AS total
         FROM sales_invoices
        WHERE company_id = $1 AND status IN ('open','partially_paid','overdue')`,
      [companyId, today],
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 0  AND 30  THEN balance ELSE 0 END), 0) AS current_amount,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 31 AND 60  THEN balance ELSE 0 END), 0) AS days_31_60,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 61 AND 90  THEN balance ELSE 0 END), 0) AS days_61_90,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) BETWEEN 91 AND 120 THEN balance ELSE 0 END), 0) AS days_91_120,
         COALESCE(SUM(CASE WHEN ($2::date - due_date) > 120               THEN balance ELSE 0 END), 0) AS over_120,
         COALESCE(SUM(balance), 0) AS total
         FROM bills
        WHERE company_id = $1 AND status IN ('approved','partially_paid')`,
      [companyId, today],
    ),
    query(
      `SELECT c.name, COALESCE(SUM(si.balance), 0)::numeric AS outstanding
         FROM customers c
         JOIN sales_invoices si ON si.customer_id = c.id
        WHERE c.company_id = $1 AND si.status IN ('open','partially_paid','overdue')
        GROUP BY c.id, c.name
        ORDER BY outstanding DESC LIMIT 5`,
      [companyId],
    ),
    query(
      `SELECT g.doc_no, g.start_date, g.expected_end_date, g.status,
              g.heads_in, g.total_mortality, g.heads_available, g.heads_harvested,
              g.est_harvest_recovery
         FROM grow_cycles g
        WHERE g.company_id = $1
          AND g.start_date >= $2
        ORDER BY g.start_date DESC LIMIT 10`,
      [companyId, sixMonthsAgo],
    ),
  ]);

  const ar = (arAging[0] ?? {}) as Record<string, unknown>;
  const ap = (apAging[0] ?? {}) as Record<string, unknown>;

  const fmt = (v: unknown) => `₱${Number(v ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  const salesLines = (monthlySales as Record<string, unknown>[])
    .map((r) => `  ${r.month}: ${fmt(r.total)} (${r.count} invoices)`)
    .join('\n') || '  (no data)';

  const customerLines = (topCustomers as Record<string, unknown>[])
    .map((c) => `  ${c.name}: ${fmt(c.outstanding)}`)
    .join('\n') || '  (none)';

  const cycleLines = (growCycles as Record<string, unknown>[]).length === 0
    ? '  (none)'
    : (growCycles as Record<string, unknown>[]).map((g) => {
        const mortalityRate = g.heads_in
          ? ((Number(g.total_mortality) / Number(g.heads_in)) * 100).toFixed(1)
          : '0.0';
        return `  ${g.doc_no} | ${g.start_date} → ${g.expected_end_date ?? 'TBD'} | status: ${g.status} | in: ${g.heads_in} heads | mortality: ${g.total_mortality} (${mortalityRate}%) | available: ${g.heads_available}`;
      }).join('\n');

  return `Today: ${today}

MONTHLY SALES (last 6 months):
${salesLines}

ACCOUNTS RECEIVABLE AGING — Total: ${fmt(ar.total)}
  Current (0–30d): ${fmt(ar.current_amount)}
  31–60 days:      ${fmt(ar.days_31_60)}
  61–90 days:      ${fmt(ar.days_61_90)}
  91–120 days:     ${fmt(ar.days_91_120)}
  120+ days:       ${fmt(ar.over_120)}

TOP CUSTOMERS BY OUTSTANDING BALANCE:
${customerLines}

ACCOUNTS PAYABLE AGING — Total: ${fmt(ap.total)}
  Current (0–30d): ${fmt(ap.current_amount)}
  31–60 days:      ${fmt(ap.days_31_60)}
  61–90 days:      ${fmt(ap.days_61_90)}
  91–120 days:     ${fmt(ap.days_91_120)}
  120+ days:       ${fmt(ap.over_120)}

POULTRY GROW CYCLES (recent):
${cycleLines}`;
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { company_id, mode, messages } = body as {
    company_id?: string;
    mode?: string;
    messages?: Anthropic.MessageParam[];
  };

  if (!company_id) return err('company_id is required', 400);
  if (mode !== 'insights' && mode !== 'chat') return err('mode must be "insights" or "chat"', 400);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return err('ANTHROPIC_API_KEY is not configured', 503);
  }

  let context: string;
  try {
    context = await buildContext(company_id);
  } catch (e: unknown) {
    return err(`Failed to load business data: ${(e as Error).message}`, 500);
  }

  const systemPrompt = `You are a financial and operations analyst embedded in an ERP system for a Philippine poultry farming and distribution company. You have real-time access to the company's data shown below.

Rules:
- Use Philippine Peso (₱) and local formatting
- Be specific — always cite the actual numbers from the data
- No generic advice; every recommendation must follow from the numbers
- Use bullet points for lists; keep responses concise
- For the chat mode, answer the user's question directly using the data

CURRENT BUSINESS DATA:
${context}`;

  const apiMessages: Anthropic.MessageParam[] =
    mode === 'insights'
      ? [{ role: 'user', content: 'Give me a business health analysis covering: (1) financial highlights and warnings, (2) AR collection priorities, (3) cash flow position (AR vs AP), and (4) poultry operations performance. Be specific with the numbers.' }]
      : (messages ?? []);

  if (apiMessages.length === 0) return err('messages array is required for chat mode', 400);

  const client = new Anthropic({ apiKey });
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: apiMessages,
  });

  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          controller.enqueue(new TextEncoder().encode(event.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
