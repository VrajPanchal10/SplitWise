/**
 * Expense category definitions for SplitWise
 * Shared between manual-entry, bill detail, group detail, and insights screens
 */

export interface CategoryConfig {
  key: string;
  label: string;
  emoji: string;
  color: string;
  tint: string;
}

export const EXPENSE_CATEGORIES: CategoryConfig[] = [
  { key: 'Food',            label: 'Food & Dining',   emoji: '🍽️',  color: '#D85A30', tint: '#FDECE6' },
  { key: 'Travel',          label: 'Travel',          emoji: '✈️',  color: '#0F6E56', tint: '#E6F4EF' },
  { key: 'Transport',       label: 'Transport',       emoji: '🚗',  color: '#2563EB', tint: '#EFF6FF' },
  { key: 'Accommodation',   label: 'Accommodation',   emoji: '🏨',  color: '#7C3AED', tint: '#F3E8FF' },
  { key: 'Entertainment',   label: 'Entertainment',   emoji: '🎬',  color: '#B45309', tint: '#FEF3E2' },
  { key: 'Shopping',        label: 'Shopping',        emoji: '🛍️',  color: '#DB2777', tint: '#FDF2F8' },
  { key: 'Groceries',       label: 'Groceries',       emoji: '🛒',  color: '#059669', tint: '#ECFDF5' },
  { key: 'Bills',           label: 'Bills & Utilities', emoji: '💡',  color: '#0891B2', tint: '#ECFEFF' },
  { key: 'Healthcare',      label: 'Healthcare',      emoji: '🏥',  color: '#DC2626', tint: '#FEF2F2' },
  { key: 'Education',       label: 'Education',       emoji: '📚',  color: '#4338CA', tint: '#EEF2FF' },
  { key: 'Other',           label: 'Other',           emoji: '📦',  color: '#6B7280', tint: '#F3F4F6' },
];

/** Get category config by key. Falls back to "Other" if not found. */
export function getCategoryByKey(key?: string | null): CategoryConfig {
  if (!key) return EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]; // "Other"
  const found = EXPENSE_CATEGORIES.find(c => c.key.toLowerCase() === key.toLowerCase());
  return found || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}

/** Returns the category keys array for validation */
export const CATEGORY_KEYS = EXPENSE_CATEGORIES.map(c => c.key);
