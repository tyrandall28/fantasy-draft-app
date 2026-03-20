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
          ? "bg-red-500/20 text-red-400 animate-pulse"
          : isMyTurn
          ? "bg-green-500/20 text-green-400"
          : "bg-white/5 text-slate-400"
      }`}
    >
      {display}
    </div>
  );
}
