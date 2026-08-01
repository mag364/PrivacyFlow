export function insertTextAtCursor(
  textarea: HTMLTextAreaElement | null,
  current: string,
  insert: string,
): string {
  const start = textarea?.selectionStart ?? current.length;
  const end = textarea?.selectionEnd ?? start;
  const next = `${current.slice(0, start)}${insert}${current.slice(end)}`;
  const cursor = start + insert.length;

  requestAnimationFrame(() => {
    textarea?.focus();
    textarea?.setSelectionRange(cursor, cursor);
  });

  return next;
}
