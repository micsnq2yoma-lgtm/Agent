/** Skeleton lines instead of "加载中…" (DESIGN §4.14). */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-label="加载中" role="status">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}
