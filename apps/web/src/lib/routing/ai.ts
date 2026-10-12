// The AI half of trip planning. Server-only.
//
// The model never decides routes — the solver does, with rules it can check.
// The model does the two things a solver cannot:
//   1. read free-text remarks ("receive 6-9am only", "small truck, narrow
//      street", "closed until 10") and turn them into rules the solver obeys;
//   2. explain the finished plan to the dispatcher in plain words.
//
// Both are best-effort. With no GEMINI_API_KEY, or if the model is down, the
// planner still works: remarks are simply not turned into rules (the page says
// so) and there is no summary.

import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

// Same fallback as the AI Analysis route: in dev, Next sometimes does not
// inject non-public env vars into route handlers.
if (!process.env.GEMINI_API_KEY) {
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of envFile.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* no .env.local — fine */ }
}

// The lite model is the fallback: the main one answers 503 at busy hours, and
// reading remarks does not need the bigger model.
const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

export function aiAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// The page gives the whole optimize request 30 s: remarks 12 s + solver ≤ 6 s +
// briefing 8 s leaves room for the database. Each AI step gets its budget
// inside that; when it runs out the plan goes ahead without it.
function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('AI took too long')), ms)),
  ]);
}

function generate(prompt: string, json: boolean, budgetMs: number): Promise<string> {
  return withBudget(generateOnce(prompt, json), budgetMs);
}

async function generateOnce(prompt: string, json: boolean): Promise<string> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const RETRYABLE = new Set([429, 500, 503]);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client.models.generateContent({
        model: MODELS[attempt % MODELS.length],
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: json
          ? { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8192 }
          : { temperature: 0.3, maxOutputTokens: 1024 },
      });
      return res.text ?? '';
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (attempt < 3 && status && RETRYABLE.has(status)) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

export interface RemarkRule {
  id: string;
  window_from: string | null;   // "HH:MM"
  window_to: string | null;
  small_truck_only: boolean;
  frozen_or_dressed: boolean | null; // null = remarks say nothing either way
  note: string;                 // what was understood, for the dispatcher to check
}

/** Turns remarks into rules. Stops with blank remarks are not sent. */
export async function rulesFromRemarks(
  stops: { id: string; customer: string; remarks: string }[],
): Promise<RemarkRule[]> {
  const withText = stops.filter((s) => s.remarks.trim());
  if (!withText.length || !aiAvailable()) return [];

  const prompt = `You help dispatch chicken deliveries for Art Fresh, a Philippine poultry company.
Each delivery below has free-text remarks written by sales staff, often in English, Tagalog or Taglish.
Extract only rules a truck router needs. Return a JSON array, one object per delivery, with exactly:
  "id": the delivery id as given,
  "window_from": earliest receiving time "HH:MM" (24h) or null,
  "window_to": latest receiving time "HH:MM" (24h) or null,
  "small_truck_only": true only if the remarks say a big truck cannot enter / narrow road / small vehicle only,
  "frozen_or_dressed": true if the remarks say the goods must stay cold, false if they say live birds or non-perishable, null if not stated,
  "note": a short English paraphrase of what you understood (max 12 words), or "" if nothing relevant.
Rules: "morning" means 06:00-11:00, "before X" sets only window_to, "after X" sets only window_from, "umaga" = morning, "hapon" = afternoon (13:00-17:00).
Do not invent constraints that are not in the remarks.

Deliveries:
${withText.map((s) => `- id=${JSON.stringify(s.id)} customer=${JSON.stringify(s.customer)} remarks=${JSON.stringify(s.remarks)}`).join('\n')}`;

  const text = await generate(prompt, true, 12_000);
  const parsed = JSON.parse(text) as RemarkRule[];
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ids = new Set(withText.map((s) => s.id));
  // Trust nothing the model returns without checking its shape.
  return (Array.isArray(parsed) ? parsed : [])
    .filter((r) => r && ids.has(String(r.id)))
    .map((r) => ({
      id: String(r.id),
      window_from: typeof r.window_from === 'string' && hhmm.test(r.window_from) ? r.window_from : null,
      window_to: typeof r.window_to === 'string' && hhmm.test(r.window_to) ? r.window_to : null,
      small_truck_only: r.small_truck_only === true,
      frozen_or_dressed: typeof r.frozen_or_dressed === 'boolean' ? r.frozen_or_dressed : null,
      note: typeof r.note === 'string' ? r.note.slice(0, 120) : '',
    }));
}

export interface PlanFacts {
  date: string;
  depot: string;
  trucks: { plate: string; capacityKg: number; reefer: boolean; stops: number; kg: number; km: number; departs: string; lastDrop: string; returns: string; lateStops: number; areas: string[] }[];
  idleTrucks: string[];
  unassigned: { customer: string; kg: number; reason: string }[];
  roughAddresses: number;
  totals: { km: number; kg: number; stops: number };
}

/** A short briefing for the dispatcher. Facts in, prose out — no numbers invented. */
export async function explainPlan(facts: PlanFacts): Promise<string | null> {
  if (!aiAvailable()) return null;
  const prompt = `You are briefing the dispatcher of Art Fresh (Philippine chicken distributor) on tomorrow's delivery trips.
Write at most 8 short bullet points in plain English. Use only the numbers given — never estimate new ones.
Cover: overall picture (trucks used, total kg and km); any truck loaded above 90% of capacity or returning late; stops left unassigned and why (most important — say what the dispatcher could do, e.g. add a truck or split an order); late deliveries; addresses that still need their map pin checked; idle trucks.
Skip a topic if there is nothing to say. No headings, no preamble.

Plan data (JSON):
${JSON.stringify(facts)}`;
  try {
    return (await generate(prompt, false, 8_000)).trim() || null;
  } catch {
    return null;
  }
}
