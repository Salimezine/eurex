const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json', ...opts?.headers }, ...opts });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/csv')) return r.text() as any;
  return r.json();
}

export const api = {
  seed: () => req<any>('/seed', { method: 'POST' }),
  dashboard: () => req<any>('/dashboard'),
  getSocietes: () => req<any[]>('/societes'),
  createSociete: (d: any) => req<any>('/societes', { method: 'POST', body: JSON.stringify(d) }),
  deleteSociete: (id: string) => req<any>(`/societes/${id}`, { method: 'DELETE' }),
  getJournaux: (sid: string) => req<any[]>(`/societes/${sid}/journaux`),
  getDossiers: (sid: string) => req<any[]>(`/societes/${sid}/dossiers`),
  createDossier: (sid: string, d: any) => req<any>(`/societes/${sid}/dossiers`, { method: 'POST', body: JSON.stringify(d) }),
  getDossier: (did: string) => req<any>(`/dossiers/${did}`),
  deleteDossier: (did: string) => req<any>(`/dossiers/${did}`, { method: 'DELETE' }),
  getPieces: (did: string) => req<any[]>(`/dossiers/${did}/pieces`),
  getEcritures: (did: string, journal?: string) => req<any[]>(`/dossiers/${did}/ecritures${journal ? '?journal=' + encodeURIComponent(journal) : ''}`),
  addEcriture: (did: string, d: any) => req<any>(`/dossiers/${did}/ecritures`, { method: 'POST', body: JSON.stringify(d) }),
  deleteEcriture: (eid: string) => req<any>(`/ecritures/${eid}`, { method: 'DELETE' }),
  deleteAllEcritures: (did: string, journal?: string) => req<any>(`/dossiers/${did}/ecritures${journal ? '?journal=' + encodeURIComponent(journal) : ''}`, { method: 'DELETE' }),
  exportCSV: (did: string, journal?: string) => req<string>(`/dossiers/${did}/export${journal ? '?journal=' + encodeURIComponent(journal) : ''}`),
  getFactures: (did: string) => req<any[]>(`/dossiers/${did}/factures`),
  addFacture: (did: string, d: any) => req<any>(`/dossiers/${did}/factures`, { method: 'POST', body: JSON.stringify(d) }),
  deleteFacture: (fid: string) => req<any>(`/factures/${fid}`, { method: 'DELETE' }),
  deleteAllFactures: (did: string) => req<any>(`/dossiers/${did}/factures`, { method: 'DELETE' }),
  getExcluded: (did: string) => req<any[]>(`/dossiers/${did}/excluded`),
  generateVTJC: (did: string) => req<any>(`/dossiers/${did}/generate-vtjc`, { method: 'POST', body: '{}' }),
  getRapport: (did: string) => req<any[]>(`/dossiers/${did}/rapport`),
  deleteRapport: (did: string) => req<any>(`/dossiers/${did}/rapport`, { method: 'DELETE' }),
  uploadRapport: (did: string, rows: any[]) => req<any>(`/dossiers/${did}/rapport`, { method: 'POST', body: JSON.stringify({ rows }) }),

  // Client-side PDF processing: send extracted text to Worker
  processVTC: (did: string, text: string) => req<any>(`/dossiers/${did}/process-vtc`, { method: 'POST', body: JSON.stringify({ text }) }),
  processFISC: (did: string, dmi: any) => req<any>(`/dossiers/${did}/process-fisc`, { method: 'POST', body: JSON.stringify({ dmi }) }),

  verifyAI: (did: string) => req<any>(`/dossiers/${did}/verify-ai`, { method: 'POST', body: '{}' }),

  // --- BAUD ---
  baud: {
    getSocietes: () => req<any[]>('/baud/societes'),
    createSociete: (d: any) => req<any>('/baud/societes', { method: 'POST', body: JSON.stringify(d) }),
    deleteSociete: (id: string) => req<any>(`/baud/societes/${id}`, { method: 'DELETE' }),
    updateSociete: (id: string, d: any) => req<any>(`/baud/societes/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    getSalaries: (sid: string) => req<any[]>(`/baud/societes/${sid}/salaries`),
    createSalary: (sid: string, d: any) => req<any>(`/baud/societes/${sid}/salaries`, { method: 'POST', body: JSON.stringify(d) }),
    updateSalary: (id: string, d: any) => req<any>(`/baud/salaries/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    getRubriques: (sid: string) => req<any[]>(`/baud/societes/${sid}/rubriques`),
    upsertRubrique: (sid: string, d: any) => req<any>(`/baud/societes/${sid}/rubriques`, { method: 'POST', body: JSON.stringify(d) }),
    getDossiers: (sid: string) => req<any[]>(`/baud/societes/${sid}/dossiers`),
    createDossier: (sid: string, d: any) => req<any>(`/baud/societes/${sid}/dossiers`, { method: 'POST', body: JSON.stringify(d) }),
    getDossier: (did: string) => req<any>(`/baud/dossiers/${did}`),
    deleteDossier: (did: string) => req<any>(`/baud/dossiers/${did}`, { method: 'DELETE' }),
    upload: (did: string, filename: string, lignes: any[]) => req<any>(`/baud/dossiers/${did}/upload`, { method: 'POST', body: JSON.stringify({ filename, lignes }) }),
    extract: (did: string) => req<any>(`/baud/dossiers/${did}/extract`, { method: 'POST' }),
    getLignes: (did: string) => req<any[]>(`/baud/dossiers/${did}/lignes`),
    updateLigne: (id: string, d: any) => req<any>(`/baud/lignes/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    valider: (did: string) => req<any>(`/baud/dossiers/${did}/valider`, { method: 'POST' }),
    exportGA: (did: string) => req<any>(`/baud/dossiers/${did}/export`, { method: 'POST' }),
    getExports: (did: string) => req<any[]>(`/baud/dossiers/${did}/exports`),
    downloadExport: async (eid: string) => {
      const r = await fetch(`${BASE}/baud/exports/${eid}/download`);
      if (!r.ok) throw new Error('Download failed');
      return r.blob();
    },
    getCorrections: (sid: string) => req<any[]>(`/baud/societes/${sid}/corrections`),
    deleteCorrection: (cid: string) => req<any>(`/baud/corrections/${cid}`, { method: 'DELETE' }),
  },

  // --- SCANFLASH ---
  scan: {
    getSocietes: () => req<any[]>('/scan/societes'),
    createSociete: (d: any) => req<any>('/scan/societes', { method: 'POST', body: JSON.stringify(d) }),
    deleteSociete: (id: string) => req<any>(`/scan/societes/${id}`, { method: 'DELETE' }),
    getDossiers: (sid: string) => req<any[]>(`/scan/societes/${sid}/dossiers`),
    createDossier: (sid: string, d: any) => req<any>(`/scan/societes/${sid}/dossiers`, { method: 'POST', body: JSON.stringify(d) }),
    getDossier: (did: string) => req<any>(`/scan/dossiers/${did}`),
    deleteDossier: (did: string) => req<any>(`/scan/dossiers/${did}`, { method: 'DELETE' }),
    getFactures: (did: string) => req<any[]>(`/scan/dossiers/${did}/factures`),
    addFacture: (did: string, d: any) => req<any>(`/scan/dossiers/${did}/factures`, { method: 'POST', body: JSON.stringify(d) }),
    deleteAllFactures: (did: string) => req<any>(`/scan/dossiers/${did}/factures`, { method: 'DELETE' }),
    getEcritures: (did: string, journal?: string) => req<any[]>(`/scan/dossiers/${did}/ecritures${journal ? '?journal=' + encodeURIComponent(journal) : ''}`),
    addEcriture: (did: string, d: any) => req<any>(`/scan/dossiers/${did}/ecritures`, { method: 'POST', body: JSON.stringify(d) }),
    deleteAllEcritures: (did: string, journal?: string) => req<any>(`/scan/dossiers/${did}/ecritures${journal ? '?journal=' + encodeURIComponent(journal) : ''}`, { method: 'DELETE' }),
    deleteEcriture: (eid: string) => req<any>(`/scan/ecritures/${eid}`, { method: 'DELETE' }),
    generate: (did: string) => req<any>(`/scan/dossiers/${did}/generate`, { method: 'POST', body: '{}' }),
    exportCSV: (did: string, journal?: string) => req<string>(`/scan/dossiers/${did}/export${journal ? '?journal=' + encodeURIComponent(journal) : ''}`),
    exportXLSX: async (did: string) => {
      const res = await fetch(`${BASE}/scan/dossiers/${did}/export-xlsx`);
      if (!res.ok) throw new Error('Export XLSX failed');
      return await res.blob();
    },
    cleanup: (did: string) => req<any>(`/scan/dossiers/${did}/cleanup`, { method: 'POST', body: '{}' }),
    verifyAI: (did: string) => req<any>(`/scan/dossiers/${did}/verify-ai`, { method: 'POST', body: '{}' }),
    fixTVA: (did: string) => req<any>(`/scan/dossiers/${did}/fix-tva`, { method: 'POST', body: '{}' }),
  },
  ef: {
    verify: (data: any, signal?: AbortSignal) => req<any>('/ef/verify', { method: 'POST', body: JSON.stringify(data), signal }),
    tabAmt: (data: any, signal?: AbortSignal) => req<any>('/ef/tab-amt', { method: 'POST', body: JSON.stringify(data), signal }),
  },
};
