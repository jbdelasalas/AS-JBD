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

let _refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null;
      if (!raw) return false;
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: raw }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.data?.access_token) {
        localStorage.setItem('access_token', data.data.access_token);
        localStorage.setItem('refresh_token', data.data.refresh_token);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, _retry = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError(0, null, 'Server is slow to respond — please try again');
    throw new ApiError(0, null, 'Network error — check your connection');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    if (!_retry) {
      const refreshed = await tryRefresh();
      if (refreshed) return request<T>(path, init, true);
    }
    clearAuth();
    if (typeof window !== 'undefined') {
      // Preserve where the user was so they return there after re-login,
      // instead of always being dumped on the dashboard.
      const here = window.location.pathname + window.location.search;
      const next =
        here && here !== '/login' ? `?next=${encodeURIComponent(here)}` : '';
      window.location.href = `/login${next}`;
    }
    throw new ApiError(401, null, 'Unauthorized');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const friendlyStatus: Record<number, string> = {
      500: 'Server error — please try again',
      502: 'Server is unavailable — please try again',
      503: 'Service temporarily unavailable — please try again in a moment',
      504: 'Server timed out — please try again',
    };
    const message =
      typeof body === 'object' && body !== null
        ? Array.isArray((body as { message?: unknown }).message)
          ? (body as { message: string[] }).message.join(', ')
          : (body as { message?: string; error?: string }).message
            ?? (body as { error?: string }).error
            ?? friendlyStatus[res.status]
            ?? `HTTP ${res.status}`
        : friendlyStatus[res.status] ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, body, message);
  }

  return body as T;
}

export const api = {
  get:    <T,>(path: string)                         => request<T>(path),
  post:   <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'POST',   body: body ? JSON.stringify(body) : undefined }),
  put:    <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'PUT',    body: body ? JSON.stringify(body) : undefined }),
  patch:  <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'PATCH',  body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string, body?: unknown)         => request<T>(path, { method: 'DELETE',  body: body ? JSON.stringify(body) : undefined }),
};
