import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Image } from 'react-native';
import { Users2, Search, UserPlus, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { theme } from '@/constants/theme';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';

interface Friend {
  id: string;
  name: string;
  email: string;
  avatarInitial: string;
  profilePictureUrl?: string;
}

interface FriendBalance {
  friendId: string;
  netBalance: number; // positive = owes you, negative = you owe
}

interface MergedFriend {
  id: string;
  name: string;
  avatarInitial: string;
  netBalance: number; // positive = owes you, negative = you owe
  color: string;
  profilePictureUrl?: string;
}

const colors = [
  theme.colors.primary,
  theme.colors.success,
  '#F59E0B',
  '#EF4444',
  '#3B82F6',
  '#10B981',
];

const getColorForIndex = (index: number) => colors[index % colors.length];

export default function FriendsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [balances, setBalances] = useState<FriendBalance[]>([]);
  const [mergedFriends, setMergedFriends] = useState<MergedFriend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch all friends (KEY FIX: this gets ALL friends, not just ones with balances)
  const fetchFriends = useCallback(async () => {
    if (!user) return;

    try {
      const response = await apiClient.get('/users/me/friends');
      console.log('Friends API response:', JSON.stringify(response.data));
      // Map backend response (fullName) to frontend interface (name)
      const mappedFriends: Friend[] = response.data.map((f: any) => ({
        id: f.id,
        name: f.fullName || f.name || '',
        email: f.email,
        avatarInitial: (f.fullName || f.name || 'U').charAt(0),
        profilePictureUrl: f.profilePictureUrl,
      }));
      setFriends(mappedFriends);
    } catch (error: any) {
      console.error('Error fetching friends:', error.message);
      console.error('Error response data:', error.response?.data, 'status:', error.response?.status);
    }
  }, [user]);

  // Fetch friend balances separately
  const fetchBalances = useCallback(async () => {
    if (!user) return;

    try {
      const response = await apiClient.get('/users/me/friend-balances');
      console.log('Balances API response:', JSON.stringify(response.data));
      setBalances(response.data);
    } catch (error: any) {
      console.error('Error fetching friend balances:', error.message);
      console.error('Error response data:', error.response?.data, 'status:', error.response?.status);
    }
  }, [user]);

  // Fetch both on mount and when screen comes into focus (auto-refresh after group delete/leave)
  useFocusEffect(
    useCallback(() => {
      const loadData = async () => {
        setIsLoading(true);
        await Promise.all([fetchFriends(), fetchBalances()]);
        setIsLoading(false);
      };
      loadData();
    }, [fetchFriends, fetchBalances])
  );

  // Compute merged list and overall summary
  useEffect(() => {
    // Build a map of friendId -> netBalance from balances
    const balanceMap = new Map<string, number>();
    balances.forEach((b) => {
      // Handle both possible field shapes: "friendId" or "friend_id"
      const fid = b.friendId ?? (b as any).friend_id;
      if (fid) {
        balanceMap.set(fid, b.netBalance ?? (b as any).net_balance ?? 0);
      }
    });

    // Show EVERY friend from the friends list, defaulting balance to 0
    const merged: MergedFriend[] = friends.map((friend, index) => ({
      id: friend.id,
      name: friend.name,
      avatarInitial: friend.avatarInitial || friend.name?.charAt(0) || 'U',
      netBalance: balanceMap.get(friend.id) || 0,
      color: getColorForIndex(index),
      profilePictureUrl: friend.profilePictureUrl,
    }));

    setMergedFriends(merged);
  }, [friends, balances]);

  // Filter friends based on search query (case-insensitive substring match)
  const filteredFriends = isSearching && searchQuery.trim()
    ? mergedFriends.filter((friend) =>
        friend.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : mergedFriends;

  // Calculate overall summary
  const overallBalance = mergedFriends.reduce((sum, friend) => sum + friend.netBalance, 0);

  let summaryText = "Overall, you're all settled up";
  if (overallBalance > 0) {
    summaryText = `Overall, you're owed ₹${overallBalance.toFixed(2)}`;
  } else if (overallBalance < 0) {
    summaryText = `Overall, you owe ₹${Math.abs(overallBalance).toFixed(2)}`;
  }

  let summaryColor: string = theme.colors.textSecondary;
  if (overallBalance > 0) {
    summaryColor = theme.colors.success;
  } else if (overallBalance < 0) {
    summaryColor = theme.colors.danger;
  }

  const toggleSearch = () => {
    setIsSearching(!isSearching);
    setSearchQuery('');
  };

  const closeSearch = () => {
    setIsSearching(false);
    setSearchQuery('');
  };

  // Loading state - early return
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Simple Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        {isSearching ? (
          <View style={styles.searchInputContainer}>
            <Search size={18} color={theme.colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search friends..."
              placeholderTextColor={theme.colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              returnKeyType="search"
            />
            <TouchableOpacity onPress={closeSearch}>
              <X size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity onPress={toggleSearch}>
                <Search size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Friends</Text>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity onPress={() => router.push('/manual-entry')}>
                <UserPlus size={24} color={theme.colors.primary} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Summary Line (hidden while searching) */}
      {!isSearching && (
        <View style={styles.summaryLine}>
          <Text style={[styles.summaryText, { color: summaryColor }]}>{summaryText}</Text>
        </View>
      )}

      {/* Friends List */}
      <FlatList
        data={filteredFriends}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FriendRow friend={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={
          isSearching ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconContainer}>
                <Search size={40} color={theme.colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>No friends found</Text>
              <Text style={styles.emptySubtitle}>Try a different search term</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconContainer}>
                <Users2 size={40} color={theme.colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptySubtitle}>Add friends to see balances</Text>
            </View>
          )
        }
      />

      {/* Floating Add Expense Button */}
      <View style={styles.fabContainer}>
        <TouchableOpacity onPress={() => router.push('/add-bill')}>
          <View style={styles.fabButton}>
            <Text style={styles.fabText}>Add expense</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Friend row component
const FriendRow: React.FC<{ friend: MergedFriend }> = ({ friend }) => {
  const router = useRouter();

  const getBalanceText = (balance: number) => {
    if (balance > 0) return `₹${balance.toFixed(2)}`;
    if (balance < 0) return `₹${Math.abs(balance).toFixed(2)}`;
    return 'Settled up';
  };

  const getBalanceStyle = (balance: number) => {
    if (balance > 0) return theme.colors.success;
    if (balance < 0) return theme.colors.danger;
    return theme.colors.textSecondary;
  };

  const getBalanceLabel = (balance: number) => {
    if (balance > 0) return 'owes you';
    if (balance < 0) return 'you owe';
    return '';
  };

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() =>
        router.push({
          pathname: '/friend/[id]',
          params: { id: friend.id, name: friend.name },
        })
      }>
      <View style={styles.avatarContainer}>
        <View style={[styles.avatar, { backgroundColor: friend.color }]}>
          {friend.profilePictureUrl ? (
            <Image
              key={friend.profilePictureUrl}
              source={{ uri: friend.profilePictureUrl }}
              style={styles.avatarImage}
              resizeMode="cover"
              onError={(e) => console.log('[DEBUG] Friend avatar failed to load:', e.nativeEvent?.error)}
            />
          ) : (
            <Text style={styles.avatarText}>{friend.avatarInitial}</Text>
          )}
        </View>
      </View>
      <View style={styles.friendNameContainer}>
        <Text style={styles.friendNameText}>{friend.name}</Text>
      </View>
      <View style={styles.balanceContainer}>
        <Text style={[styles.balanceText, { color: getBalanceStyle(friend.netBalance) }]}>
          {getBalanceLabel(friend.netBalance)} {getBalanceText(friend.netBalance)}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[8],
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    width: 32,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  headerRight: {
    width: 32,
    alignItems: 'flex-end',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
    padding: 0,
  },
  summaryLine: {
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[12],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[24],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 56,
  },
  avatarContainer: {
    marginRight: theme.spacing[12],
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.cream,
  },
  friendNameContainer: {
    flex: 1,
  },
  friendNameText: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.mono,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: theme.spacing[32],
    gap: theme.spacing[12],
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  emptySubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontFamily: theme.fontFamily.regular,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fabButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[12],
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  fabText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
});