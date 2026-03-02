/**
 * Simple analytics tracker. Currently logs to console.
 * Can be hooked to a backend API later.
 */
export function track(eventName: string, payload?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    console.log(`[Analytics] ${eventName} @ ${timestamp}`, payload || {});

    // Example for future API call:
    /*
    fetch('/api/track', {
      method: 'POST',
      body: JSON.stringify({ eventName, payload, timestamp }),
      headers: { 'Content-Type': 'application/json' }
    }).catch(console.error);
    */
}
