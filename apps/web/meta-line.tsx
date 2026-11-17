/**
 * 짧은 사실 여러 개를 한 줄에. 가운뎃점(「A · B · C」) 대신 간격으로 나눈다(Hallmark 63, 2026-11-16).
 * 빈 값(null·undefined·"")은 뺀다.
 */
export function MetaLine({ items, className }: { items: readonly (string | number | null | undefined | false)[]; className?: string }) {
  const shown = items.filter((item): item is string | number => item !== null && item !== undefined && item !== false && item !== "");
  return (
    <span className={className ? `farm-meta ${className}` : "farm-meta"}>
      {shown.map((item, index) => (
        <span key={`${index}-${item}`}>{item}</span>
      ))}
    </span>
  );
}
