import { NextResponse } from 'next/server';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
