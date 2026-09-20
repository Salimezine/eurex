import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';

export interface OrgUser {
  id: string;
  full_name: string;
  email: string;
  role: 'expert' | 'comptable';
  must_change_password: number;
  organization: string;
}

interface OrgAuthState {
  token: string | null;
  user: OrgUser | null;
  loading: boolean;
}

const OrgAuthContext = createContext<{
  state: OrgAuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (current: string, newPwd: string) => Promise<void>;
  refreshMe: () => Promise<void>;
}>({ state: { token: null, user: null, loading: true }, login: async () => {}, logout: () => {}, changePassword: async () => {}, refreshMe: async () => {} });

export function OrgAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrgAuthState>(() => {
    const token = localStorage.getItem('eurex_org_token');
    const userStr = localStorage.getItem('eurex_org_user');
    return {
      token,
      user: userStr ? JSON.parse(userStr) : null,
      loading: !!token,
    };
  });

  const refreshMe = useCallback(async () => {
    const token = localStorage.getItem('eurex_org_token');
    if (!token) { setState({ token: null, user: null, loading: false }); return; }
    try {
      const r = await fetch(`${BASE}/org/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error();
      const user = await r.json();
      localStorage.setItem('eurex_org_user', JSON.stringify(user));
      setState({ token, user, loading: false });
    } catch {
      localStorage.removeItem('eurex_org_token');
      localStorage.removeItem('eurex_org_user');
      setState({ token: null, user: null, loading: false });
    }
  }, []);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  const login = async (email: string, password: string) => {
    const r = await fetch(`${BASE}/org/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur de connexion');
    localStorage.setItem('eurex_org_token', data.token);
    localStorage.setItem('eurex_org_user', JSON.stringify(data.user));
    setState({ token: data.token, user: data.user, loading: false });
  };

  const logout = () => {
    localStorage.removeItem('eurex_org_token');
    localStorage.removeItem('eurex_org_user');
    setState({ token: null, user: null, loading: false });
  };

  const changePassword = async (current: string, newPwd: string) => {
    const r = await fetch(`${BASE}/org/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ current_password: current, new_password: newPwd }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur');
    // Update local state
    const updatedUser = { ...state.user!, must_change_password: 0 };
    localStorage.setItem('eurex_org_user', JSON.stringify(updatedUser));
    setState(s => ({ ...s, user: updatedUser }));
  };

  return (
    <OrgAuthContext.Provider value={{ state, login, logout, changePassword, refreshMe }}>
      {children}
    </OrgAuthContext.Provider>
  );
}

export function useOrgAuth() {
  return useContext(OrgAuthContext);
}
