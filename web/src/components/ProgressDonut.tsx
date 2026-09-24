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
  fait: '#10b981',        // emerald-500 — ça marche
  bloqueClient: '#ef4444', // red-500 — ne marche pas
};

const GLOW_COLORS = {
  fait: '#34d399',
  bloqueClient: '#f87171',
};

export default function ProgressDonut({
  fait, enCours, bloqueClient,
  size = 100, showLabel = true, className = '', animated = true,
}: ProgressDonutProps) {
  const [animProgress, setAnimProgress] = useState(animated ? 0 : 1);
  const total = fait + enCours + bloqueClient;
  const pct = total > 0 ? Math.round((fait / total) * 100) : 0;
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const strokeWidth = Math.max(10, size / 9);

  useEffect(() => {
    if (!animated) { setAnimProgress(1); return; }
    let start: number | null = null;
    const duration = 900;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setAnimProgress(ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [animated, fait, enCours, bloqueClient]);

  if (total === 0) {
    return (
      <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} strokeDasharray="4 3" />
        </svg>
        {showLabel && <span className="absolute text-sm font-bold text-gray-300">—</span>}
      </div>
    );
  }

  // Only green + red arcs; enCours stays on the light track (no gray segment)
  const segments = [
    { value: fait, color: COLORS.fait, glow: GLOW_COLORS.fait },
    { value: bloqueClient, color: COLORS.bloqueClient, glow: GLOW_COLORS.bloqueClient },
  ].filter(s => s.value > 0);

  let offset = 0;
  const arcs = segments.map(seg => {
    const dashLen = (seg.value / total) * circumference * animProgress;
    const gap = circumference - dashLen;
    const dashOffset = -(offset / total) * circumference * animProgress;
    offset += seg.value;
    return { ...seg, dashLen, gap, dashOffset };
  });

  const trackId = `donut-track-${size}-${Math.round(size)}`;
  const greenGradId = `donut-green-${size}`;
  const redGradId = `donut-red-${size}`;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={trackId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f9fafb" />
            <stop offset="100%" stopColor="#eef0f3" />
          </linearGradient>
          <linearGradient id={greenGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id={redGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f87171" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
          <filter id={`donut-shadow-${size}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.08" />
          </filter>
        </defs>
        {/* Light track = en attente (fi la7dha) */}
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke={`url(#${trackId})`}
          strokeWidth={strokeWidth}
          filter={`url(#donut-shadow-${size})`}
        />
        {/* Green + Red arcs */}
        {arcs.map((arc, i) => {
          const grad = arc.color === COLORS.fait ? greenGradId : redGradId;
          return (
            <g key={i}>
              <circle
                cx={center} cy={center} r={radius}
                fill="none"
                stroke={arc.glow}
                strokeWidth={strokeWidth + 5}
                strokeDasharray={`${arc.dashLen} ${arc.gap}`}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="round"
                opacity={0.25}
                style={{ filter: 'blur(5px)' }}
              />
              <circle
                cx={center} cy={center} r={radius}
                fill="none"
                stroke={`url(#${grad})`}
                strokeWidth={strokeWidth}
                strokeDasharray={`${arc.dashLen} ${arc.gap}`}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="round"
                style={{
                  transition: animated ? 'stroke-dasharray 0.12s ease-out' : undefined,
                }}
              />
            </g>
          );
        })}
      </svg>
      {/* Inner disc + center % */}
      <div
        className="absolute rounded-full bg-white shadow-inner flex items-center justify-center"
        style={{
          width: size - strokeWidth * 2 - 6,
          height: size - strokeWidth * 2 - 6,
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <span
          className={`font-extrabold tracking-tight ${
            pct >= 80 ? 'text-emerald-600' : pct <= 30 && bloqueClient > 0 ? 'text-red-500' : 'text-gray-800'
          } ${size >= 110 ? 'text-3xl' : size >= 80 ? 'text-xl' : 'text-sm'}`}
        >
          {Math.round(pct * animProgress)}%
        </span>
      </div>
    </div>
  );
}

// Legend — only green + red (attente reste sur la piste)
export function DonutLegend({ fait, enCours, bloqueClient, className = '' }: {
  fait: number; enCours: number; bloqueClient: number; className?: string;
}) {
  const total = fait + enCours + bloqueClient;
  const items = [
    { count: fait, color: COLORS.fait, label: t('donut.done'), icon: '✓' },
    { count: bloqueClient, color: COLORS.bloqueClient, label: t('donut.blocked'), icon: '✕' },
  ];

  return (
    <div className={`flex flex-wrap gap-x-6 gap-y-2 text-sm ${className}`}>
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round(item.count / total * 100) : 0;
        return (
          <span key={i} className="flex items-center gap-2">
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
              style={{ background: item.color }}
            >
              {item.icon}
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
