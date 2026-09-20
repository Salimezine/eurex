export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
