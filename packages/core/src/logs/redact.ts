const patterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /010[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
  /Bearer\s+\S+/gi,
  /token=[^&\s]+/gi,
  /cookie\s*[:=]\s*\S+/gi,
];

export function redactText(value: string): string {
  return patterns.reduce((text, pattern) => text.replace(pattern, "가림"), value);
}
