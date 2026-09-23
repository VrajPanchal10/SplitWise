import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { Camera, Receipt, ArrowUpRight, ArrowDownLeft, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';

interface Group {
  id: string;
  name: string;
  members: number;
  balance: number;
  tint: string;
  color: string;
}

const StatCard: React.FC<{ title: string; amount: string; color: string; icon: React.ReactNode }> = ({
  title,
  amount,
  color,
  icon,
}) => (
  <View style={styles.statCard}>
    <View style={styles.statHeader}>
      {icon}
      <Text style={styles.statTitle}>{title}</Text>
    </View>
    <Text style={[styles.statAmount, { color }]}>{amount}</Text>
  </View>
);

const GroupCard: React.FC<{ group: Group }> = ({ group }) => {
  const router = useRouter();

  const getBalanceColor = (balance: number) => {
    if (balance > 0) return theme.colors.success;
    if (balance < 0) return theme.colors.danger;
    return theme.colors.textSecondary;
  };

  const getBalanceText = (balance: number) => {
    if (balance > 0) return `+₹${balance.toFixed(2)}`;
    if (balance < 0) return `-₹${Math.abs(balance).toFixed(2)}`;
    return 'Settled';
  };

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() =>
        router.push({
          pathname: '/group/[id]',
          params: { id: group.id, name: group.name },
        })
      }>
      <View style={[styles.cardAvatar, { backgroundColor: group.tint }]}>
        <Text style={[styles.cardAvatarText, { color: group.color }]}>
          {group.name.charAt(0)}
        </Text>
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>{group.name}</Text>
        <Text style={styles.cardMemberCount}>{group.members} members</Text>
      </View>
      <Text style={[styles.cardBalance, { color: getBalanceColor(group.balance) }]}>
        {getBalanceText(group.balance)}
      </Text>
    </TouchableOpacity>
  );
};

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [youOwe, setYouOwe] = useState(0);
  const [youAreOwed, setYouAreOwed] = useState(0);

  const groupColors = [
    { tint: theme.colors.foodTint, color: theme.colors.primary },
    { tint: theme.colors.travelTint, color: theme.colors.success },
    { tint: theme.colors.entertainmentTint, color: '#F59E0B' },
    { tint: '#F3E8FF', color: '#7C3AED' },
  ];

  const fetchData = useCallback(async () => {
    if (!user || authLoading) return;

    try {
      setIsLoading(true);

      // Fetch user's groups
      const groupsResponse = await apiClient.get('/groups');
      const userGroups = groupsResponse.data;

      let totalYouOwe = 0;
      let totalYouAreOwed = 0;

      // For each group, fetch settlements to compute the user's net balance
      const transformedGroups: Group[] = await Promise.all(
        userGroups.map(async (group: any, index: number) => {
          let groupBalance = 0;

          try {
            const settlementsResponse = await apiClient.get(`/bills/group/${group.id}/settlements`);
            const settlements = settlementsResponse.data;

            for (const settlement of settlements) {
              if (settlement.fromUserId === user.id) {
                totalYouOwe += settlement.amount;
                groupBalance -= settlement.amount;
              } else if (settlement.toUserId === user.id) {
                totalYouAreOwed += settlement.amount;
                groupBalance += settlement.amount;
              }
            }
          } catch (error) {
            console.error(`Error fetching settlements for group ${group.id}:`, error);
          }

          const colorScheme = groupColors[index % groupColors.length];
          return {
            id: group.id,
            name: group.name,
            members: group.memberIds?.length || 0,
            balance: groupBalance,
            tint: colorScheme.tint,
            color: colorScheme.color,
          };
        })
      );

      setGroups(transformedGroups);
      setYouOwe(totalYouOwe);
      setYouAreOwed(totalYouAreOwed);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, authLoading]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const overallBalance = youAreOwed - youOwe;

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (groups.length === 0) {
    const emptyHeroStyle = [
      styles.hero,
      { paddingTop: insets.top + theme.spacing[16] },
    ];

    return (
      <View style={styles.container}>
        {/* Hero Header */}
        <View style={emptyHeroStyle}>
          <View style={styles.heroCircle} />
          <View style={styles.heroTop}>
            <View style={styles.logoContainer}>
              <View style={styles.logoMark}>
                <Receipt size={16} color={theme.colors.cream} />
              </View>
              <Text style={styles.logoText}>SplitWise</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.avatar}>
              {user?.profilePictureUrl ? (
                <Image
                  key={user.profilePictureUrl}
                  source={{ uri: user.profilePictureUrl }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                  onError={(e) => console.log('[DEBUG] Avatar image failed to load:', e.nativeEvent?.error)}
                />
              ) : (
                <Text style={styles.avatarText}>{user?.fullName?.charAt(0) || 'U'}</Text>
              )}
            </TouchableOpacity>
          </View>
          <ZigzagEdge />
        </View>

        <View style={styles.emptyContainer}>
          <Receipt size={64} color={theme.colors.border} />
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptySubtitle}>Create a group to start splitting bills</Text>
          <TouchableOpacity
            style={styles.createGroupButton}
            onPress={() => router.push('/add-group')}>
            <Text style={styles.createGroupButtonText}>Create Group</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const heroStyle = [
    styles.hero,
    { paddingTop: insets.top + theme.spacing[16] },
  ];

  return (
    <View style={styles.container}>
      {/* Hero Header */}
      <View style={heroStyle}>
        {/* Decorative Circle */}
        <View style={styles.heroCircle} />

        {/* Top Row */}
        <View style={styles.heroTop}>
          <View style={styles.logoContainer}>
            <View style={styles.logoMark}>
              <Receipt size={16} color={theme.colors.cream} />
            </View>
            <Text style={styles.logoText}>SplitWise</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.avatar}>
            {user?.profilePictureUrl ? (
              <Image
                key={user.profilePictureUrl}
                source={{ uri: user.profilePictureUrl }}
                style={styles.avatarImage}
                resizeMode="cover"
                onError={(e) => console.log('[DEBUG] Avatar image failed to load:', e.nativeEvent?.error)}
              />
            ) : (
              <Text style={styles.avatarText}>{user?.fullName?.charAt(0) || 'U'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Balance Summary */}
        <View style={styles.heroBalance}>
          <Text style={styles.balanceLabel}>Overall balance</Text>
          <Text
            style={[
              styles.balanceAmount,
              { color: overallBalance >= 0 ? theme.colors.cream : theme.colors.danger },
            ]}>
            {overallBalance >= 0 ? '+' : ''}₹{Math.abs(overallBalance).toFixed(2)}
          </Text>
          <Text style={styles.balanceSubtitle}>
            {overallBalance >= 0 ? "You're owed money overall" : 'You owe money overall'}
          </Text>
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Body Content */}
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Stat Cards */}
        <View style={styles.statsRow}>
          <StatCard
            title="You owe"
            amount={`-₹${youOwe.toFixed(2)}`}
            color={theme.colors.danger}
            icon={<ArrowUpRight size={16} color={theme.colors.danger} />}
          />
          <StatCard
            title="You're owed"
            amount={`+₹${youAreOwed.toFixed(2)}`}
            color={theme.colors.success}
            icon={<ArrowDownLeft size={16} color={theme.colors.success} />}
          />
        </View>

        {/* Your Groups Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Groups</Text>
            <TouchableOpacity onPress={() => router.push('/add-group')}>
              <Plus size={18} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          {groups.map((group, index) => (
            <View key={group.id}>
              <GroupCard group={group} />
              {index < groups.length - 1 && <View style={styles.cardSeparator} />}
            </View>
          ))}
        </View>

        {/* Add Expense Button */}
        <TouchableOpacity style={styles.scanButton} onPress={() => router.push('/add-group')}>
          <Camera size={20} color={theme.colors.cream} />
          <Text style={styles.scanButtonText}>Create Group</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

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
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[24],
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  heroBalance: {
    paddingBottom: theme.spacing[24],
  },
  balanceLabel: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.mono,
    marginBottom: theme.spacing[4],
  },
  balanceSubtitle: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    fontFamily: theme.fontFamily.regular,
  },
  body: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing[12],
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 13,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[4],
    marginBottom: theme.spacing[8],
  },
  statTitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  statAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: theme.fontFamily.mono,
  },
  section: {
    marginTop: theme.spacing[24],
    paddingHorizontal: theme.spacing[24],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 14,
    gap: theme.spacing[12],
  },
  cardSeparator: {
    height: theme.spacing[8],
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardAvatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: theme.fontFamily.regular,
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  cardMemberCount: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  cardBalance: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.mono,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.primary,
    height: 52,
    borderRadius: 14,
    marginHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
    marginBottom: theme.spacing[24],
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  scanButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[24],
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginTop: theme.spacing[16],
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  emptySubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing[24],
    fontFamily: theme.fontFamily.regular,
  },
  createGroupButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[12],
    borderRadius: 12,
  },
  createGroupButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
});