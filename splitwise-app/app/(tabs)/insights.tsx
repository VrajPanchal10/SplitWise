import { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, DeviceEventEmitter } from 'react-native';
import { TrendingUp, TrendingDown, Trophy, Receipt, CheckCircle2, Users, Camera, ArrowUpRight, ArrowDownRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';
import { parseDate, formatRelativeTime, formatDate } from '../../utils/dateUtils';
import { EXPENSE_CATEGORIES, getCategoryByKey, type CategoryConfig } from '@/constants/categories';
import { formatMoney, getApproximateRate } from '@/constants/currencies';

// ─── Types ───────────────────────────────────────────────────────────
interface ActivityItem {
  id: string;
  type: string;
  description: string;
  relatedGroupId?: string | null;
  relatedBillId?: string | null;
  actorUserId?: string | null;
  groupName?: string | null;
  amount?: number | null;
  createdAt: string;
}

interface BillData {
  id: string;
  title: string;
  totalAmount: number;
  currency?: string;
  baseCurrency?: string;
  exchangeRate?: number;
  convertedAmount?: number;
  groupId?: string | null;
  paidBy: string;
  category?: string;
  items: { sharedByUserIds?: string[]; price?: number; customShares?: Record<string, number> }[];
  createdAt: string;
}

interface GroupData {
  id: string;
  name: string;
}

type FilterPeriod = 'week' | 'month' | 'all';
type InsightTab = 'overview' | 'categories' | 'members';

// ─── Activity display helpers ─────────────────────────────────────────
const activityIconConfig: Record<string, { Icon: any; color: string; bg: string; label: string }> = {
  GROUP_CREATED: { Icon: Users, color: theme.colors.primary, bg: theme.colors.foodTint, label: 'Group' },
  MEMBER_ADDED: { Icon: Users, color: theme.colors.success, bg: theme.colors.travelTint, label: 'Member' },
  EXPENSE_ADDED: { Icon: Receipt, color: theme.colors.primary, bg: theme.colors.foodTint, label: 'Expense' },
  EXPENSE_SETTLED: { Icon: CheckCircle2, color: theme.colors.success, bg: theme.colors.travelTint, label: 'Settlement' },
  PROFILE_PHOTO_CHANGED: { Icon: Camera, color: '#7C3AED', bg: '#F3E8FF', label: 'Profile' },
};

// ─── Component ───────────────────────────────────────────────────────
export default function InsightsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [allBills, setAllBills] = useState<BillData[]>([]);
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [memberNamesMap, setMemberNamesMap] = useState<Record<string, string>>({});
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [groupNamesMap, setGroupNamesMap] = useState<Record<string, string>>({});
  const [showAllActivities, setShowAllActivities] = useState(false);

  // Filters
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('month');
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InsightTab>('overview');

  // ─── Data fetching ──────────────────────────────────────────────────
  const fetchInsights = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);

      // 1. Fetch groups
      let userGroups: GroupData[] = [];
      try {
        const res = await apiClient.get('/groups');
        userGroups = res.data || [];
      } catch (err) { console.error('Error fetching groups:', err); }
      setGroups(userGroups);

      const gDict: Record<string, string> = {};
      userGroups.forEach(g => { gDict[g.id] = g.name; });
      setGroupNamesMap(gDict);

      // 2. Fetch all bills (personal + group)
      const billsMap = new Map<string, BillData>();
      try {
        const myBillsRes = await apiClient.get('/bills/mine');
        (myBillsRes.data || []).forEach((b: BillData) => billsMap.set(b.id, b));
      } catch (err) { console.error('Error fetching /bills/mine:', err); }

      for (const group of userGroups) {
        try {
          const gRes = await apiClient.get(`/bills/group/${group.id}`);
          (gRes.data || []).forEach((b: BillData) => billsMap.set(b.id, b));
        } catch (err) { console.error(`Error fetching bills for group ${group.id}:`, err); }
      }

      const fetchedBills = Array.from(billsMap.values());
      setAllBills(fetchedBills);

      // 3. Resolve member names used in bills
      const allUids = new Set<string>();
      fetchedBills.forEach(b => {
        allUids.add(b.paidBy);
        b.items?.forEach(item => item.sharedByUserIds?.forEach(uid => allUids.add(uid)));
      });
      const nameMap: Record<string, string> = {};
      for (const uid of allUids) {
        if (uid === user.id) { nameMap[uid] = 'You'; continue; }
        try {
          const res = await apiClient.get(`/users/${uid}`);
          nameMap[uid] = res.data.fullName || uid.slice(0, 6);
        } catch { nameMap[uid] = uid.slice(0, 6); }
      }
      setMemberNamesMap(nameMap);

      // 4. Activities
      try {
        const actRes = await apiClient.get('/activities/me');
        setActivities(actRes.data || []);
      } catch { setActivities([]); }

    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchInsights(); }, [fetchInsights]));

  // Listen for real-time app events to keep insights in sync
  useEffect(() => {
    const handleRefresh = () => {
      fetchInsights();
    };

    const sub1 = DeviceEventEmitter.addListener('bill:created', handleRefresh);
    const sub2 = DeviceEventEmitter.addListener('bill:updated', handleRefresh);
    const sub3 = DeviceEventEmitter.addListener('bill:deleted', handleRefresh);
    const sub4 = DeviceEventEmitter.addListener('settlement:recorded', handleRefresh);
    const sub5 = DeviceEventEmitter.addListener('group:created', handleRefresh);
    const sub6 = DeviceEventEmitter.addListener('group:updated', handleRefresh);
    const sub7 = DeviceEventEmitter.addListener('group:deleted', handleRefresh);

    return () => {
      sub1.remove();
      sub2.remove();
      sub3.remove();
      sub4.remove();
      sub5.remove();
      sub6.remove();
      sub7.remove();
    };
  }, [fetchInsights]);

  // ─── Computed / filtered data ───────────────────────────────────────
  const filteredBills = useMemo(() => {
    const now = new Date();
    return allBills.filter(bill => {
      // Period filter
      if (filterPeriod !== 'all') {
        const d = parseDate(bill.createdAt);
        if (filterPeriod === 'month') {
          if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
        } else if (filterPeriod === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (d < weekAgo) return false;
        }
      }
      // Group filter
      if (filterGroupId && bill.groupId !== filterGroupId) return false;
      return true;
    });
  }, [allBills, filterPeriod, filterGroupId]);

  // Authoritative converted INR amount for a bill (Requirement 1 & 2: insights aggregate exclusively in INR)
  const getBillInr = useCallback((bill: BillData): number => {
    if (bill.convertedAmount != null && bill.convertedAmount > 0) {
      return bill.convertedAmount;
    }
    const curr = (bill.currency || 'INR').toUpperCase().trim();
    if (curr === 'INR') {
      return bill.totalAmount || 0;
    }
    const rate = bill.exchangeRate || getApproximateRate(curr, 'INR');
    return Math.round((bill.totalAmount || 0) * rate * 100) / 100;
  }, []);

  const totalSpending = useMemo(() =>
    filteredBills.reduce((s, b) => s + getBillInr(b), 0)
  , [filteredBills, getBillInr]);

  const expenseCount = filteredBills.length;

  // Category breakdown aggregated exclusively in INR
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const bill of filteredBills) {
      const key = bill.category || 'Other';
      map[key] = (map[key] || 0) + getBillInr(bill);
    }
    return Object.entries(map)
      .map(([key, amount]) => ({ ...getCategoryByKey(key), amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredBills, getBillInr]);

  const topCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0] : null;

  // Member contribution aggregated in INR
  const memberContribution = useMemo(() => {
    if (!user) return [];
    const paid: Record<string, number> = {};
    const shared: Record<string, number> = {};
    for (const bill of filteredBills) {
      const inrAmt = getBillInr(bill);
      paid[bill.paidBy] = (paid[bill.paidBy] || 0) + inrAmt;
      const participants = new Set<string>();
      bill.items?.forEach(item => {
        const sharers = item.sharedByUserIds || [];
        sharers.forEach(uid => participants.add(uid));
      });
      const pCount = participants.size || 1;
      const perPerson = inrAmt / pCount;
      participants.forEach(uid => {
        shared[uid] = (shared[uid] || 0) + perPerson;
      });
    }
    const allIds = new Set([...Object.keys(paid), ...Object.keys(shared)]);
    return Array.from(allIds)
      .map(uid => ({
        userId: uid,
        name: memberNamesMap[uid] || (uid === user.id ? 'You' : uid.slice(0, 6)),
        totalPaid: paid[uid] || 0,
        totalShare: shared[uid] || 0,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid);
  }, [filteredBills, memberNamesMap, user, getBillInr]);

  // Largest expenses sorted by authoritative INR value
  const topExpenses = useMemo(() =>
    [...filteredBills].sort((a, b) => getBillInr(b) - getBillInr(a)).slice(0, 5)
  , [filteredBills, getBillInr]);

  // Spending trend (last 4 weeks or last 4 months) aggregated in INR
  const spendingTrend = useMemo(() => {
    if (allBills.length === 0) return [];
    const now = new Date();
    const buckets: { label: string; start: Date; end: Date; total: number }[] = [];

    if (filterPeriod === 'week') {
      // daily for 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        buckets.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), start: d, end, total: 0 });
      }
    } else {
      // weekly for 4 weeks
      for (let i = 3; i >= 0; i--) {
        const end = new Date(now);
        end.setDate(end.getDate() - i * 7);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        const label = `${start.getDate()}/${start.getMonth() + 1}`;
        buckets.push({ label, start, end, total: 0 });
      }
    }

    for (const bill of allBills) {
      const d = parseDate(bill.createdAt);
      for (const b of buckets) {
        if (d >= b.start && d <= b.end) { b.total += getBillInr(bill); break; }
      }
    }
    return buckets;
  }, [allBills, filterPeriod, getBillInr]);

  const maxTrend = Math.max(...spendingTrend.map(b => b.total), 1);

  // ─── Render helpers ─────────────────────────────────────────────────
  const periodLabel = filterPeriod === 'week' ? 'This week' : filterPeriod === 'month' ? 'This month' : 'All time';

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const heroStyle = [styles.hero, { paddingTop: insets.top + theme.spacing[16] }];

  return (
    <View style={styles.container}>
      {/* Hero Header */}
      <View style={heroStyle}>
        <View style={styles.heroCircle} />
        <View style={styles.heroContent}>
          <Text style={styles.heroTitle}>Insights</Text>
          <Text style={styles.heroSubtitle}>{periodLabel} · {expenseCount} expense{expenseCount !== 1 ? 's' : ''}</Text>
        </View>
        <ZigzagEdge />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* ─── Filter Row ──────────────────────────────────────────── */}
        <View style={styles.filterSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {/* Period filters */}
            {(['week', 'month', 'all'] as FilterPeriod[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.filterChip, filterPeriod === p && styles.filterChipActive]}
                onPress={() => setFilterPeriod(p)}>
                <Text style={[styles.filterChipText, filterPeriod === p && styles.filterChipTextActive]}>
                  {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
                </Text>
              </TouchableOpacity>
            ))}
            {/* Group filter */}
            <TouchableOpacity
              style={[styles.filterChip, filterGroupId === null && styles.filterChipActive, { marginLeft: 8 }]}
              onPress={() => setFilterGroupId(null)}>
              <Text style={[styles.filterChipText, filterGroupId === null && styles.filterChipTextActive]}>All Groups</Text>
            </TouchableOpacity>
            {groups.map(g => (
              <TouchableOpacity
                key={g.id}
                style={[styles.filterChip, filterGroupId === g.id && styles.filterChipActive]}
                onPress={() => setFilterGroupId(g.id)}>
                <Text style={[styles.filterChipText, filterGroupId === g.id && styles.filterChipTextActive]}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ─── Tab Switcher ──────────────────────────────────────── */}
        <View style={styles.tabRow}>
          {(['overview', 'categories', 'members'] as InsightTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabBtnText, activeTab === tab && styles.tabBtnTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─── OVERVIEW TAB ──────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <>
            {/* Total Spending Card */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{periodLabel}</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryAmount}>₹{totalSpending.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</Text>
                {totalSpending > 0 && (
                  <View style={styles.trendBadge}>
                    <TrendingUp size={14} color={theme.colors.success} />
                    <Text style={styles.trendText}>{expenseCount} bills</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Quick Stats Row */}
            <View style={styles.quickStatsRow}>
              {topCategory && (
                <View style={[styles.quickStatCard, { flex: 1 }]}>
                  <Text style={styles.quickStatEmoji}>{topCategory.emoji}</Text>
                  <Text style={styles.quickStatLabel}>Top Category</Text>
                  <Text style={styles.quickStatValue}>{topCategory.label}</Text>
                  <Text style={styles.quickStatSub}>₹{topCategory.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              )}
              <View style={[styles.quickStatCard, { flex: 1 }]}>
                <Text style={styles.quickStatEmoji}>📊</Text>
                <Text style={styles.quickStatLabel}>Avg / Expense</Text>
                <Text style={styles.quickStatValue}>
                  ₹{expenseCount > 0 ? Math.round(totalSpending / expenseCount).toLocaleString() : 0}
                </Text>
                <Text style={styles.quickStatSub}>{expenseCount} total</Text>
              </View>
            </View>

            {/* Spending Trend */}
            {spendingTrend.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Spending Trend</Text>
                <View style={styles.trendCard}>
                  <View style={styles.trendBarsRow}>
                    {spendingTrend.map((bucket, i) => {
                      const pct = Math.max((bucket.total / maxTrend) * 100, 4);
                      return (
                        <View key={i} style={styles.trendBarCol}>
                          <Text style={styles.trendBarAmount}>
                            {bucket.total > 0 ? `₹${Math.round(bucket.total).toLocaleString()}` : ''}
                          </Text>
                          <View style={styles.trendBarTrack}>
                            <View style={[styles.trendBarFill, { height: `${pct}%` }]} />
                          </View>
                          <Text style={styles.trendBarLabel}>{bucket.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            )}

            {/* Largest Expenses */}
            {topExpenses.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Largest Expenses</Text>
                <View style={styles.listCard}>
                  {topExpenses.map((bill, idx) => {
                    const cat = getCategoryByKey(bill.category);
                    const isForeign = bill.currency && bill.currency.toUpperCase().trim() !== 'INR';
                    const inrAmt = getBillInr(bill);
                    return (
                      <View key={bill.id} style={[styles.listRow, idx < topExpenses.length - 1 && styles.listRowBorder]}>
                        <View style={[styles.listRowIcon, { backgroundColor: cat.tint }]}>
                          <Text style={{ fontSize: 16 }}>{cat.emoji}</Text>
                        </View>
                        <View style={styles.listRowInfo}>
                          <Text style={styles.listRowTitle} numberOfLines={1}>{bill.title}</Text>
                          <Text style={styles.listRowSub}>
                            {groupNamesMap[bill.groupId || ''] || 'Personal'} · {formatDate(bill.createdAt)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.listRowAmount}>
                            {isForeign
                              ? formatMoney(bill.totalAmount, bill.currency, true)
                              : `₹${inrAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </Text>
                          {isForeign && (
                            <Text style={styles.listRowConverted}>
                              ≈ ₹{inrAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}

        {/* ─── CATEGORIES TAB ────────────────────────────────────── */}
        {activeTab === 'categories' && (
          <>
            {categoryBreakdown.length === 0 ? (
              <View style={styles.emptyContainer}><Text style={styles.emptyText}>No expenses in this period</Text></View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Category Breakdown</Text>
                <View style={styles.listCard}>
                  {categoryBreakdown.map((cat, idx) => {
                    const pct = totalSpending > 0 ? (cat.amount / totalSpending) * 100 : 0;
                    return (
                      <View key={cat.key}>
                        <View style={[styles.categoryRow, idx < categoryBreakdown.length - 1 && styles.listRowBorder]}>
                          <View style={styles.categoryLeft}>
                            <View style={[styles.listRowIcon, { backgroundColor: cat.tint }]}>
                              <Text style={{ fontSize: 16 }}>{cat.emoji}</Text>
                            </View>
                            <View>
                              <Text style={styles.categoryName}>{cat.label}</Text>
                              <Text style={styles.categorySub}>{pct.toFixed(1)}% of total</Text>
                            </View>
                          </View>
                          <Text style={styles.categoryAmount}>₹{cat.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                        </View>
                        <View style={styles.categoryBarTrack}>
                          <View style={[styles.categoryBarFill, { width: `${pct}%`, backgroundColor: cat.color }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}

        {/* ─── MEMBERS TAB ───────────────────────────────────────── */}
        {activeTab === 'members' && (
          <>
            {memberContribution.length === 0 ? (
              <View style={styles.emptyContainer}><Text style={styles.emptyText}>No expenses in this period</Text></View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Member Contribution</Text>
                <View style={styles.listCard}>
                  {memberContribution.map((m, idx) => {
                    const maxPaid = Math.max(...memberContribution.map(x => x.totalPaid), 1);
                    const pct = (m.totalPaid / maxPaid) * 100;
                    const net = m.totalPaid - m.totalShare;
                    return (
                      <View key={m.userId} style={[styles.memberRow, idx < memberContribution.length - 1 && styles.listRowBorder]}>
                        <View style={styles.memberTop}>
                          <View style={styles.memberLeft}>
                            <View style={[styles.memberAvatar, { backgroundColor: m.userId === user?.id ? theme.colors.primary : theme.colors.success }]}>
                              <Text style={styles.memberAvatarText}>{m.name.charAt(0)}</Text>
                            </View>
                            <View>
                              <Text style={styles.memberName}>{m.name}</Text>
                              <Text style={styles.memberSub}>
                                Paid ₹{m.totalPaid.toLocaleString(undefined, { maximumFractionDigits: 0 })} · Share ₹{m.totalShare.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </Text>
                            </View>
                          </View>
                          <View style={[styles.memberNetBadge, net >= 0 ? styles.netPositive : styles.netNegative]}>
                            {net >= 0 ? (
                              <ArrowUpRight size={12} color={theme.colors.success} />
                            ) : (
                              <ArrowDownRight size={12} color={theme.colors.danger} />
                            )}
                            <Text style={[styles.memberNetText, net >= 0 ? styles.netTextPos : styles.netTextNeg]}>
                              ₹{Math.abs(net).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.memberBarTrack}>
                          <View style={[styles.memberBarFill, { width: `${pct}%`, backgroundColor: m.userId === user?.id ? theme.colors.primary : theme.colors.success }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}

        {/* ─── Recent Activity (always visible) ─────────────────── */}
        <View style={styles.section}>
          <View style={styles.activityHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {activities.length > 10 && (
              <TouchableOpacity onPress={() => setShowAllActivities(!showAllActivities)}>
                <Text style={styles.seeAllText}>{showAllActivities ? 'Show less' : 'See all'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {activities.length === 0 ? (
            <View style={styles.emptyContainer}><Text style={styles.emptyText}>No activity yet</Text></View>
          ) : (
            <View style={styles.listCard}>
              {(showAllActivities ? activities : activities.slice(0, 10)).map((activity) => (
                <ActivityRow key={activity.id} activity={activity} groupNames={groupNamesMap} />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ─── Activity Row ────────────────────────────────────────────────────
const parseActivityDisplay = (activity: ActivityItem, groupNames: Record<string, string>) => {
  const isSettlement = activity.type === 'EXPENSE_SETTLED';
  const isExpense = activity.type === 'EXPENSE_ADDED';

  let cleanTitle = activity.description || '';
  let originalAmountFormatted: string | null = null;
  let convertedAmountFormatted: string | null = null;

  // Pattern 1: Foreign with converted INR e.g. "($124.53 USD (≈ ₹11,207.70 INR))" or "($124.53 USD ≈ ₹11,207.70 INR)"
  const dualMatch = cleanTitle.match(/\(([$€£A-Za-z\s]+[\d,]+(?:\.\d{1,2})?(?:\s+[A-Za-z]{3})?)\s*(?:\(≈|≈)\s*([₹Rs.\s\d,]+(?:\.\d{1,2})?(?:\s+INR)?)\)?\)/i);
  if (dualMatch) {
    originalAmountFormatted = dualMatch[1].trim();
    convertedAmountFormatted = `≈ ${dualMatch[2].trim()}`;
    cleanTitle = cleanTitle.replace(dualMatch[0], '').trim();
  } else {
    // Pattern 2: Single amount in parens e.g. "(₹1,500.00 INR)" or "($100.00 USD)" or "(₹1500)"
    const singleMatch = cleanTitle.match(/\(([$€£₹A-Za-z\s]+[\d,]+(?:\.\d{1,2})?(?:\s+[A-Za-z]{3})?)\)/i);
    if (singleMatch) {
      originalAmountFormatted = singleMatch[1].trim();
      cleanTitle = cleanTitle.replace(singleMatch[0], '').trim();
    }
  }

  // Fallback to activity.amount if not found in text
  if (!originalAmountFormatted && activity.amount != null) {
    originalAmountFormatted = `₹${activity.amount.toLocaleString(undefined, { minimumFractionDigits: activity.amount % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }

  if (isSettlement) {
    cleanTitle = cleanTitle
      .replace(/[₹$€£]\s*[0-9,]+(?:\.[0-9]{1,2})?/, '')
      .replace(/\s+to\s+/, ' paid ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!cleanTitle || cleanTitle.toLowerCase() === 'you paid') {
      cleanTitle = activity.description;
    }
  }

  const groupName = activity.groupName || (activity.relatedGroupId ? groupNames[activity.relatedGroupId] : null);

  return { isSettlement, isExpense, cleanTitle, originalAmountFormatted, convertedAmountFormatted, groupName };
};

const ActivityRow: React.FC<{ activity: ActivityItem; groupNames: Record<string, string> }> = ({ activity, groupNames }) => {
  const config = activityIconConfig[activity.type] || { Icon: Receipt, color: theme.colors.textSecondary, bg: theme.colors.border, label: 'Activity' };
  const { Icon, color, bg, label } = config;
  const { isSettlement, isExpense, cleanTitle, originalAmountFormatted, convertedAmountFormatted, groupName } = parseActivityDisplay(activity, groupNames);

  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIconContainer, { backgroundColor: bg }]}>
        <Icon size={18} color={color} />
      </View>
      <View style={styles.activityContent}>
        <View style={styles.activityTitleRow}>
          <Text style={styles.activityDescription} numberOfLines={2}>{cleanTitle}</Text>
          {originalAmountFormatted && (
            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
              <Text style={[styles.activityAmount, isSettlement ? styles.activitySettlementAmount : styles.activityExpenseAmount]}>
                {originalAmountFormatted}
              </Text>
              {convertedAmountFormatted && (
                <Text style={styles.activityConvertedAmount}>
                  {convertedAmountFormatted}
                </Text>
              )}
            </View>
          )}
        </View>
        <View style={styles.activityMetaRow}>
          <View style={styles.activityMetaLeft}>
            {groupName ? <Text style={styles.activityGroupName} numberOfLines={1}>{groupName}</Text> : null}
            {groupName ? <Text style={styles.activityMetaDot}>·</Text> : null}
            <Text style={styles.activityTime}>{formatDate(activity.createdAt)}</Text>
          </View>
          <View style={[styles.activityTypeBadge, isSettlement ? styles.settlementTypeBadge : isExpense ? styles.expenseTypeBadge : styles.defaultTypeBadge]}>
            <Text style={[styles.activityTypeBadgeText, isSettlement ? styles.settlementTypeBadgeText : isExpense ? styles.expenseTypeBadgeText : styles.defaultTypeBadgeText]}>
              {label}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  hero: {
    backgroundColor: theme.colors.heroBg,
    paddingHorizontal: theme.spacing[24],
    position: 'relative',
    overflow: 'hidden',
  },
  heroCircle: {
    position: 'absolute', top: -100, right: -100, width: 300, height: 300,
    borderRadius: 150, backgroundColor: theme.colors.heroCircle,
  },
  heroContent: { paddingBottom: theme.spacing[24] },
  heroTitle: { fontSize: 22, fontWeight: '500', color: theme.colors.cream, fontFamily: theme.fontFamily.regular },
  heroSubtitle: { fontSize: 13, color: theme.colors.heroMuted, marginTop: 4, fontFamily: theme.fontFamily.regular },
  body: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },

  // Filters
  filterSection: { marginTop: theme.spacing[16], paddingHorizontal: theme.spacing[24] },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginRight: 8,
  },
  filterChipActive: { backgroundColor: theme.colors.heroBg, borderColor: theme.colors.heroBg },
  filterChipText: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular },
  filterChipTextActive: { color: theme.colors.cream },

  // Tabs
  tabRow: {
    flexDirection: 'row', marginHorizontal: theme.spacing[24], marginTop: theme.spacing[16],
    backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabBtnActive: { backgroundColor: theme.colors.heroBg },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular },
  tabBtnTextActive: { color: theme.colors.cream },

  // Summary Card
  summaryCard: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 14, padding: 16, marginHorizontal: theme.spacing[24], marginTop: theme.spacing[16],
  },
  summaryLabel: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: theme.spacing[8], fontFamily: theme.fontFamily.regular },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[12] },
  summaryAmount: { fontSize: 30, fontWeight: '500', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.mono },
  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4],
    backgroundColor: theme.colors.travelTint, paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[4], borderRadius: 12,
  },
  trendText: { fontSize: 12, fontWeight: '600', color: theme.colors.success, fontFamily: theme.fontFamily.regular },

  // Quick Stats
  quickStatsRow: {
    flexDirection: 'row', gap: 12, marginHorizontal: theme.spacing[24], marginTop: theme.spacing[12],
  },
  quickStatCard: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 14, padding: 14, alignItems: 'center',
  },
  quickStatEmoji: { fontSize: 22, marginBottom: 4 },
  quickStatLabel: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular },
  quickStatValue: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.regular, marginTop: 2 },
  quickStatSub: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.mono, marginTop: 2 },

  // Section
  section: { marginTop: theme.spacing[24], paddingHorizontal: theme.spacing[24] },
  sectionTitle: { fontSize: 15, fontWeight: '500', color: theme.colors.textPrimary, marginBottom: theme.spacing[12], fontFamily: theme.fontFamily.regular },

  // Trend chart
  trendCard: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 14, padding: 16,
  },
  trendBarsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130, gap: 8 },
  trendBarCol: { flex: 1, alignItems: 'center' },
  trendBarAmount: { fontSize: 9, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.mono, marginBottom: 4, textAlign: 'center' },
  trendBarTrack: { width: '100%', height: 80, backgroundColor: theme.colors.border, borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end' },
  trendBarFill: { width: '100%', backgroundColor: theme.colors.primary, borderRadius: 6 },
  trendBarLabel: { fontSize: 10, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular, marginTop: 4 },

  // List card (shared)
  listCard: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 14, paddingHorizontal: 14,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  listRowIcon: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  listRowInfo: { flex: 1 },
  listRowTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.regular },
  listRowSub: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular, marginTop: 2 },
  listRowAmount: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.mono },

  // Category breakdown
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 0 },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  categoryName: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.regular },
  categorySub: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular, marginTop: 1 },
  categoryAmount: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.mono },
  categoryBarTrack: { height: 6, backgroundColor: theme.colors.border, borderRadius: 3, marginBottom: 4, marginHorizontal: 0, overflow: 'hidden' },
  categoryBarFill: { height: '100%', borderRadius: 3 },

  // Members
  memberRow: { paddingVertical: 12 },
  memberTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memberLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  memberAvatarText: { fontSize: 14, fontWeight: '700', color: theme.colors.cream },
  memberName: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.regular },
  memberSub: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular, marginTop: 1 },
  memberNetBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  netPositive: { backgroundColor: '#E6F4EF' },
  netNegative: { backgroundColor: '#FEF2F2' },
  memberNetText: { fontSize: 12, fontWeight: '700', fontFamily: theme.fontFamily.mono },
  netTextPos: { color: theme.colors.success },
  netTextNeg: { color: theme.colors.danger },
  memberBarTrack: { height: 6, backgroundColor: theme.colors.border, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  memberBarFill: { height: '100%', borderRadius: 3 },

  // Activity
  emptyContainer: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 14, paddingVertical: theme.spacing[32], alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular },
  activityHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing[12] },
  seeAllText: { fontSize: 13, fontWeight: '600', color: theme.colors.primary, fontFamily: theme.fontFamily.regular },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[12],
    paddingVertical: theme.spacing[12], borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  activityIconContainer: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  activityContent: { flex: 1 },
  activityTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 },
  activityDescription: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, fontFamily: theme.fontFamily.regular },
  activityAmount: { fontSize: 14, fontWeight: '700', fontFamily: theme.fontFamily.mono },
  activitySettlementAmount: { color: theme.colors.success },
  activityExpenseAmount: { color: theme.colors.textPrimary },
  activityMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  activityMetaLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  activityGroupName: { fontSize: 12, fontWeight: '500', color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular, maxWidth: '55%' },
  activityMetaDot: { fontSize: 12, color: theme.colors.textSecondary },
  activityTime: { fontSize: 12, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.regular },
  listRowConverted: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.mono, marginTop: 2 },
  activityConvertedAmount: { fontSize: 11, color: theme.colors.textSecondary, fontFamily: theme.fontFamily.mono, marginTop: 2 },
  activityTypeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  activityTypeBadgeText: { fontSize: 10, fontWeight: '600' },
  settlementTypeBadge: { backgroundColor: 'rgba(34, 197, 94, 0.12)', borderColor: 'rgba(34, 197, 94, 0.25)' },
  settlementTypeBadgeText: { fontSize: 10, fontWeight: '700', color: theme.colors.success, letterSpacing: 0.3 },
  expenseTypeBadge: { backgroundColor: theme.colors.foodTint, borderColor: 'rgba(15, 76, 58, 0.15)' },
  expenseTypeBadgeText: { fontSize: 10, fontWeight: '700', color: theme.colors.primary, letterSpacing: 0.3 },
  defaultTypeBadge: { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
  defaultTypeBadgeText: { fontSize: 10, fontWeight: '600', color: theme.colors.textSecondary },
});
