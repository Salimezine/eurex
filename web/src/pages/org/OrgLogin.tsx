import { useState } from 'react';
import { useOrgAuth } from '../../lib/orgAuth';
import { t } from '../../lib/orgI18n';
import { LogIn, RefreshCw, Building2 } from 'lucide-react';

export default function OrgLogin() {
  const { login } = useOrgAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || t('auth.wrong_credentials'));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <span className="bg-purple-100 text-purple-700 rounded-lg p-2">
            <Building2 size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-gray-900">EUREX — Cabinet</h1>
            <p className="text-xs text-gray-500">{t('auth.login')}</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <label className="block text-xs font-semibold text-gray-700 mb-1">{t('auth.email')}</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="expert@eurex.tn"
            autoFocus
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          <label className="block text-xs font-semibold text-gray-700 mb-1">{t('auth.password')}</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <><LogIn size={15} /> {t('auth.login_btn')}</>}
          </button>
        </form>

        <p className="text-[11px] text-gray-400 mt-5 text-center">Module Cabinet — EUREX</p>
      </div>
    </div>
  );
}
