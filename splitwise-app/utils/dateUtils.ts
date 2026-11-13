/**
 * Safe date parsing and formatting utility.
 *
 * Backend server stores timestamps consistently in UTC ISO-8601 strings.
 * This parser ensures timestamps are parsed correctly as UTC and formatted
 * in the user's local timezone (Asia/Kolkata for India).
 */

const USER_TIMEZONE = 'Asia/Kolkata';

export function parseDate(dateInput: string | Date | null | undefined): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;

  const str = String(dateInput).trim();
  if (!str) return new Date();

  // If already has 'Z' or timezone offset (+HH:mm or -HH:mm), parse directly
  const hasTimezone = str.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(str);
  const normalized = hasTimezone ? str : `${str}Z`;

  const parsed = new Date(normalized);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Fallback to direct parse if normalized fails
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

/**
 * Formats a timestamp into human-readable relative time ("Just now", "5m ago", "Yesterday").
 */
export function formatRelativeTime(createdAt: string | Date): string {
  const date = parseDate(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // If created within the future minute (slight server-client clock skew), treat as just now
  if (diffMs < 60000 && diffMs > -60000) return 'Just now';

  const diffMinutes = Math.floor(Math.max(0, diffMs) / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  return formatDate(date);
}

/**
 * Formats a timestamp into a standard localized date string in user's timezone.
 */
export function formatDate(createdAt: string | Date): string {
  const date = parseDate(createdAt);
  try {
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: USER_TIMEZONE,
    });
  } catch {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}

/**
 * Formats a timestamp into a date and time string ("24 Oct 2026, 10:30 PM") in user's timezone.
 */
export function formatDateTime(createdAt: string | Date): string {
  const date = parseDate(createdAt);
  try {
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: USER_TIMEZONE,
    });
  } catch {
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}
