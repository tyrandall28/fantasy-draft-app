import PlayerAnalyticsColumn from "./PlayerAnalyticsColumn";
import type {
  PlayerDerivedStats,
  PlayerWeekly,
  SparklinePoint,
  UserRankingEntry,
} from "../../types";

interface Props {
  entry: UserRankingEntry;
  stats: PlayerDerivedStats | null;
  positionGroup: PlayerDerivedStats[];
  sparkline: SparklinePoint[];
  weekly: PlayerWeekly[];
  loading: boolean;
}

export default function SinglePlayerView({
  entry,
  stats,
  positionGroup,
  sparkline,
  weekly,
  loading,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <PlayerAnalyticsColumn
        entry={entry}
        stats={stats}
        positionGroup={positionGroup}
        sparkline={sparkline}
        weekly={weekly}
        loading={loading}
      />

      {/* Compare hint */}
      <div className="pt-2 border-t border-ink-700">
        <p className="text-xs text-chalk-mut text-center italic">
          Click another player in your rankings to compare head-to-head.
        </p>
      </div>
    </div>
  );
}
