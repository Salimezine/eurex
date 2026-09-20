import { useState } from 'react';
import { TimelineEvent } from '../lib/orgApi';
import { t } from '../lib/orgI18n';

interface TimelineProps {
  events: TimelineEvent[];
}

type Filter = 'all' | 'blockages' | 'documents';

export default function Timeline({ events }: TimelineProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = events.filter(e => {
    if (filter === 'blockages') return e.type === 'task_status_changed' && e.details?.new_status === 'bloque_client';
    if (filter === 'documents') return e.type === 'document_received' || e.type === 'document_unreceived';
    return true;
  });

  // Group by day
  const grouped: Record<string, TimelineEvent[]> = {};
  for (const e of filtered) {
    const day = e.date?.split('T')[0] || e.date?.split(' ')[0] || 'unknown';
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(e);
  }

  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (events.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">Aucun événement</p>;
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        {(['all', 'blockages', 'documents'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              filter === f ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {t(`timeline.${f}`)}
          </button>
        ))}
      </div>

      {/* Vertical timeline */}
      <div className="relative pl-6">
        <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-gray-200" />
        {days.map(day => (
          <div key={day} className="mb-4">
            <div className="text-xs font-semibold text-gray-500 mb-2 relative">
              <span className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-gray-300 border-2 border-white" />
              {new Date(day + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            {grouped[day].map((event, i) => (
              <div key={i} className="relative pl-4 pb-3">
                <span className="absolute -left-[14px] top-0.5 text-sm">{event.icon}</span>
                <div className="bg-white border border-gray-100 rounded-lg p-2.5 shadow-sm">
                  <p className="text-sm text-gray-800">{event.label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-gray-400">
                      {event.date?.split('T')[1]?.slice(0, 5) || ''}
                    </span>
                    {event.actor && (
                      <span className="text-[11px] text-gray-500 font-medium">
                        — {event.actor}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
