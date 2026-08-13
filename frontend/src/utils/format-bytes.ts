/**
 * 바이트 → 사람이 읽는 크기 문자열.
 *
 * 1024 기준(KB/MB/GB)으로 표기한다. OS 파일 탐색기와 같은 기준이라
 * 사용자가 본 파일 크기와 화면 숫자가 어긋나지 않는다.
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}
