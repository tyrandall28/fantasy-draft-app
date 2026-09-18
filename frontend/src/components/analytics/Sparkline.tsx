interface SparklinePoint {
  season: number;
  ppr_per_game: number | null;
  games_played: number;
}

interface Props {
  data: SparklinePoint[];
  width?: number;
  height?: number;
}

/**
 * Tiny inline SVG sparkline showing PPR/game across seasons.
 * Green = trending up, Red = trending down, Gray = flat.
 */
export default function Sparkline({ data, width = 56, height = 20 }: Props) {
  // Filter to points with valid PPR data
  const points = data.filter((d) => d.ppr_per_game != null);
  if (points.length < 2) return null;

  const values = points.map((d) => d.ppr_per_game!);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Padding so dots don't clip
  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  // Map to SVG coordinates
  const coords = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * innerW,
    y: pad + innerH - ((v - minVal) / range) * innerH,
  }));

  // Build polyline path
  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

  // Compute slope for color
  const n = values.length;
  const sumX = values.reduce((s, _, i) => s + i, 0);
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumXX = values.reduce((s, _, i) => s + i * i, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

  // Normalize slope relative to the mean to get a percentage change
  const mean = sumY / n;
  const normalizedSlope = mean > 0 ? slope / mean : 0;

  let color = "#6b6862"; // slate (flat)
  if (normalizedSlope > 0.05) color = "#5cc98d";  // emerald (up)
  if (normalizedSlope < -0.05) color = "#f0736b"; // red (down)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle"
    >
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Dot on the most recent season */}
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r={2}
        fill={color}
      />
    </svg>
  );
}
