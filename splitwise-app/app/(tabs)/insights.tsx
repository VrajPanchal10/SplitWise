import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Trophy, TrendingUp, TrendingDown, Users, Receipt, CheckCircle, Camera } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';

interface GroupSpending {
  name: string;
  amount: number;
  color: string;
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  relatedGroupId?: string | null;
  relatedBillId?: string | null;
  actorUserId?: string | null;
  createdAt: string;
}

/** Maps an activity type to its icon + tint color for the feed row. */
const activityIconConfig: Record<string, { Icon: any; color: string; bg: string }> = {
  GROUP_CREATED: { Icon: Users, color: theme.colors.primary, bg: theme.colors.foodTint },
  MEMBER_ADDED: { Icon: Users, color: theme.colors.success, bg: theme.colors.travelTint },
  EXPENSE_ADDED: { Icon: Receipt, color: theme.colors.primary, bg: theme.colors.foodTint },
  EXPENSE_SETTLED: { Icon: CheckCircle, color: theme.colors.success, bg: theme.colors.travelTint },
  PROFILE_PHOTO_CHANGED: { Icon: Camera, color: '#7C3AED', bg: '#F3E8FF' },
};

/** Simple relative-time formatting ("2h ago", "Yesterday", "3 days ago"). */
function formatRelativeTime(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

const groupColors = [
  theme.colors.primary,
  theme.colors.success,
  '#F59E0B',
  '#7C3AED',
  theme.colors.danger,
  '#06B6D4',
];

export default function InsightsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [groupSpending, setGroupSpending] = useState<GroupSpending[]>([]);
  const [mostActiveGroup, setMostActiveGroup] = useState<{ name: string; billCount: number } | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [showAllActivities, setShowAllActivities] = useState(false);

  const fetchInsights = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);

      // Fetch user's groups
      const groupsResponse = await apiClient.get('/groups');
      const userGroups = groupsResponse.data;

      if (userGroups.length === 0) {
        setMonthlyTotal(0);
        setGroupSpending([]);
        setMostActiveGroup(null);
        // Still fetch activities — the feed works even without groups
        // (e.g. PROFILE_PHOTO_CHANGED entries)
        try {
          const activitiesResponse = await apiClient.get('/activities/me');
          console.log('Activities response:', JSON.stringify(activitiesResponse.data));
          setActivities(activitiesResponse.data || []);
        } catch (activityError) {
          console.error('Error fetching activities:', activityError);
          setActivities([]);
        }
        return;
      }

      // Get current month date range
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const monthStart = new Date(currentYear, currentMonth, 1);
      const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

      let totalThisMonth = 0;
      const groupTotals: { [key: string]: number } = {};
      const groupBillCounts: { [key: string]: number } = {};
      let maxBillCount = 0;
      let mostActiveGroupName = '';

      // Fetch bills for each group
      for (let i = 0; i < userGroups.length; i++) {
        const group = userGroups[i] as any;
        const billsResponse = await apiClient.get(`/bills/group/${group.id}`);
        const bills = billsResponse.data;

        // Initialize group tracking
        if (!groupTotals[group.name]) {
          groupTotals[group.name] = 0;
          groupBillCounts[group.name] = 0;
        }

        // Process each bill
        for (const bill of bills) {
          const billDate = new Date(bill.createdAt);
          
          // Check if bill is from current month
          if (billDate >= monthStart && billDate <= monthEnd) {
            totalThisMonth += bill.totalAmount;
            groupTotals[group.name] += bill.totalAmount;
          }

          // Count bills per group (for most active)
          groupBillCounts[group.name] += 1;
          if (groupBillCounts[group.name] > maxBillCount) {
            maxBillCount = groupBillCounts[group.name];
            mostActiveGroupName = group.name;
          }
        }
      }

      // Transform group spending for display
      const spendingByGroup: GroupSpending[] = userGroups
        .filter((group: any) => groupTotals[group.name] > 0)
        .map((group: any, index: number) => ({
          name: group.name,
          amount: groupTotals[group.name],
          color: groupColors[index % groupColors.length],
        }))
        .sort((a: GroupSpending, b: GroupSpending) => b.amount - a.amount);

      setMonthlyTotal(totalThisMonth);
      setGroupSpending(spendingByGroup);
      setMostActiveGroup(
        maxBillCount > 0 ? { name: mostActiveGroupName, billCount: maxBillCount } : null
      );

      // Fetch recent activities for the feed section
      try {
        const activitiesResponse = await apiClient.get('/activities/me');
        console.log('Activities response:', JSON.stringify(activitiesResponse.data));
        setActivities(activitiesResponse.data || []);
      } catch (activityError) {
        console.error('Error fetching activities:', activityError);
        setActivities([]);
      }

     } catch (error) {
       console.error('Error fetching insights:', error);
     } finally {
       setIsLoading(false);
     }
   }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchInsights();
    }, [fetchInsights])
  );

  const maxAmount = groupSpending.length > 0 ? Math.max(...groupSpending.map((g: GroupSpending) => g.amount)) : 1;

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const heroStyle = [
    styles.hero,
    { paddingTop: insets.top + theme.spacing[16] }
  ];

  return (
    <View style={styles.container}>
      {/* Hero Header */}
      <View style={heroStyle}>
        {/* Decorative Circle */}
        <View style={styles.heroCircle} />

        {/* Hero Content */}
        <View style={styles.heroContent}>
          <Text style={styles.heroTitle}>Insights</Text>
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Body Content */}
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>This month</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryAmount}>₹{monthlyTotal.toLocaleString()}</Text>
            {monthlyTotal > 0 && (
              <View style={styles.trendBadge}>
                <TrendingUp size={14} color={theme.colors.success} />
                <Text style={styles.trendText}>Active</Text>
              </View>
            )}
          </View>
        </View>

        {/* Group Spending Breakdown */}
        {groupSpending.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by group</Text>
            {groupSpending.map((group: GroupSpending) => (
              <GroupSpendingBar key={group.name} group={group} maxAmount={maxAmount} />
            ))}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by group</Text>
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No spending this month</Text>
            </View>
          </View>
        )}

        {/* Most Active Group */}
        {mostActiveGroup && (
          <View style={styles.section}>
            <View style={styles.activeGroupCard}>
              <View style={styles.activeGroupInfo}>
                <Text style={styles.activeGroupLabel}>Most active group</Text>
                <Text style={styles.activeGroupName}>{mostActiveGroup.name}</Text>
                <Text style={styles.activeGroupSubtitle}>{mostActiveGroup.billCount} bills total</Text>
              </View>
              <View style={styles.trophyContainer}>
                <Trophy size={22} color={theme.colors.primary} />
              </View>
            </View>
          </View>
        )}

        {/* Recent Activity */}
        <View style={styles.section}>
          <View style={styles.activityHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {activities.length > 10 && (
              <TouchableOpacity onPress={() => setShowAllActivities(!showAllActivities)}>
                <Text style={styles.seeAllText}>
                  {showAllActivities ? 'Show less' : 'See all'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {activities.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No activity yet</Text>
            </View>
          ) : (
            <View style={styles.activityList}>
              {(showAllActivities ? activities : activities.slice(0, 10)).map((activity) => (
                <ActivityRow key={activity.id} activity={activity} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const ActivityRow: React.FC<{ activity: ActivityItem }> = ({ activity }) => {
  const config = activityIconConfig[activity.type] || {
    Icon: Receipt,
    color: theme.colors.textSecondary,
    bg: theme.colors.border,
  };
  const { Icon, color, bg } = config;

  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIconContainer, { backgroundColor: bg }]}>
        <Icon size={16} color={color} />
      </View>
      <View style={styles.activityContent}>
        <Text style={styles.activityDescription} numberOfLines={2}>
          {activity.description}
        </Text>
        <Text style={styles.activityTime}>{formatRelativeTime(activity.createdAt)}</Text>
      </View>
    </View>
  );
};

const GroupSpendingBar: React.FC<{ group: GroupSpending; maxAmount: number }> = ({ group, maxAmount }) => {
  const percentage = (group.amount / maxAmount) * 100;

  return (
    <View style={styles.categoryItem}>
      <View style={styles.categoryRow}>
        <Text style={styles.categoryName}>{group.name}</Text>
        <Text style={styles.categoryAmount}>₹{group.amount.toLocaleString()}</Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            {
              width: `${percentage}%`,
              backgroundColor: group.color,
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  hero: {
    backgroundColor: theme.colors.heroBg,
    paddingHorizontal: theme.spacing[24],
    position: 'relative',
    overflow: 'hidden',
  },
  heroCircle: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: theme.colors.heroCircle,
  },
  heroContent: {
    paddingBottom: theme.spacing[24],
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
  },
  body: {
    flex: 1,
  },
  summaryCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  summaryLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[12],
  },
  summaryAmount: {
    fontSize: 30,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[4],
    backgroundColor: theme.colors.travelTint,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[4],
    borderRadius: 12,
  },
  trendText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.success,
    fontFamily: theme.fontFamily.regular,
  },
  section: {
    marginTop: theme.spacing[24],
    paddingHorizontal: theme.spacing[24],
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  categoryItem: {
    marginBottom: theme.spacing[16],
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  categoryName: {
    fontSize: 13,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  categoryAmount: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  activeGroupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 14,
  },
  activeGroupInfo: {
    flex: 1,
  },
  activeGroupLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  activeGroupName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  activeGroupSubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  trophyContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.foodTint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  emptyContainer: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: theme.spacing[32],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  activityHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[16],
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.primary,
    fontFamily: theme.fontFamily.regular,
  },
  activityList: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[12],
    paddingVertical: theme.spacing[12],
  },
  activityIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
  },
  activityDescription: {
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
});
