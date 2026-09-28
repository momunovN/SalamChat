export function BrandMark({
  className = "h-10 w-10",
  alt = "Salam",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.svg" alt={alt} className={className} />
  );
}
