import { t } from '../lib/orgI18n';

interface ProgressDonutProps {
  fait: number;
  enCours: number;
  bloqueClient: number;
  size?: number;
  showLabel?: boolean;
  className?: string;
}

const COLORS = {
  fait: '#10b981',       // emerald-500
  enCours: '#3b82f6',    // blue-500
  bloqueClient: '#ef4444', // red-500
};

export default function ProgressDonut({
  fait, enCours, bloqueClient,
  size = 64, showLabel = true, className = '',
}: ProgressDonutProps) {
  const total = fait + enCours + bloqueClient;
  const pct = total > 0 ? Math.round((fait / total) * 100) : 0;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const strokeWidth = size > 50 ? 6 : 4;

  if (total === 0) {
    return (
      <div className={`inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        </svg>
        {showLabel && (
          <span className="absolute text-[10px] font-bold text-gray-400">—</span>
        )}
      </div>
    );
  }

  // Calculate arc segments
  const segments = [
    { value: fait, color: COLORS.fait },
    { value: enCours, color: COLORS.enCours },
    { value: bloqueClient, color: COLORS.bloqueClient },
  ].filter(s => s.value > 0);

  let offset = 0;
  const arcs = segments.map(seg => {
    const dashLen = (seg.value / total) * circumference;
    const dashOffset = -offset * circumference / total;
    offset += seg.value;
    return { ...seg, dashLen, dashOffset };
  });

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.dashLen} ${circumference - arc.dashLen}`}
            strokeDashoffset={arc.dashOffset}
            strokeLinecap="round"
          />
        ))}
      </svg>
      <span className={`absolute font-bold text-gray-700 ${size > 50 ? 'text-sm' : 'text-[9px]'}`}>
        {pct}%
      </span>
    </div>
  );
}

// Legend component
export function DonutLegend({ fait, enCours, bloqueClient, className = '' }: {
  fait: number; enCours: number; bloqueClient: number; className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-3 text-xs ${className}`}>
      <span className="flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.fait }} />
        {t('donut.done')} ({fait})
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.enCours }} />
        {t('donut.in_progress')} ({enCours})
      </span>
      {bloqueClient > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.bloqueClient }} />
          {t('donut.blocked')} ({bloqueClient})
        </span>
      )}
    </div>
  );
}
