export function appendProjectComment(
  existing: string | undefined,
  comment: string,
  author: string,
  timestamp: string,
): string {
  const entry = `[${timestamp}] ${author}\n${comment.trim()}`;
  const previous = existing?.trim();
  return previous ? `${previous}\n\n${entry}` : entry;
}
