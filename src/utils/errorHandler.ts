/**
 * Shared error handler for store operations.
 *
 * Extracts a human-readable message from any thrown value, calls the provided
 * `setError` callback, and returns the resolved message string.
 */
export function handleStoreError(
  error: unknown,
  defaultMessage: string,
  setError: (msg: string) => void,
): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message || defaultMessage;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = defaultMessage;
  }

  setError(message);
  return message;
}
