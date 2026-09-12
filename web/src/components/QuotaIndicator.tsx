import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import { checkQuota, QuotaStatus } from '../lib/cfQuota';

export default function QuotaIndicator() {
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const s = await checkQuota();
    setStatus(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  let bg = 'bg-gray-100 text-gray-600';
  if (status) {
    if (status.mode === 'error') {
      bg = 'bg-red-50 text-red-600';
    } else if (!status.available) {
      bg = 'bg-red-50 text-red-600';
    } else if (status.mode === 'probe') {
      bg = 'bg-gray-100 text-gray-600';
    } else if (status.remainingNeurons !== null && status.remainingNeurons < 3000) {
      bg = 'bg-amber-50 text-amber-700';
    } else {
      bg = 'bg-green-50 text-green-700';
    }
  }

  return (
    <button
      onClick={load}
      title="Quota IA Cloudflare (cliquez pour actualiser)"
      className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 ${bg}`}
    >
      <Zap size={13} />
      {loading ? (
        <span>...</span>
      ) : status ? (
        <span>{status.message}</span>
      ) : (
        <span>Quota IA</span>
      )}
      <RefreshCw size={11} className={`opacity-50 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}