import { Env } from '../types';
import { json, error, generateId } from '../utils';

// Simple JWT-like token using Web Crypto (no external lib needed)
const TOKEN_SECRET = 'eurex_org_secret_2026_cabinet_key';
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24h

interface OrgUser {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: 'expert' | 'comptable';
  is_active: number;
}

interface TokenPayload {
  user_id: string;
  organization_id: string;
  role: string;
  exp: number;
}

// Create HMAC-SHA256 token
async function createToken(payload: TokenPayload): Promise<string> {
  const data = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(data).replace(/=/g, '') + '.' + sigHex;
}

// Verify and decode token
async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const [dataB64, sigHex] = token.split('.');
    if (!dataB64 || !sigHex) return null;
    const data = atob(dataB64);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(TOKEN_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload = JSON.parse(data) as TokenPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Simple password hash using SHA-256 + salt (Workers don't have bcrypt)
// For production, use argon2 via WASM or a dedicated auth service
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().slice(0, 16);
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(salt + ':' + password)
  );
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return salt + ':' + hashHex;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(salt + ':' + password)
  );
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === expectedHash;
}

// Middleware: extract and verify user from Authorization header
export async function getOrgUser(request: Request, env: Env): Promise<OrgUser | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return null;
  const user = await env.DB.prepare(
    'SELECT id, organization_id, full_name, email, role, is_active FROM org_users WHERE id = ? AND organization_id = ?'
  ).bind(payload.user_id, payload.organization_id).first() as OrgUser | null;
  if (!user || !user.is_active) return null;
  return user;
}

// Check if user can access a client's data
export async function canAccessClient(user: OrgUser, clientId: string, env: Env): Promise<boolean> {
  if (user.role === 'expert') return true;
  const client = await env.DB.prepare(
    'SELECT assigned_comptable_id FROM org_clients WHERE id = ? AND organization_id = ?'
  ).bind(clientId, user.organization_id).first() as any;
  return client?.assigned_comptable_id === user.id;
}

// Check if user can access a dossier (via client ownership)
export async function canAccessDossier(user: OrgUser, dossierId: string, env: Env): Promise<boolean> {
  if (user.role === 'expert') return true;
  const d = await env.DB.prepare(
    `SELECT c.assigned_comptable_id FROM org_dossiers d
     JOIN org_clients c ON d.client_id = c.id
     WHERE d.id = ? AND c.organization_id = ?`
  ).bind(dossierId, user.organization_id).first() as any;
  return d?.assigned_comptable_id === user.id;
}

// POST /api/org/auth/login
export async function handleOrgLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as any;
  if (!email || !password) return error('Email et mot de passe requis');

  const user = await env.DB.prepare(
    'SELECT id, organization_id, full_name, email, password_hash, role, must_change_password, is_active FROM org_users WHERE email = ?'
  ).bind(email).first() as any;

  if (!user) return error('Identifiants incorrects', 401);
  if (!user.is_active) return error('Compte désactivé', 403);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return error('Identifiants incorrects', 401);

  const org = await env.DB.prepare('SELECT name FROM organizations WHERE id = ?').bind(user.organization_id).first() as any;

  const token = await createToken({
    user_id: user.id,
    organization_id: user.organization_id,
    role: user.role,
    exp: Date.now() + TOKEN_EXPIRY,
  });

  return json({
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
      organization: org?.name || '',
    },
  });
}

// GET /api/org/auth/me
export async function handleOrgMe(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  const org = await env.DB.prepare('SELECT name FROM organizations WHERE id = ?').bind(user.organization_id).first() as any;
  return json({ ...user, organization_name: org?.name });
}

// POST /api/org/auth/change-password
export async function handleOrgChangePassword(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  const { current_password, new_password } = await request.json() as any;
  if (!current_password || !new_password) return error('Mots de passe requis');
  if (new_password.length < 12) return error('Le mot de passe doit faire au moins 12 caractères');

  const stored = await env.DB.prepare('SELECT password_hash FROM org_users WHERE id = ?').bind(user.id).first() as any;
  const valid = await verifyPassword(current_password, stored.password_hash);
  if (!valid) return error('Mot de passe actuel incorrect', 401);

  const newHash = await hashPassword(new_password);
  await env.DB.prepare('UPDATE org_users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .bind(newHash, user.id).run();

  return json({ ok: true });
}

export { hashPassword };
