/**
 * Design tokens for SplitWise app
 * Centralized theme configuration with colors, typography, spacing, and border radius
 */

export const colors = {
  primary: '#D85A30', // coral orange
  success: '#0F6E56', // teal green
  positive: '#0F6E56', // alias for success
  danger: '#A32D2D', // red
  owe: '#A32D2D', // alias for danger
  background: '#FAF8F5',
  surface: '#FFFFFF', // card background
  border: '#E8E3DA',
  textPrimary: '#1E2A24',
  textSecondary: '#6B7280',
  accentBg: '#FDECE6', // light coral tint
  heroBg: '#1C2B22', // deep ink green for auth hero
  heroCircle: '#25392C', // lighter shade for decorative circles
  heroMuted: '#8FA396', // muted green-gray for hero secondary text
  cream: '#FBF8F3', // cream color for text on dark backgrounds
  mutedGreen: '#8B9A8F', // muted green-gray for secondary text
  foodTint: '#FDECE6', // light coral tint for food/dining
  travelTint: '#E6F4EF', // light teal tint for travel
  entertainmentTint: '#FEF3E2', // light amber tint for entertainment
} as const;

export const fontFamily = {
  regular: 'System', // Will be replaced with Google Fonts later
  mono: 'Courier', // Will be replaced with Google Fonts later
} as const;

export const spacing = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  24: 24,
  32: 32,
} as const;

export const borderRadius = {
  8: 8,
  12: 12,
  16: 16,
  24: 24,
} as const;

/**
 * Complete theme object combining all design tokens
 */
export const theme = {
  colors,
  fontFamily,
  spacing,
  borderRadius,
} as const;

export type Theme = typeof theme;
export type Colors = typeof colors;
export type FontFamily = typeof fontFamily;
export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;