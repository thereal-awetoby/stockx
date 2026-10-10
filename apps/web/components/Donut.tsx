export interface DonutSegment { label: string; value: number; color: string }

/** Plain SVG donut. Zero total draws an empty ring. */
export default function Donut({ segments, size = 168, centre }: { segments: DonutSegment[]; size?: number; centre?: string }) {
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Allocation">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {total > 0 && segments.map((s) => {
          const len = (Math.max(0, s.value) / total) * c;
          const el = (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </g>
      {centre && <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fontSize="15" fill="var(--ink)">{centre}</text>}
    </svg>
  );
}
