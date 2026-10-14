/** Thin client for the admin API. Mutating calls carry X-Sutra (CSRF guard); the session is an HttpOnly cookie. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'x-sutra': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!r.ok) {
    if (r.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('sutra:signed-out'));
    throw new ApiError(r.status, (data && data.error) || `${r.status} ${r.statusText}`);
  }
  return data as T;
}

export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b: unknown = {}) => api<T>('POST', u, b);
export const put = <T = any>(u: string, b: unknown) => api<T>('PUT', u, b);
export const del = <T = any>(u: string) => api<T>('DELETE', u);
