// Minimal fetch wrapper. Handles auth token, JSON, and basic error normalisation.
// In a production app you'd replace this with TanStack Query + a typed client (orval, openapi-typescript-codegen, etc.).

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown, message: string) {
    super(message);
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  localStorage.removeItem('company_id');
  localStorage.removeItem('permissions');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    // For now: just clear and redirect. A real app would attempt refresh first.
    clearAuth();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, null, 'Unauthorized');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null
        ? Array.isArray((body as { message?: unknown }).message)
          ? ((body as { message: string[] }).message.join(', '))
          : ((body as { message?: string }).message ?? `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, body, message);
  }

  return body as T;
}

export const api = {
  get:    <T,>(path: string)                         => request<T>(path),
  post:   <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'POST',   body: body ? JSON.stringify(body) : undefined }),
  put:    <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'PUT',    body: body ? JSON.stringify(body) : undefined }),
  patch:  <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'PATCH',  body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string)                         => request<T>(path, { method: 'DELETE' }),
};
