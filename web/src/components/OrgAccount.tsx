import { useState } from 'react';
import { useOrgAuth } from '../lib/orgAuth';
import { orgApi } from '../lib/orgApi';
import { t } from '../lib/orgI18n';
import { isValidEmail, isValidPassword } from '../lib/orgValidate';

export default function OrgAccountButton() {
  const { state, changePassword, refreshMe } = useOrgAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(state.user?.full_name || '');
  const [email, setEmail] = useState(state.user?.email || '');
  const [cur, setCur] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const user = state.user;
  const initials = (user?.full_name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

  const openModal = () => {
    setName(state.user?.full_name || '');
    setEmail(state.user?.email || '');
    setCur(''); setPwd(''); setPwd2('');
    setMsg(''); setErr('');
    setOpen(true);
  };

  const saveProfile = async () => {
    setErr(''); setMsg('');
    if (!name.trim()) { setErr('Nom requis'); return; }
    if (!isValidEmail(email)) { setErr('Email invalide'); return; }
    setBusy(true);
    try {
      await orgApi.updateProfile({ full_name: name.trim(), email: email.trim() });
      await refreshMe();
      setMsg(t('account.saved'));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const savePassword = async () => {
    setErr(''); setMsg('');
    if (!isValidPassword(pwd)) { setErr(t('auth.min_12_chars')); return; }
    if (pwd !== pwd2) { setErr('Les mots de passe ne correspondent pas'); return; }
    setBusy(true);
    try {
      await changePassword(cur, pwd);
      setCur(''); setPwd(''); setPwd2('');
      setMsg(t('account.password_updated'));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  if (!user) return null;

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-white border border-gray-200 hover:border-purple-300 hover:shadow-sm transition-all"
        title={t('account.title')}
      >
        <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">
          {initials}
        </span>
        <span className="hidden sm:inline text-gray-700 font-medium max-w-[140px] truncate">{user.full_name}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{t('account.title')}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* Profil */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('account.profile')}</p>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Nom complet"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                onClick={saveProfile}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {t('account.save')}
              </button>
            </div>

            <hr className="border-gray-100" />

            {/* Mot de passe */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('auth.change_password')}</p>
              <input
                type="password"
                value={cur}
                onChange={e => setCur(e.target.value)}
                placeholder={t('account.current_password')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <input
                type="password"
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                placeholder={t('account.new_password_hint')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <input
                type="password"
                value={pwd2}
                onChange={e => setPwd2(e.target.value)}
                placeholder={t('account.confirm_password')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                onClick={savePassword}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {t('account.save')}
              </button>
            </div>

            {msg && <p className="text-sm text-emerald-600">{msg}</p>}
            {err && <p className="text-sm text-red-600">{err}</p>}
          </div>
        </div>
      )}
    </>
  );
}
