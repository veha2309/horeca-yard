export type RecordData = { id: string; [key: string]: any };
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Sales' | 'Warehouse';
};
export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const { handle } = await import('./core/routes.js');
  const [path, search] = url.split('?');
  const body =
    options.body instanceof FormData
      ? options.body
      : typeof options.body === 'string'
        ? JSON.parse(options.body)
        : undefined;
  try {
    return (await handle(path, {
      method: options.method || 'GET',
      body,
      headers: (options.headers as Record<string, string>) || {},
      query: new URLSearchParams(search || ''),
    })) as T;
  } catch (e: any) {
    throw Object.assign(new Error(e?.message || 'Request failed. Please try again.'), {
      status: e?.status ?? 500,
    });
  }
}
/** Saves a generated Blob to the user's device, replacing a download URL. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
