/**
 * Copy text to clipboard. Silently handles failures (permission denied, unfocused document).
 * Use instead of raw `navigator.clipboard.writeText(...).catch(() => {})`.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API may fail if document is not focused or permission denied.
    // Nothing useful to do — the user can manually copy.
  }
}
