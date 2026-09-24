import { useEffect, useState } from 'react';
import { t } from '../lib/orgI18n';

interface ProgressDonutProps {
  fait: number;
  enCours: number;
  bloqueClient: number;
  size?: number;
  showLabel?: boolean;
  className?: string;
  animated?: boolean;
}

const COLORS = {
  fait: '#10b981',       // emerald-500 — ça marche
  enCours: '#9ca3af',    // gray-400 — en attente (fi la7dha)
  bloqueClient: '#ef4444', // red-500 — ne marche pas
};

const GLOW_COLORS = {
  fait: '#34d399',
  enCours: '#d1d5db',
  bloqueClient: '#f87171',
};

export default function ProgressDonut({
  fait, enCours, bloqueClient,
  size = 100, showLabel = true, className = '', animated = true,
}: ProgressDonutProps) {
  const [animProgress, setAnimProgress] = useState(animated ? 0 : 1);
  const total = fait + enCours + bloqueClient;
  const pct = total > 0 ? Math.round((fait / total) * 100) : 0;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const strokeWidth = Math.max(8, size / 10);
  const innerRadius = radius - strokeWidth / 2;

  // Animate on mount
  useEffect(() => {
    if (!animated) { setAnimProgress(1); return; }
    let start: number | null = null;
    const duration = 800;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const p = Math.min(elapsed / duration, 1);
      setAnimProgress(ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [animated, fait, enCours, bloqueClient]);

  if (total === 0) {
    return (
      <div className={`inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} strokeDasharray="4 3" />
        </svg>
        {showLabel && (
          <span className="absolute text-[10px] font-bold text-gray-400">—</span>
        )}
      </div>
    );
  }

  // Calculate arc segments
  const segments = [
    { value: fait, color: COLORS.fait, glow: GLOW_COLORS.fait, label: 'fait' },
    { value: enCours, color: COLORS.enCours, glow: GLOW_COLORS.enCours, label: 'enCours' },
    { value: bloqueClient, color: COLORS.bloqueClient, glow: GLOW_COLORS.bloqueClient, label: 'bloqueClient' },
  ].filter(s => s.value > 0);

  let offset = 0;
  const arcs = segments.map(seg => {
    const dashLen = (seg.value / total) * circumference * animProgress;
    const gap = circumference - dashLen;
    const dashOffset = -(offset / total) * circumference * animProgress;
    offset += seg.value;
    return { ...seg, dashLen, gap, dashOffset };
  });

  const gradientId = `donut-grad-${size}`;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 drop-shadow-sm">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f3f4f6" />
            <stop offset="100%" stopColor="#e5e7eb" />
          </linearGradient>
        </defs>
        {/* Background track */}
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
        />
        {/* Animated arcs */}
        {arcs.map((arc, i) => (
          <g key={i}>
            {/* Glow layer */}
            <circle
              cx={center} cy={center} r={radius}
              fill="none"
              stroke={arc.glow}
              strokeWidth={strokeWidth + 4}
              strokeDasharray={`${arc.dashLen} ${arc.gap}`}
              strokeDashoffset={arc.dashOffset}
              strokeLinecap="round"
              opacity={0.2}
              style={{ filter: 'blur(4px)' }}
            />
            {/* Main arc */}
            <circle
              cx={center} cy={center} r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.dashLen} ${arc.gap}`}
              strokeDashoffset={arc.dashOffset}
              strokeLinecap="round"
              style={{
                transition: animated ? 'stroke-dasharray 0.1s ease-out' : undefined,
                filter: `drop-shadow(0 0 3px ${arc.glow}40)`,
              }}
            />
          </g>
        ))}
      </svg>
      {/* Center percentage */}
      <span
        className={`absolute font-bold text-gray-800 ${
          size >= 100 ? 'text-2xl' : size >= 60 ? 'text-base' : 'text-xs'
        }`}
        style={{
          textShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        {Math.round(pct * animProgress)}%
      </span>
    </div>
  );
}

// Enhanced Legend — always shows the 3 states: marche / en attente / ne marche pas
export function DonutLegend({ fait, enCours, bloqueClient, className = '' }: {
  fait: number; enCours: number; bloqueClient: number; className?: string;
}) {
  const total = fait + enCours + bloqueClient;
  const items = [
    { count: fait, color: COLORS.fait, label: t('donut.done'), hint: '✓' },
    { count: enCours, color: COLORS.enCours, label: t('donut.in_progress'), hint: '…' },
    { count: bloqueClient, color: COLORS.bloqueClient, label: t('donut.blocked'), hint: '✕' },
  ];

  return (
    <div className={`flex flex-wrap gap-x-5 gap-y-2 text-sm ${className}`}>
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round(item.count / total * 100) : 0;
        return (
          <span key={i} className="flex items-center gap-2">
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-30" style={{ background: item.color }} />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5" style={{ background: item.color }} />
            </span>
            <span className="text-gray-700 font-medium">{item.label}</span>
            <span className="font-bold text-gray-900 text-base">{item.count}</span>
            <span className="text-gray-400">({pct}%)</span>
          </span>
        );
      })}
    </div>
  );
}
