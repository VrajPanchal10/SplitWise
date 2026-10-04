import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { ChevronLeft, Receipt, UtensilsCrossed, Car, Film, CheckCircle2, BellRing } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';

interface BillItem {
  name: string;
  price: number;
  sharedByUserIds: string[];
}

interface Bill {
  id: string;
  title: string;
  totalAmount: number;
  groupId: string | null;
  paidBy: string;
  items: BillItem[];
  createdAt: string;
}

interface FriendBalance {
  friendId: string;
  netBalance: number; // positive = friend owes you, negative = you owe friend
}

interface BillWithShare extends Bill {
  friendShare: number;
  direction: 'owe' | 'owed' | 'settled';
  shareAmount: number;
}

const getCategoryConfig = (category: string) => {
  switch (category) {
    case 'food':
      return { icon: UtensilsCrossed, tint: theme.colors.foodTint, color: theme.colors.primary };
    case 'travel':
      return { icon: Car, tint: theme.colors.travelTint, color: theme.colors.success };
    case 'entertainment':
      return { icon: Film, tint: theme.colors.entertainmentTint, color: '#B45309' };
    default:
      return { icon: Receipt, tint: theme.colors.border, color: theme.colors.textSecondary };
  }
};

/**
 * Calculates a user's share of a bill by summing each item's price divided
 * by the number of UNIQUE participants in that item's sharedByUserIds.
 */
const calculateUserShare = (bill: Bill, userId: string): number => {
  if (!bill.items || bill.items.length === 0) return 0;

  let totalShare = 0;
  for (const item of bill.items) {
    if (!item.sharedByUserIds || item.sharedByUserIds.length === 0) continue;

    // De-duplicate sharedByUserIds to avoid inflating the split count
    const uniqueSharedBy = Array.from(new Set(item.sharedByUserIds));
    if (uniqueSharedBy.length === 0) continue;

    if (uniqueSharedBy.includes(userId)) {
      totalShare += item.price / uniqueSharedBy.length;
    }
  }
  return totalShare;
};

const BillRow: React.FC<{ bill: BillWithShare; friendName: string }> = ({ bill, friendName }) => {
  const router = useRouter();
  const config = getCategoryConfig('food');
  const Icon = config.icon;

  const getShareLabel = () => {
    if (bill.direction === 'owe') {
      return `You owe ₹${bill.shareAmount.toFixed(2)}`;
    }
    if (bill.direction === 'owed') {
      return `${friendName} owes ₹${bill.shareAmount.toFixed(2)}`;
    }
    return 'Settled up';
  };

  const getShareColor = () => {
    if (bill.direction === 'owe') return theme.colors.danger;
    if (bill.direction === 'owed') return theme.colors.success;
    return theme.colors.textSecondary;
  };

  return (
    <TouchableOpacity
      style={styles.billItem}
      activeOpacity={0.7}
      onPress={() =>
        router.push({
          pathname: '/bill/[id]',
          params: { id: bill.id },
        })
      }>
      <View style={[styles.billIconContainer, { backgroundColor: config.tint }]}>
        <Icon size={18} color={config.color} />
      </View>
      <View style={styles.billInfo}>
        <Text style={styles.billName} numberOfLines={1}>{bill.title}</Text>
        <Text style={styles.billDate}>{new Date(bill.createdAt).toLocaleDateString()}</Text>
        <Text style={[styles.billShare, { color: getShareColor() }]}>{getShareLabel()}</Text>
      </View>
      <Text style={styles.billAmount}>₹{bill.totalAmount.toLocaleString()}</Text>
    </TouchableOpacity>
  );
};

