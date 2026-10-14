import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { orgApi } from '../../lib/orgApi';

type PortalData = {
  client_name: string;
  dossier: { exercice: number; progress: number } | null;
  docs: { label: string; received: number }[];
  docs_received: number;
  docs_total: number;
};

// Portail client public (securise par token aleatoire) : avancement + pieces attendues,
// sans login. Genere depuis le dossier (bouton "Portail client").
export default function OrgPortailClient() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    orgApi.getPublicPortal(token)
      .then(r => { if (alive) setData(r); })
      .catch(e => { if (alive) setError(e.message || 'Lien invalide'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-emerald-50 flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">EUREX</h1>
          <p className="text-sm text-gray-500">Suivi de votre dossier comptable</p>
        </div>

        {loading && (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">
            Chargement...
          </div>
        )}

        {error && (
          <div className="bg-white border border-red-200 rounded-2xl p-8 text-center">
            <p className="text-2xl mb-2">🔗</p>
            <p className="text-sm font-semibold text-gray-800">Lien expiré ou invalide</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
          </div>
        )}

        {data && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-purple-600 text-white px-6 py-5">
              <p className="text-xs uppercase tracking-wide opacity-80">Client</p>
              <h2 className="text-xl font-bold">{data.client_name}</h2>
            </div>

            {data.dossier ? (
              <div className="p-6 space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-700">Exercice {data.dossier.exercice}</p>
                    <p className="text-sm font-bold text-purple-700">{Math.round(data.dossier.progress)}%</p>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{
                        width: `${Math.min(100, Math.round(data.dossier.progress))}%`,
                        background: data.dossier.progress >= 80 ? 'linear-gradient(90deg,#10b981,#34d399)' : data.dossier.progress >= 40 ? 'linear-gradient(90deg,#3b82f6,#60a5fa)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    {data.docs_received}/{data.docs_total} pièce(s) reçue(s)
                  </p>
                </div>

                {data.docs.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pièces</h3>
                    <ul className="space-y-1.5">
                      {data.docs.map((d, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                          <span className="mt-0.5">{d.received ? '✅' : '⏳'}</span>
                          <span className={d.received ? 'text-gray-400 line-through' : 'text-gray-700'}>{d.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">
                  Cette page se met à jour automatiquement. Pour toute question, contactez votre comptable au cabinet.
                </p>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-gray-400">
                Aucun dossier en cours pour le moment.
              </div>
            )}
          </div>
        )}

        <p className="text-center text-[10px] text-gray-400 mt-6">
          Cabinet EUREX — lien confidentiel, ne le partagez qu'avec votre client
        </p>
      </div>
    </div>
  );
}
