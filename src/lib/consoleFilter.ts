/**
 * Filter out noisy console warnings from wallet extensions and third-party libraries
 * while preserving useful error messages for debugging.
 */

// Patterns of console messages to suppress in production
const SUPPRESSED_PATTERNS = [
  // Phantom wallet content script errors
  /Failed to send message to service worker/i,
  /Attempting to use a disconnected port/i,
  /contentScript\.js/i,
  
  // Wallet adapter connection noise
  /wallet.*not.*ready/i,
  /wallet.*not.*installed/i,
  /user.*rejected/i,
  /user.*declined/i,
  
  // React strict mode warnings (only in dev)
  /findDOMNode is deprecated/i,
  
  // Common browser extension noise
  /Extension context invalidated/i,
  /chrome-extension:\/\//i,
  
  // Shadow DOM image loading errors (NFT images from dead hosts)
  /shdw-drive\.genesysgo\.net/i,
  
  // Jupiter API 404s for missing token prices (expected)
  /lite-api\.jup\.ag.*404/i,
];

// Patterns that should ALWAYS be logged (security, critical errors)
const ALWAYS_LOG_PATTERNS = [
  /security/i,
  /csrf/i,
  /xss/i,
  /unauthorized/i,
  /forbidden/i,
  /CORS/i,
];

function shouldSuppressMessage(args: any[]): boolean {
  // Only filter in production
  if (import.meta.env.DEV) return false;
  
  const message = args.map(arg => String(arg)).join(' ');
  
  // Never suppress security-related messages
  if (ALWAYS_LOG_PATTERNS.some(pattern => pattern.test(message))) {
    return false;
  }
  
  // Suppress known noisy patterns
  return SUPPRESSED_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Install console filters to suppress known noisy warnings while
 * preserving useful debugging information.
 */
export function installConsoleFilters(): void {
  if (typeof window === 'undefined') return;
  
  const originalWarn = console.warn;
  const originalError = console.error;
  
  console.warn = function(...args: any[]) {
    if (!shouldSuppressMessage(args)) {
      originalWarn.apply(console, args);
    }
  };
  
  console.error = function(...args: any[]) {
    if (!shouldSuppressMessage(args)) {
      originalError.apply(console, args);
    }
  };
  
  // Suppress uncaught promise rejections from wallet extensions
  window.addEventListener('unhandledrejection', (event) => {
    const message = String(event.reason);
    if (shouldSuppressMessage([message])) {
      event.preventDefault(); // Suppress the console error
    }
  });
  
  console.info('[console] Filters installed - production noise suppressed');
}