export default function FriendDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const friendId = params.id as string;
  const friendNameParam = params.name as string | undefined;
  const { user } = useAuth();

  const [friendName, setFriendName] = useState<string>(friendNameParam || 'Friend');
  const [netBalance, setNetBalance] = useState<number | null>(null);
  const [bills, setBills] = useState<BillWithShare[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettling, setIsSettling] = useState(false);
  const [settleModalVisible, setSettleModalVisible] = useState(false);

  const fetchFriendData = useCallback(async () => {
    if (!friendId || !user) return;

    try {
      setIsLoading(true);

      // 1. Fetch friend's name if not passed via route params
      if (!friendNameParam) {
        try {
          const userResponse = await apiClient.get(`/users/${friendId}`);
          setFriendName(userResponse.data.fullName || 'Friend');
        } catch (error) {
          console.error('Error fetching friend name:', error);
        }
      }

      // 2. Fetch friend balances and filter for this specific friend
      try {
        const balancesResponse = await apiClient.get('/users/me/friend-balances');
        const balances: FriendBalance[] = balancesResponse.data;
        const friendBalance = balances.find(
          (b) => b.friendId === friendId || (b as any).friend_id === friendId
        );
        setNetBalance(friendBalance ? friendBalance.netBalance ?? (friendBalance as any).net_balance ?? 0 : 0);
      } catch (error) {
        console.error('Error fetching friend balances:', error);
        setNetBalance(0);
      }

      // 3. Fetch all bills shared with this friend
      const billsResponse = await apiClient.get(`/bills/with-friend/${friendId}`);
      const billsData: Bill[] = billsResponse.data;

      // 4. Compute each bill's friend share and direction
      const billsWithShare: BillWithShare[] = billsData.map((bill) => {
        const friendShare = calculateUserShare(bill, friendId);
        const userShare = calculateUserShare(bill, user.id);

        let direction: 'owe' | 'owed' | 'settled';
        let shareAmount: number;

        if (bill.paidBy === user.id) {
          // I paid — friend owes me their share
          direction = friendShare > 0.005 ? 'owed' : 'settled';
          shareAmount = friendShare;
        } else if (bill.paidBy === friendId) {
          // Friend paid — I owe them my share
          direction = userShare > 0.005 ? 'owe' : 'settled';
          shareAmount = userShare;
        } else {
          // Someone else paid — net between us
          const net = friendShare - userShare;
          if (Math.abs(net) <= 0.005) {
            direction = 'settled';
            shareAmount = 0;
          } else if (net > 0) {
            direction = 'owed';
            shareAmount = net;
          } else {
            direction = 'owe';
            shareAmount = Math.abs(net);
          }
        }

        return { ...bill, friendShare, direction, shareAmount };
      });

      setBills(billsWithShare);
    } catch (error) {
      console.error('Error fetching friend data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [friendId, user, friendNameParam]);

  useFocusEffect(
    useCallback(() => {
      fetchFriendData();
    }, [fetchFriendData])
  );

  const handleSettleUp = () => {
    if (netBalance === null || Math.abs(netBalance) <= 0.005) return;
    setSettleModalVisible(true);
  };

  const handleConfirmSettle = async () => {
    try {
      setIsSettling(true);
      await apiClient.post(`/settlements/settle-with-friend/${friendId}`);
      setSettleModalVisible(false);
      // Refresh data to reflect the new settled state
      fetchFriendData();
    } catch (error: any) {
      console.error('Error settling up:', error);
      Alert.alert(
        'Error',
        error.response?.data?.message || 'Failed to settle up. Please try again.'
      );
    } finally {
      setIsSettling(false);
    }
  };

  const handleSendReminder = () => {
    Alert.alert('Reminder sent', `Reminder sent to ${friendName}!`);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const getBalanceText = () => {
    if (netBalance === null) return 'Loading...';
    if (netBalance > 0.005) return `${friendName} → You`;
    if (netBalance < -0.005) return `You → ${friendName}`;
    return "All shared expenses are settled.";
  };

  const getBalanceColor = () => {
    if (netBalance === null) return theme.colors.cream;
    if (netBalance > 0.005) return theme.colors.success;
    if (netBalance < -0.005) return theme.colors.danger;
    return theme.colors.heroMuted;
  };

  return (
    <View style={styles.container}>
      {/* Hero Header */}
      <View style={styles.hero}>
        {/* Decorative Circle */}
        <View style={styles.heroCircle} />

        {/* Top Row */}
        <View style={styles.heroTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft size={28} color={theme.colors.cream} />
          </TouchableOpacity>
          <Text style={styles.heroTitle} numberOfLines={1}>{friendName}</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Balance Summary */}
        <View style={styles.heroBalance}>
          {netBalance !== null && Math.abs(netBalance) <= 0.005 ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle2 size={24} color={theme.colors.success} />
                <Text style={[styles.balanceAmount, { color: theme.colors.success }]}>Settled</Text>
              </View>
              <Text style={[styles.balanceAmount, { color: theme.colors.cream, fontSize: 20 }]}>₹0</Text>
              <Text style={styles.balanceLabel}>All shared expenses are settled.</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.balanceLabel}>{getBalanceText()}</Text>
              <Text style={[styles.balanceAmount, { color: getBalanceColor() }]}>
                {netBalance !== null ? `₹${Math.abs(netBalance).toFixed(2)}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        {netBalance !== null && Math.abs(netBalance) > 0.005 && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.settleButton, isSettling && styles.buttonDisabled]}
              onPress={handleSettleUp}
              disabled={isSettling}
              activeOpacity={0.7}>
              {isSettling ? (
                <ActivityIndicator size="small" color={theme.colors.heroBg} />
              ) : (
                <>
                  <CheckCircle2 size={18} color={theme.colors.heroBg} />
                  <Text style={styles.settleButtonText}>Settle Up</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reminderButton}
              onPress={handleSendReminder}
              activeOpacity={0.7}>
              <BellRing size={18} color={theme.colors.cream} />
              <Text style={styles.reminderButtonText}>Send Reminder</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Bills List */}
      {bills.length > 0 ? (
        <FlatList
          data={bills}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <BillRow bill={item} friendName={friendName} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.billSeparator} />}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>
              {netBalance !== null && Math.abs(netBalance) > 0.005
                ? netBalance > 0
                  ? `Why ${friendName} owes you`
                  : `Why you owe ${friendName}`
                : 'Shared expenses'}
            </Text>
          }
        />
      ) : (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Receipt size={40} color={theme.colors.textSecondary} />
          </View>
          <Text style={styles.emptyText}>No shared expenses yet</Text>
        </View>
      )}

      {/* Settle Up Modal */}
      {netBalance !== null && (
        <Modal
          visible={settleModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSettleModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Record settlement</Text>
              
              <View style={styles.modalBody}>
                <Text style={styles.modalDirectionText}>
                  {netBalance < 0 ? `You pay ${friendName}` : `${friendName} pays you`}
                </Text>
                <Text style={styles.modalAmountText}>₹{Math.abs(netBalance).toFixed(2)}</Text>
              </View>

              <Text style={styles.modalSubtitle}>
                This payment will clear the current ₹{Math.abs(netBalance).toFixed(2)} balance created by your shared expenses.
              </Text>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setSettleModalVisible(false)}>
                  <Text style={styles.modalCancelText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirmButton}
                  onPress={handleConfirmSettle}>
                  {isSettling ? (
                    <ActivityIndicator size="small" color={theme.colors.heroBg} />
                  ) : (
                    <Text style={styles.modalConfirmText}>
                      CONFIRM ₹{Math.abs(netBalance).toFixed(2)} {netBalance < 0 ? 'PAID' : 'RECEIVED'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
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
    paddingTop: theme.spacing[16],
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[24],
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    width: 40,
  },
  heroTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
    textAlign: 'center',
  },
  heroBalance: {
    paddingBottom: theme.spacing[16],
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing[12],
    paddingBottom: theme.spacing[24],
  },
  settleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.cream,
    height: 44,
    borderRadius: 12,
  },
  settleButtonText: {
    color: theme.colors.heroBg,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  reminderButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.heroMuted,
    height: 44,
    borderRadius: 12,
  },
  reminderButtonText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  balanceLabel: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  balanceAmount: {
    fontSize: 24,
    fontWeight: '500',
    fontFamily: theme.fontFamily.mono,
  },
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[24],
    paddingBottom: theme.spacing[24],
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  billItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: theme.spacing[12],
  },
  billSeparator: {
    height: theme.spacing[8],
  },
  billIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  billInfo: {
    flex: 1,
  },
  billName: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  billDate: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  billShare: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  billAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
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
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    width: '85%',
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: theme.spacing[24],
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
    marginBottom: theme.spacing[24],
    textAlign: 'center',
  },
  modalBody: {
    alignItems: 'center',
    marginBottom: theme.spacing[16],
    gap: theme.spacing[4],
  },
  modalDirectionText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  modalAmountText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  modalSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: theme.spacing[32],
    fontFamily: theme.fontFamily.regular,
  },
  modalActions: {
    gap: theme.spacing[12],
  },
  modalConfirmButton: {
    backgroundColor: theme.colors.success,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  modalCancelButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalCancelText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
});