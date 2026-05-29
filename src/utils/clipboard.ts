/**
 * Copy text to clipboard. Returns true on success, false on failure.
 * Use instead of raw `navigator.clipboard.writeText(...).catch(() => {})`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API may fail if document is not focused or permission denied.
    // Nothing useful to do — the user can manually copy.
    return false;
  }
}
