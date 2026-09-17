import type { PositionDataNotice as Notice } from "../../lib/positionData";

interface Props {
  notice: Notice;
  /** `compact` fits the narrow rankings side panel. */
  variant?: "default" | "compact";
}

/**
 * Explains why a position's analytics are incomplete.
 *
 * Amber rather than red: nothing is broken, the data just isn't there yet.
 * Shown above whatever real data does exist, so a kicker's field-goal numbers
 * are still usable while the caveat is visible.
 */
export default function PositionDataNotice({ notice, variant = "default" }: Props) {
  const compact = variant === "compact";
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border border-caution/20 bg-caution/5 ${
        compact ? "px-3 py-2.5" : "px-4 py-3"
      }`}
      role="note"
    >
      <span
        aria-hidden="true"
        className={`flex-shrink-0 leading-5 text-caution ${compact ? "text-xs" : "text-sm"}`}
      >
        ⓘ
      </span>
      <div className="min-w-0">
        <p
          className={`font-medium text-caution ${
            compact ? "text-xs leading-4" : "text-sm leading-5"
          }`}
        >
          {notice.title}
        </p>
        <p
          className={`mt-1 text-chalk-dim ${
            compact ? "text-[11px] leading-4" : "text-sm leading-5"
          }`}
        >
          {notice.detail}
        </p>
      </div>
    </div>
  );
}
