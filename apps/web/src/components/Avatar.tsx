"use client";

/** Soft two-tone fills, picked by name so a person keeps the same color everywhere. */
const FILLS = [
  ["#3b82f6", "#1d4ed8"],
  ["#22c55e", "#15803d"],
  ["#f59e0b", "#c2410c"],
  ["#ec4899", "#be185d"],
  ["#8b5cf6", "#6d28d9"],
  ["#06b6d4", "#0e7490"],
  ["#ef4444", "#b91c1c"],
  ["#14b8a6", "#0f766e"],
];

function fillFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) | 0;
  return FILLS[Math.abs(h) % FILLS.length];
}

/** Text color matching someone's avatar, for author names in group chats. */
export function nameColor(name: string) {
  return fillFor(name || "?")[0];
}

export function Avatar({
  name,
  src,
  size = 44,
  online,
}: {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
}) {
  const letter = ([...(name || "")].find((c) => /\p{L}|\p{N}/u.test(c)) || "?").toUpperCase();
  const [from, to] = fillFor(name || "?");
  const dot = Math.max(10, Math.round(size * 0.26));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full bg-elevated object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full text-white select-none"
          style={{ fontSize: size * 0.4, fontWeight: 600, background: `linear-gradient(145deg, ${from}, ${to})` }}
        >
          {letter}
        </div>
      )}
      {online ? (
        <span
          className="absolute right-0 bottom-0 rounded-full border-2 border-bg bg-success"
          style={{ width: dot, height: dot }}
        />
      ) : null}
    </div>
  );
}
