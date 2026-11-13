/**
 * SplitWise Mobile App Configuration
 *
 * Base API URL resolution logic:
 * 1. process.env.EXPO_PUBLIC_API_URL (provided via eas.json, .env, or CLI)
 * 2. In release/production builds (!__DEV__): Deployed Render backend URL
 * 3. In local development (__DEV__): Localhost backend (or start:lan)
 */

const sanitizeUrl = (url: string): string => {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

// Default deployed Render service HTTPS URL for production APK builds
const DEFAULT_PROD_URL = 'https://splitwise-backend-jtzy.onrender.com/api';
const DEFAULT_DEV_URL = 'http://localhost:8080/api';

const resolveApiBaseUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return sanitizeUrl(envUrl);
  }
  // In release / production APK, never point to localhost
  if (!__DEV__) {
    return DEFAULT_PROD_URL;
  }
  return DEFAULT_DEV_URL;
};

export const API_BASE_URL = resolveApiBaseUrl();

// Safe diagnostic logging (never logs tokens, passwords, or user data)
if (__DEV__) {
  console.log(`[Config] API_BASE_URL initialized (dev): ${API_BASE_URL}`);
} else {
  try {
    const urlObj = new URL(API_BASE_URL);
    console.log(`[Config] API Target Host: ${urlObj.protocol}//${urlObj.host}`);
  } catch {
    console.log('[Config] API Target Host initialized');
  }
}
