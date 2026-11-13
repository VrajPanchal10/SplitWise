import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, RefreshControl, DeviceEventEmitter } from 'react-native';
import { ChevronLeft, ChevronDown, Receipt, UtensilsCrossed, Car, Film, CheckCircle2, BellRing } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { formatMoney, getCurrencySymbol } from '@/constants/currencies';
import { getCategoryByKey } from '@/constants/categories';

interface BillItem {
  name: string;
  price: number;
  sharedByUserIds: string[];
  customShares?: { [userId: string]: number };
}

interface Bill {
  id: string;
  title: string;
  totalAmount: number;
  currency?: string;
  baseCurrency?: string;
  exchangeRate?: number;
  exchangeRateDate?: string;
  convertedAmount?: number;
  groupId: string | null;
  paidBy: string;
  items: BillItem[];
  createdAt: string;
  category?: string;
}

interface FriendBalance {
  friendId: string;
  netBalance: number; // positive = friend owes you, negative = you owe friend
}

interface BillWithShare extends Bill {
  friendShare: number;
  direction: 'owe' | 'owed' | 'settled';
  shareAmount: number;
  convertedShareAmount: number;
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
 * by the number of UNIQUE participants in that item's sharedByUserIds,
 * or using customShares if defined.
 */
const calculateUserShare = (bill: Bill, userId: string): number => {
  if (!bill.items || bill.items.length === 0) return 0;

  let totalShare = 0;
  for (const item of bill.items) {
    if (!item) continue;
    if (item.customShares && item.customShares[userId] !== undefined) {
      totalShare += item.customShares[userId];
      continue;
    }

    if (!item.sharedByUserIds || item.sharedByUserIds.length === 0) continue;

    // De-duplicate sharedByUserIds to avoid inflating the split count
    const uniqueSharedBy = Array.from(new Set(item.sharedByUserIds));
    if (uniqueSharedBy.length === 0) continue;

    if (uniqueSharedBy.includes(userId)) {
      totalShare += (item.price || 0) / uniqueSharedBy.length;
    }
  }
  return totalShare;
};

const BillRow: React.FC<{ bill: BillWithShare; friendName: string }> = ({ bill, friendName }) => {
  const router = useRouter();
  const catConfig = getCategoryByKey(bill.category || 'other');
  const billCurrency = bill.currency || 'INR';
  const baseCurrency = bill.baseCurrency || 'INR';
  const isForeign = billCurrency !== baseCurrency && !!bill.exchangeRate && bill.exchangeRate !== 1;

  const getShareLabel = () => {
    const convertedShare = bill.convertedShareAmount ?? bill.shareAmount;
    const formattedConvertedShare = '₹' + convertedShare.toFixed(2);
    const foreignShareInfo = isForeign ? ` (${formatMoney(bill.shareAmount, billCurrency)})` : '';

    if (bill.direction === 'owe') {
      return `You owe ${formattedConvertedShare}${foreignShareInfo}`;
    }
    if (bill.direction === 'owed') {
      return `${friendName} owes ${formattedConvertedShare}${foreignShareInfo}`;
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
      onPress={() => {
        if (!bill.id) return;
        router.push({
          pathname: '/bill/[id]',
          params: { id: bill.id },
        });
      }}>
      <View style={[styles.billIconContainer, { backgroundColor: catConfig.tint }]}>
        <Text style={{ fontSize: 16 }}>{catConfig.emoji}</Text>
      </View>
      <View style={styles.billInfo}>
        <Text style={styles.billName} numberOfLines={1}>{bill.title}</Text>
        <Text style={styles.billDate}>{formatDate(bill.createdAt)}</Text>
        <Text style={[styles.billShare, { color: getShareColor() }]}>{getShareLabel()}</Text>
      </View>
      <View style={styles.billAmountContainer}>
        <Text style={styles.billAmount}>
          {formatMoney(bill.totalAmount, billCurrency, true)}
        </Text>
        {isForeign && (
          <Text style={styles.billConvertedAmount}>
            ≈ {formatMoney(bill.convertedAmount || (bill.totalAmount * (bill.exchangeRate || 1)), baseCurrency)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

export default function FriendDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rawId = params.id;
  const friendId = (Array.isArray(rawId) ? rawId[0] : (rawId as string)) || '';
  const rawName = params.name;
  const friendNameParam = (Array.isArray(rawName) ? rawName[0] : (rawName as string | undefined));
  const { user } = useAuth();

  const [friendName, setFriendName] = useState<string>(friendNameParam || 'Friend');
  const [netBalance, setNetBalance] = useState<number | null>(null);
  const [bills, setBills] = useState<BillWithShare[]>([]);
  const [paidSettlements, setPaidSettlements] = useState<any[]>([]);
  const [groupNames, setGroupNames] = useState<{ [id: string]: string }>({});
  const [isSettlementHistoryExpanded, setIsSettlementHistoryExpanded] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [settleModalVisible, setSettleModalVisible] = useState(false);
  const [lastSettledAmount, setLastSettledAmount] = useState<number | null>(null);

  const fetchFriendData = useCallback(async (isSilent = false) => {
    if (!friendId || !user) return;

    if (!isSilent && bills.length === 0) {
      setIsLoading(true);
    }

    try {
      // Parallelize all friend data requests
      const [userRes, balancesRes, groupsRes, settlementsRes, billsRes] = await Promise.all([
        !friendNameParam
          ? apiClient.get(`/users/${friendId}`).catch(err => {
              console.error('Error fetching friend name:', err);
              return { data: null };
            })
          : Promise.resolve({ data: null }),
        apiClient.get('/users/me/friend-balances').catch(err => {
          console.error('Error fetching friend balances:', err);
          return { data: [] };
        }),
        apiClient.get('/groups').catch(err => {
          console.error('Error fetching groups for friend screen:', err);
          return { data: [] };
        }),
        apiClient.get(`/settlements/friend/${friendId}`).catch(err => {
          console.error('Error fetching settlements with friend:', err);
          return { data: [] };
        }),
        apiClient.get(`/bills/with-friend/${friendId}`).catch(err => {
          console.error('Error fetching bills with friend:', err);
          return { data: [] };
        }),
      ]);

      if (userRes.data?.fullName) {
        setFriendName(userRes.data.fullName);
      }

      const balances: FriendBalance[] = balancesRes.data || [];
      const friendBalance = balances.find(
        (b) => (b.friendId === friendId || (b as any).friend_id === friendId)
      );
      const bal = friendBalance ? (friendBalance.netBalance ?? (friendBalance as any).net_balance ?? 0) : 0;
      setNetBalance(bal);

      const gMap: { [id: string]: string } = {};
      (groupsRes.data || []).forEach((g: any) => {
        gMap[g.id] = g.name;
      });
      setGroupNames(gMap);

      setPaidSettlements(settlementsRes.data || []);

      const billsData: Bill[] = Array.isArray(billsRes.data) ? billsRes.data : [];
      const billsWithShare: BillWithShare[] = billsData.map((bill) => {
        const friendShare = calculateUserShare(bill, friendId);
        const userShare = calculateUserShare(bill, user.id);

        let direction: 'owe' | 'owed' | 'settled';
        let shareAmount: number;

        if (bill.paidBy === user.id) {
          direction = friendShare > 0.005 ? 'owed' : 'settled';
          shareAmount = friendShare;
        } else if (bill.paidBy === friendId) {
          direction = userShare > 0.005 ? 'owe' : 'settled';
          shareAmount = userShare;
        } else {
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

        const rate = (bill.exchangeRate && bill.exchangeRate > 0) ? bill.exchangeRate : 1.0;
        const convertedShareAmount = Math.round(shareAmount * rate * 100) / 100;

        return { ...bill, friendShare, direction, shareAmount, convertedShareAmount };
      });

      setBills(billsWithShare);
    } catch (error) {
      console.error('Error fetching friend data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [friendId, user, friendNameParam, bills.length]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchFriendData(true);
    setIsRefreshing(false);
  }, [fetchFriendData]);

  // Sync on screen focus + periodic background sync (every 6s) while active
  useFocusEffect(
    useCallback(() => {
      fetchFriendData(true);

      const interval = setInterval(() => {
        fetchFriendData(true);
      }, 6000);

      return () => clearInterval(interval);
    }, [fetchFriendData])
  );

  // Listen for instant mutations from bill creation or settlements
  useEffect(() => {
    const billCreatedSub = DeviceEventEmitter.addListener('bill:created', () => {
      fetchFriendData(true);
    });
    const billUpdatedSub = DeviceEventEmitter.addListener('bill:updated', () => {
      fetchFriendData(true);
    });
    const settlementSub = DeviceEventEmitter.addListener('settlement:recorded', () => {
      fetchFriendData(true);
    });
    const billDeletedSub = DeviceEventEmitter.addListener('bill:deleted', () => {
      fetchFriendData(true);
    });

    return () => {
      billCreatedSub.remove();
      billUpdatedSub.remove();
      settlementSub.remove();
      billDeletedSub.remove();
    };
  }, [fetchFriendData]);

  const handleSettleUp = () => {
    if (netBalance === null || Math.abs(netBalance) <= 0.005) return;
    setSettleModalVisible(true);
  };

  const handleConfirmSettle = async () => {
    try {
      setIsSettling(true);
      const settledAmount = Math.abs(netBalance || 0);
      await apiClient.post(`/settlements/settle-with-friend/${friendId}`);
      setLastSettledAmount(settledAmount);
      setSettleModalVisible(false);
      // Immediately reflect 0 balance locally, emit settlement event, then revalidate with server
      setNetBalance(0);
      DeviceEventEmitter.emit('settlement:recorded', { friendId });
      await fetchFriendData(true);
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

  const isSettled = netBalance !== null && Math.abs(netBalance) <= 0.005;
  const contributingBills = bills.filter(
    (b) => b.direction === (netBalance && netBalance > 0 ? 'owed' : 'owe')
  );

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
          {isSettled ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle2 size={24} color={theme.colors.success} />
                <Text style={[styles.balanceAmount, { color: theme.colors.success }]}>SETTLED</Text>
              </View>
              <Text style={[styles.balanceAmount, { color: theme.colors.cream, fontSize: 24 }]}>₹0</Text>
              <Text style={styles.balanceLabel}>
                {lastSettledAmount !== null
                  ? `${friendName} has paid you ₹${lastSettledAmount.toFixed(2)}`
                  : 'All shared expenses are settled.'}
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.balanceLabel}>
                {netBalance !== null && netBalance > 0.005 ? 'Owes you' : 'You owe'}
              </Text>
              <Text
                style={[
                  styles.balanceAmount,
                  { color: netBalance !== null && netBalance > 0.005 ? theme.colors.success : theme.colors.danger },
                ]}>
                ₹{Math.abs(netBalance || 0).toFixed(2)}
              </Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        {!isSettled && (
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
                  <Text style={styles.settleButtonText}>Record Settlement</Text>
                </>
              )}
            </TouchableOpacity>
            {netBalance !== null && netBalance > 0.005 && (
              <TouchableOpacity
                style={styles.reminderButton}
                onPress={handleSendReminder}
                activeOpacity={0.7}>
                <BellRing size={18} color={theme.colors.cream} />
                <Text style={styles.reminderButtonText}>Send Reminder</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Main Body */}
      <FlatList
        data={bills}
        keyExtractor={(item) => item.id || Math.random().toString()}
        renderItem={({ item }) => <BillRow bill={item} friendName={friendName} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.billSeparator} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
        ListHeaderComponent={
          <View>
            {/* CURRENT BALANCE Card */}
            <View style={styles.currentBalanceCard}>
              <Text style={styles.currentBalanceHeader}>CURRENT BALANCE</Text>
              <Text style={styles.currentBalanceValue}>
                {isSettled
                  ? `You and ${friendName} are settled up`
                  : netBalance !== null && netBalance > 0.005
                  ? `${friendName} owes you ₹${netBalance.toFixed(2)}`
                  : `You owe ${friendName} ₹${Math.abs(netBalance || 0).toFixed(2)}`}
              </Text>
              <Text style={styles.currentBalanceSubtitle}>
                {isSettled
                  ? `No outstanding balances between you and ${friendName}.`
                  : 'Based on shared expenses in your groups.'}
              </Text>
            </View>

            {/* SETTLEMENT HISTORY (when present) */}
            {paidSettlements.length > 0 && (
              <View style={styles.settlementsSection}>
                <View style={styles.settlementsCard}>
                  <TouchableOpacity
                    style={styles.settlementsHeader}
                    onPress={() => setIsSettlementHistoryExpanded((prev) => !prev)}
                    activeOpacity={0.7}>
                    <View style={styles.settlementsHeaderLeft}>
                      <Text style={styles.settlementsTitle}>SETTLEMENT HISTORY</Text>
                      <Text style={styles.settlementsCount}>
                        {paidSettlements.length} {paidSettlements.length === 1 ? 'record' : 'records'}
                      </Text>
                    </View>
                    <ChevronDown
                      size={18}
                      color={theme.colors.textSecondary}
                      style={[styles.chevron, isSettlementHistoryExpanded && styles.chevronExpanded]}
                    />
                  </TouchableOpacity>

                  {isSettlementHistoryExpanded && (
                    <View style={styles.settlementsBody}>
                      {paidSettlements.map((ps: any, pIndex: number) => {
                        const fromName = ps.fromUserId === user?.id ? 'You' : friendName;
                        const toName = ps.toUserId === user?.id ? 'You' : friendName;
                        const groupLabel = ps.groupId && groupNames[ps.groupId] ? groupNames[ps.groupId] : null;

                        return (
                          <View key={ps.id || pIndex}>
                            <View style={styles.settlementRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.settlementText}>
                                  <Text style={styles.settlementPersonName}>{fromName}</Text> paid <Text style={styles.settlementPersonName}>{toName}</Text>
                                </Text>
                                <Text style={styles.settlementSubtext}>
                                  {ps.paidAt ? formatDateTime(ps.paidAt) : 'Settled'} · {groupLabel ? `${groupLabel} · ` : ''}Settlement
                                </Text>
                              </View>
                              <View style={styles.settledBadge}>
                                <CheckCircle2 size={13} color={theme.colors.success} style={{ marginRight: 4 }} />
                                <Text style={styles.settledBadgeText}>{formatMoney(ps.amount || 0, ps.currency || 'INR', true)}</Text>
                              </View>
                            </View>
                            {pIndex < paidSettlements.length - 1 && <View style={styles.settlementRowDivider} />}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* WHY? Section Header */}
            <View style={styles.whyHeader}>
              <Text style={styles.whyTitle}>WHY? (SHARED EXPENSES)</Text>
              {bills.length > 0 && (
                <Text style={styles.whyBadge}>
                  {bills.length} {bills.length === 1 ? 'expense' : 'expenses'}
                </Text>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Receipt size={40} color={theme.colors.textSecondary} />
            </View>
            <Text style={styles.emptyText}>No shared expenses yet</Text>
          </View>
        }
      />

      {/* Record Settlement Modal (Part 6) */}
      {netBalance !== null && (
        <Modal
          visible={settleModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSettleModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>RECORD SETTLEMENT</Text>
              
              <View style={styles.modalBody}>
                <Text style={styles.modalDirectionText}>
                  {netBalance < 0 ? `You pay ${friendName}` : `${friendName} pays you`}
                </Text>
                <Text
                  style={[
                    styles.modalAmountText,
                    { color: netBalance > 0 ? theme.colors.success : theme.colors.danger },
                  ]}>
                  ₹{Math.abs(netBalance).toFixed(2)}
                </Text>
                <Text style={styles.modalCurrentBalance}>
                  Current balance: {netBalance > 0 ? `${friendName} owes you` : `You owe ${friendName}`} ₹{Math.abs(netBalance).toFixed(2)}
                </Text>
              </View>

              {contributingBills.length > 0 ? (
                <View style={styles.contributingContainer}>
                  <Text style={styles.modalReduceLabel}>This will reduce:</Text>
                  {contributingBills.slice(0, 3).map((b) => {
                    const bCurr = b.currency || 'INR';
                    const isBForeign = bCurr.toUpperCase() !== 'INR';
                    const bInr = b.convertedShareAmount ?? (isBForeign ? Math.round(b.shareAmount * (b.exchangeRate || 1) * 100) / 100 : b.shareAmount);
                    return (
                      <View key={b.id} style={styles.modalBillRow}>
                        <Text style={styles.modalBillTitle} numberOfLines={1}>{b.title}</Text>
                        <Text style={styles.modalBillAmount}>
                          ₹{bInr.toFixed(2)}{isBForeign ? ` (${formatMoney(b.shareAmount, bCurr)})` : ''}
                        </Text>
                      </View>
                    );
                  })}
                  {contributingBills.length > 3 && (
                    <Text style={styles.modalMoreBills}>
                      +{contributingBills.length - 3} more shared expenses
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={styles.modalSubtitle}>
                  This payment will clear the current ₹{Math.abs(netBalance).toFixed(2)} balance created by shared expenses.
                </Text>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setSettleModalVisible(false)}>
                  <Text style={styles.modalCancelText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalConfirmButton,
                    { backgroundColor: netBalance > 0 ? theme.colors.success : theme.colors.primary },
                  ]}
                  onPress={handleConfirmSettle}>
                  {isSettling ? (
                    <ActivityIndicator size="small" color={theme.colors.cream} />
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
    paddingTop: theme.spacing[16],
    paddingBottom: theme.spacing[24],
  },
  currentBalanceCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    marginBottom: 20,
  },
  currentBalanceHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: theme.colors.textSecondary,
    marginBottom: 6,
    fontFamily: theme.fontFamily.regular,
  },
  currentBalanceValue: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 4,
    fontFamily: theme.fontFamily.regular,
  },
  currentBalanceSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  settlementsSection: {
    marginBottom: 20,
  },
  settlementsCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: theme.spacing[16],
  },
  settlementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settlementsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  settlementsTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  settlementsCount: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  settlementsBody: {
    marginTop: theme.spacing[12],
    paddingTop: theme.spacing[12],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[8],
    gap: theme.spacing[8],
  },
  settlementRowDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 4,
  },
  settlementText: {
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  settlementPersonName: {
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  settlementSubtext: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontFamily: theme.fontFamily.regular,
  },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  settledBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.success,
    fontFamily: theme.fontFamily.mono,
  },
  whyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[12],
  },
  whyTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  whyBadge: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    fontFamily: theme.fontFamily.regular,
  },
  contributingContainer: {
    width: '100%',
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginBottom: theme.spacing[24],
  },
  modalReduceLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 6,
    fontFamily: theme.fontFamily.regular,
  },
  modalBillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  modalBillTitle: {
    fontSize: 13,
    color: theme.colors.textPrimary,
    flex: 1,
    marginRight: 8,
    fontFamily: theme.fontFamily.regular,
  },
  modalBillAmount: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  modalMoreBills: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
    fontFamily: theme.fontFamily.regular,
  },
  modalCurrentBalance: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
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
  billAmountContainer: {
    alignItems: 'flex-end',
  },
  billConvertedAmount: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.mono,
    marginTop: 2,
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