// Small fetch wrapper for the RAFAS API. Every request carries the x-rafas
// header the server requires on cookie-authenticated writes.
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = "GET", body, headers = {}, raw = false, keepalive = false } = {}) {
  const options = { method, headers: { "x-rafas": "1", ...headers }, credentials: "same-origin", keepalive };
  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, "You appear to be offline.");
  }
  if (raw && response.ok) return response;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error || `Request failed (${response.status})`);
  return data;
}
