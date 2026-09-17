import { useState } from "react";

import { cdnThumb } from "../../lib/cdnImage";

interface Props {
  url: string | null;
  name: string;
  /** Rendered size in CSS pixels. The fetched image is always 2x this. */
  size?: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Player headshot, sized by the CDN rather than by the browser.
 *
 * The CDN does the resizing -- see lib/cdnImage. A hundred untransformed
 * headshots is ~83 MB per page load, which is what made an earlier attempt at
 * this unusable; transformed it's ~142 KB, and lazy loading means only the
 * dozen rows in view fetch anything at all.
 *
 * A URL we can't rewrite falls back to initials rather than loading at unknown
 * size, so one odd row can never reintroduce the original problem.
 */
export default function PlayerHeadshot({ url, name, size = 36 }: Props) {
  const [failed, setFailed] = useState(false);
  const src = url && !failed ? cdnThumb(url, size * 2) : null;

  return (
    <span
      className="inline-flex items-center justify-center shrink-0 rounded-full bg-ink-700 overflow-hidden select-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          // Only the dozen or so rows in view fetch anything; the rest load as
          // you scroll. Explicit width/height keeps the row from reflowing when
          // each one lands.
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-chalk-mut text-[11px] font-medium tracking-wide">
          {initials(name)}
        </span>
      )}
    </span>
  );
}
