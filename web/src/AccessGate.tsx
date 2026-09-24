import { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';

const CODE_HASH = 'ca560b598ac2c3e4c8147ef1285731434381873dbc3d7c1e6f3eff64de153b20';
// Clé publique Cloudflare Turnstile
const TURNSTILE_SITE_KEY = '0x4AAAAAAE-_usmwigFHwz4j';

const SESSION_FLAG = 'eurex_authorized';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isAuthorized(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === '1';
  } catch {
    return false;
  }
}

export function useAccessGate(): { authorized: boolean } {
  const [authorized, setAuthorized] = useState<boolean>(isAuthorized());
  return { authorized };
}

interface AccessGateProps {
  onAuthorized: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback?: (token: string) => void; 'expired-callback'?: () => void }) => string;
      reset: (widgetId: string) => void;
    };
  }
}

export default function AccessGate({ onAuthorized }: AccessGateProps) {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [widgetId, setWidgetId] = useState('');

  // Charger le script Turnstile une seule fois
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (document.getElementById('cf-turnstile-script') || window.turnstile) return;
    const s = document.createElement('script');
    s.id = 'cf-turnstile-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, []);

  // Rendre le widget dès que l'API est disponible
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    const render = () => {
      const el = document.getElementById('cf-turnstile-widget');
      if (!el || !window.turnstile) return;
      const widget = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (tok: string) => { setToken(tok); setError(''); },
        'expired-callback': () => setToken(''),
      });
      setWidgetId(widget);
    };
    if (window.turnstile) {
      render();
    } else {
      const t = setInterval(() => {
        if (window.turnstile) { clearInterval(t); if (!cancelled) render(); }
      }, 250);
      return () => { clearInterval(t); cancelled = true; };
    }
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setError('');
    if (TURNSTILE_SITE_KEY && !token) {
      setError('Vérifiez la case anti-bot Cloudflare.');
      return;
    }
    setLoading(true);
    try {
      const hash = await sha256(code);
      if (hash !== CODE_HASH) {
        setError('Code d\'accès incorrect.');
        setLoading(false);
        return;
      }
      try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch { /* ignore */ }
      onAuthorized();
    } catch {
      setError('Erreur de vérification. Réessayez.');
      setLoading(false);
      return;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <span className="bg-blue-100 text-blue-700 rounded-lg p-2"><ShieldCheck size={22} /></span>
          <div>
            <h1 className="text-xl font-bold text-gray-900">EUREX</h1>
            <p className="text-xs text-gray-500">Espace protégé — saisissez votre code d'accès</p>
          </div>
        </div>

        <label className="block text-xs font-semibold text-gray-700 mb-1">Code d'accès</label>
        <input
          type="password"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="••••••••"
          autoFocus
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {TURNSTILE_SITE_KEY && (
          <div id="cf-turnstile-widget" className="mb-4 flex justify-center" />
        )}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2"
        >
          {loading ? <RefreshCw size={15} className="animate-spin" /> : 'Entrer'}
        </button>

        <p className="text-[11px] text-gray-400 mt-5 text-center">Created by EUREX</p>
      </div>
    </div>
  );
}