interface Props {
  seconds: number;
  isMyTurn: boolean;
}

export default function PickTimer({ seconds, isMyTurn }: Props) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = `${minutes}:${secs.toString().padStart(2, "0")}`;

  const urgent = seconds <= 10;

  return (
    <div
      className={`text-2xl font-mono font-bold px-4 py-1.5 rounded-lg ${
        urgent && isMyTurn
          ? "bg-fall/20 text-fall animate-pulse"
          : isMyTurn
          ? "bg-rise/20 text-rise"
          : "bg-ink-700 text-chalk-dim"
      }`}
    >
      {display}
    </div>
  );
}
