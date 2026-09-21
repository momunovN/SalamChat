"use client";

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
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-elevated text-ink"
          style={{ fontSize: size * 0.36, fontWeight: 600 }}
        >
          {letter}
        </div>
      )}
      {online ? (
        <span className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-bg bg-success" />
      ) : null}
    </div>
  );
}
