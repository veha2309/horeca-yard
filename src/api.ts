export type RecordData = { id: string; [key: string]: any };
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Sales' | 'Warehouse';
};
export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const result = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!result.ok) {
    let message = 'Request failed. Please try again.';
    try {
      const body = await result.json();
      message = body.error || message;
    } catch {}
    throw Object.assign(new Error(message), { status: result.status });
  }
  return result.json();
}
export const mutate = (path: string, data: any, method = 'POST', key = crypto.randomUUID()) =>
  api(path, { method, body: JSON.stringify(data), headers: { 'Idempotency-Key': key } });
export const money = (n: number = 0) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n / 100);
export const dateLabel = (s: string) =>
  s
    ? new Date(s).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '—';
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
