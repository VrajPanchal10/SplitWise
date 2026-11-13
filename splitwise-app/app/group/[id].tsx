import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Alert, Image, TextInput, RefreshControl, DeviceEventEmitter } from 'react-native';
import { ChevronLeft, Settings, Plus, ChevronDown, Receipt, Trash2, LogOut } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import {
  SUPPORTED_CURRENCIES,
  getCurrencyConfig,
  getCurrencySymbol,
  formatMoney,
} from '@/constants/currencies';
import { getCategoryByKey } from '@/constants/categories';

interface Member {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl?: string;
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
  paidBy: string;
  createdAt: string;
  items: any[];
  category?: string;
}

interface SettlementItem {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  direction: 'owe' | 'owed' | 'other';
}

// Category config is now resolved dynamically from getCategoryByKey()

const BillItem: React.FC<{
  bill: Bill;
  memberNames: { [id: string]: string };
  currentUserId?: string;
  groupCurrency?: string;
}> = ({ bill, memberNames, currentUserId, groupCurrency = 'INR' }) => {
  const router = useRouter();
  const catConfig = getCategoryByKey(bill.category);

  const billCurrency = bill.currency || 'INR';
  const paidByName = bill.paidBy === currentUserId ? 'You' : (memberNames[bill.paidBy] || bill.paidBy);

  // Calculate unique participants and current user's share
  const uniqueParticipants = new Set<string>();
  let userShare = 0;
  let isParticipant = false;

  if (bill.items && bill.items.length > 0) {
    bill.items.forEach(item => {
      const itemSharers = item.sharedByUserIds ? Array.from(new Set(item.sharedByUserIds)) : [];
      itemSharers.forEach((uid: any) => uniqueParticipants.add(uid));

      if (currentUserId) {
        if (item.customShares && item.customShares[currentUserId] !== undefined) {
          userShare += item.customShares[currentUserId];
          isParticipant = true;
        } else if (itemSharers.includes(currentUserId)) {
          userShare += (item.price || 0) / (itemSharers.length || 1);
          isParticipant = true;
        }
      }
    });
  }

  const participantCount = uniqueParticipants.size;
  const participantText = participantCount === 1 ? '1 person' : `${participantCount} people`;
  const rate = bill.exchangeRate || 1;
  const isForeign = !!bill.currency && bill.currency.toUpperCase() !== 'INR';
  const convertedUserShare = Math.round(userShare * rate * 100) / 100;

  const shareText = isParticipant
    ? isForeign
      ? `Your share ${formatMoney(userShare, billCurrency)} (≈ ${formatMoney(convertedUserShare, 'INR')})`
      : `Your share ${formatMoney(userShare, billCurrency)}`
    : 'Not involved';

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
      <View style={[styles.billIconContainer, { backgroundColor: catConfig.tint }]}>
        <Text style={{ fontSize: 16 }}>{catConfig.emoji}</Text>
      </View>
      <View style={styles.billInfo}>
        <Text style={styles.billName}>{bill.title}</Text>
        <Text style={styles.billDate}>{formatDate(bill.createdAt)} · Paid by {paidByName}</Text>
        <Text style={styles.billShareText}>
          {participantText} · {shareText}
        </Text>
      </View>
      <View style={styles.billAmountContainer}>
        <Text style={styles.billAmount}>
          {formatMoney(bill.totalAmount, billCurrency, true)}
        </Text>
        {isForeign && (
          <Text style={styles.billConvertedAmount}>
            ≈ {formatMoney(bill.convertedAmount || (bill.totalAmount * rate), 'INR')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

export default function GroupDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupId = params.id as string;
  const groupName = params.name as string || 'Group';
  const { user } = useAuth();

  const [groupCurrency, setGroupCurrency] = useState<string>('INR');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberNames, setMemberNames] = useState<{ [id: string]: string }>({});
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [totalBills, setTotalBills] = useState(0);
  const [youOweTotal, setYouOweTotal] = useState(0);
  const [youAreOwedTotal, setYouAreOwedTotal] = useState(0);
  const [settlementItems, setSettlementItems] = useState<SettlementItem[]>([]);
  const [isSettlementsExpanded, setIsSettlementsExpanded] = useState(true);
  const [paidSettlements, setPaidSettlements] = useState<any[]>([]);
  const [isSettlementHistoryExpanded, setIsSettlementHistoryExpanded] = useState(true);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [isGroupCreator, setIsGroupCreator] = useState(false);

  // Settlement recording modal state
  const [settleModalVisible, setSettleModalVisible] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState<SettlementItem | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>('');
  const [isRecordingSettlement, setIsRecordingSettlement] = useState(false);

  const fetchGroupData = useCallback(async (isSilent = false) => {
    if (!groupId) return;

    // Only show full loading spinner on true initial load when no data exists yet
    if (!isSilent && bills.length === 0 && members.length === 0) {
      setIsLoading(true);
    }

    try {
      // Concurrently fetch all group information in parallel (eliminates 5x network waterfall)
      const [
        groupResponse,
        membersResponse,
        billsResponse,
        paidRes,
        settlementsResponse
      ] = await Promise.all([
        apiClient.get(`/groups/${groupId}`),
        apiClient.get(`/groups/${groupId}/members`),
        apiClient.get(`/bills/group/${groupId}`).catch(billsErr => {
          console.error('Error fetching group bills:', billsErr);
          return { data: [] };
        }),
        apiClient.get(`/settlements/group/${groupId}`).catch(paidErr => {
          console.error('Error fetching group settlement history:', paidErr);
          return { data: [] };
        }),
        user
          ? apiClient.get(`/bills/group/${groupId}/settlements`).catch(err => {
              console.error('Error fetching group settlements:', err);
              return { data: [] };
            })
          : Promise.resolve({ data: [] }),
      ]);

      const groupData = groupResponse.data;
      if (groupData?.defaultCurrency) {
        setGroupCurrency(groupData.defaultCurrency.toUpperCase().trim());
      }
      if (user && groupData?.createdBy) {
        setIsGroupCreator(groupData.createdBy === user.id);
      }

      const membersData: Member[] = membersResponse.data || [];
      setMembers(membersData);

      const memberNameMap: { [id: string]: string } = {};
      membersData.forEach((member: Member) => {
        memberNameMap[member.id] = member.fullName;
      });
      setMemberNames(memberNameMap);

      const billsData: Bill[] = billsResponse.data || [];
      setBills(billsData);

      const total = billsData.reduce((sum: number, bill: Bill) => {
        const inr = bill.convertedAmount != null ? bill.convertedAmount : (bill.totalAmount * (bill.exchangeRate || 1));
        return sum + inr;
      }, 0);
      setTotalBills(total);

      setPaidSettlements(paidRes.data || []);

      if (user) {
        const settlements = settlementsResponse.data || [];
        let totalOwe = 0;
        let totalOwed = 0;
        const items: SettlementItem[] = [];

        for (const settlement of settlements) {
          if (!settlement || settlement.fromUserId === settlement.toUserId) continue;

          const fromMember = membersData.find((m: Member) => m.id === settlement.fromUserId);
          const toMember = membersData.find((m: Member) => m.id === settlement.toUserId);
          const fromName = settlement.fromUserId === user.id ? 'You' : (fromMember?.fullName || settlement.fromUserId);
          const toName = settlement.toUserId === user.id ? 'You' : (toMember?.fullName || settlement.toUserId);

          if (settlement.fromUserId === user.id) {
            totalOwe += settlement.amount;
            items.push({
              id: `${settlement.fromUserId}-${settlement.toUserId}`,
              fromId: settlement.fromUserId,
              fromName,
              toId: settlement.toUserId,
              toName,
              amount: settlement.amount,
              direction: 'owe',
            });
          } else if (settlement.toUserId === user.id) {
            totalOwed += settlement.amount;
            items.push({
              id: `${settlement.fromUserId}-${settlement.toUserId}`,
              fromId: settlement.fromUserId,
              fromName,
              toId: settlement.toUserId,
              toName,
              amount: settlement.amount,
              direction: 'owed',
            });
          } else {
            items.push({
              id: `${settlement.fromUserId}-${settlement.toUserId}`,
              fromId: settlement.fromUserId,
              fromName,
              toId: settlement.toUserId,
              toName,
              amount: settlement.amount,
              direction: 'other',
            });
          }
        }

        items.sort((a, b) => {
          const score = (it: SettlementItem) => (it.direction === 'owed' ? 0 : it.direction === 'owe' ? 1 : 2);
          return score(a) - score(b);
        });

        setYouOweTotal(totalOwe);
        setYouAreOwedTotal(totalOwed);
        setSettlementItems(items);
        setUserBalance(totalOwed - totalOwe);
      }
    } catch (error) {
      console.error('Error fetching group data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [groupId, user, bills.length, members.length]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchGroupData(true);
    setIsRefreshing(false);
  }, [fetchGroupData]);

  // Sync on screen focus + active background polling every 5s for real-time synchronization across group members
  useFocusEffect(
    useCallback(() => {
      fetchGroupData(true);

      const syncInterval = setInterval(() => {
        fetchGroupData(true);
      }, 5000);

      return () => clearInterval(syncInterval);
    }, [fetchGroupData])
  );

  // Instant local updates via DeviceEventEmitter for this group
  useEffect(() => {
    const billCreatedSub = DeviceEventEmitter.addListener('bill:created', (payload: any) => {
      if (payload?.groupId === groupId) {
        if (payload.bill) {
          setBills(prev => [payload.bill, ...prev.filter(b => b.id !== payload.bill.id)]);
          const inr = payload.bill.convertedAmount != null
            ? payload.bill.convertedAmount
            : ((payload.bill.totalAmount || 0) * (payload.bill.exchangeRate || 1));
          setTotalBills(prev => prev + inr);
        }
        fetchGroupData(true);
      }
    });

    const billUpdatedSub = DeviceEventEmitter.addListener('bill:updated', (payload: any) => {
      if (payload?.groupId === groupId) {
        fetchGroupData(true);
      }
    });

    const settlementSub = DeviceEventEmitter.addListener('settlement:recorded', (payload: any) => {
      if (payload?.groupId === groupId) {
        fetchGroupData(true);
      }
    });

    const billDeletedSub = DeviceEventEmitter.addListener('bill:deleted', (payload: any) => {
      if (payload?.groupId === groupId) {
        if (payload?.billId) {
          setBills(prev => prev.filter(b => b.id !== payload.billId));
        }
        fetchGroupData(true);
      }
    });

    return () => {
      billCreatedSub.remove();
      billUpdatedSub.remove();
      settlementSub.remove();
      billDeletedSub.remove();
    };
  }, [groupId, fetchGroupData]);

  const handleOpenSettle = (item: SettlementItem) => {
    setSelectedDebt(item);
    setSettleAmount(item.amount.toFixed(2));
    setSettleModalVisible(true);
  };

  const handleConfirmSettlement = async () => {
    if (!selectedDebt) return;
    const parsedAmount = parseFloat(settleAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid settlement amount greater than 0.');
      return;
    }
    if (parsedAmount > selectedDebt.amount + 0.01) {
      Alert.alert(
        'Amount Exceeded',
        `Entered amount (${formatMoney(parsedAmount, 'INR')}) exceeds outstanding debt (${formatMoney(selectedDebt.amount, 'INR')}).`
      );
      return;
    }

    // Save snapshot for rollback if needed
    const prevDebts = [...settlementItems];
    const prevPaid = [...paidSettlements];
    const prevYouOwe = youOweTotal;
    const prevYouAreOwed = youAreOwedTotal;
    const prevBalance = userBalance;

    // Optimistically update UI immediately
    const updatedDebts = settlementItems
      .map(item => {
        if (item.id === selectedDebt.id) {
          const remaining = item.amount - parsedAmount;
          return remaining > 0.01 ? { ...item, amount: remaining } : null;
        }
        return item;
      })
      .filter(Boolean) as SettlementItem[];
    setSettlementItems(updatedDebts);

    if (selectedDebt.direction === 'owe') {
      setYouOweTotal(prev => Math.max(0, prev - parsedAmount));
      setUserBalance(prev => prev + parsedAmount);
    } else if (selectedDebt.direction === 'owed') {
      setYouAreOwedTotal(prev => Math.max(0, prev - parsedAmount));
      setUserBalance(prev => prev - parsedAmount);
    }

    const optimisticRecord = {
      id: `temp-${Date.now()}`,
      groupId,
      fromUserId: selectedDebt.fromId,
      toUserId: selectedDebt.toId,
      amount: parsedAmount,
      currency: 'INR',
      status: 'PAID',
      paidAt: new Date().toISOString(),
    };
    setPaidSettlements(prev => [optimisticRecord, ...prev]);

    setSettleModalVisible(false);

    try {
      setIsRecordingSettlement(true);
      await apiClient.post('/settlements', {
        groupId,
        fromUserId: selectedDebt.fromId,
        toUserId: selectedDebt.toId,
        amount: parsedAmount,
        currency: 'INR',
      });

      DeviceEventEmitter.emit('settlement:recorded', { groupId });
      // Fetch authoritative updated group state silently
      await fetchGroupData(true);
    } catch (error: any) {
      console.error('Error recording settlement:', error);
      // Rollback to authoritative snapshot
      setSettlementItems(prevDebts);
      setPaidSettlements(prevPaid);
      setYouOweTotal(prevYouOwe);
      setYouAreOwedTotal(prevYouAreOwed);
      setUserBalance(prevBalance);
      Alert.alert('Settlement Failed', error.response?.data?.message || 'Could not record settlement. Please try again.');
    } finally {
      setIsRecordingSettlement(false);
      setSelectedDebt(null);
    }
  };

  const handleAddBill = () => {
    router.push({
      pathname: '/add-bill',
      params: { groupId }
    });
  };

  const handleDeleteGroup = () => {
    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete "${groupName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/groups/${groupId}`);
              DeviceEventEmitter.emit('group:deleted', { groupId });
              router.replace('/(tabs)/groups');
            } catch (error: any) {
              console.error('Error deleting group:', error);
              Alert.alert('Error', error.response?.data?.message || 'Failed to delete group');
            }
          },
        },
      ]
    );
  };

  const handleLeaveGroup = () => {
    if (!user) return;
    Alert.alert(
      'Leave Group',
      `Are you sure you want to leave "${groupName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/groups/${groupId}/members/${user.id}`);
              DeviceEventEmitter.emit('group:deleted', { groupId });
              router.replace('/(tabs)/groups');
            } catch (error: any) {
              console.error('Error leaving group:', error);
              Alert.alert('Error', error.response?.data?.message || 'Failed to leave group');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

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
          <Text style={styles.heroTitle}>{groupName}</Text>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => setSettingsModalVisible(true)}>
            <Settings size={22} color={theme.colors.cream} />
          </TouchableOpacity>
        </View>

        {/* Members Row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.membersRow}>
            {members.map((member) => (
              <View key={member.id} style={styles.memberItem}>
                <View style={[styles.memberAvatar, { backgroundColor: theme.colors.primary }]}>
                  {member.profilePictureUrl ? (
                    <Image
                      key={member.profilePictureUrl}
                      source={{ uri: member.profilePictureUrl }}
                      style={styles.memberAvatarImage}
                      resizeMode="cover"
                      onError={(e) => console.log('[DEBUG] Member avatar failed to load:', e.nativeEvent?.error)}
                    />
                  ) : (
                    <Text style={styles.memberAvatarText}>{member.fullName.charAt(0)}</Text>
                  )}
                </View>
                <Text style={styles.memberName}>{member.fullName}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Member Count */}
        <Text style={styles.memberCountText}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </Text>

        {/* Balance Summary */}
        <View style={styles.heroBalance}>
          {userBalance > 0.005 ? (
            <>
              <Text style={styles.balanceLabel}>You should receive</Text>
              <Text style={[styles.balanceAmount, { color: theme.colors.success }]}>
                {formatMoney(userBalance, 'INR', true)}
              </Text>
            </>
          ) : userBalance < -0.005 ? (
            <>
              <Text style={styles.balanceLabel}>You owe</Text>
              <Text style={[styles.balanceAmount, { color: theme.colors.danger }]}>
                {formatMoney(Math.abs(userBalance), 'INR', true)}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.balanceLabel}>{"You're settled"}</Text>
              <Text style={[styles.balanceAmount, { color: theme.colors.success }]}>
                {formatMoney(0, 'INR', true)}
              </Text>
            </>
          )}
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* WHO OWES WHOM (expandable) */}
      <View style={styles.settlementsSection}>
        <View style={styles.settlementsCard}>
          <TouchableOpacity
            style={styles.settlementsHeader}
            onPress={() => setIsSettlementsExpanded(prev => !prev)}
            activeOpacity={0.7}>
            <View style={styles.settlementsHeaderLeft}>
              <Text style={styles.settlementsTitle}>WHO OWES WHOM</Text>
              {settlementItems.length > 0 && (
                <Text style={styles.settlementsCount}>
                  {settlementItems.length} {settlementItems.length === 1 ? 'debt' : 'debts'}
                </Text>
              )}
            </View>
            <ChevronDown
              size={18}
              color={theme.colors.textSecondary}
              style={[styles.chevron, isSettlementsExpanded && styles.chevronExpanded]}
            />
          </TouchableOpacity>

          {isSettlementsExpanded && (
            <View style={styles.settlementsBody}>
              {settlementItems.length === 0 ? (
                <Text style={styles.settlementsEmptyText}>
                  Everyone is settled up!
                </Text>
              ) : (
                settlementItems.map((item, index) => {
                  let textNode;
                  let amountStyle: any = styles.settlementOtherAmount;
                  if (item.direction === 'owed') {
                    amountStyle = styles.owedAmount;
                    textNode = (
                      <Text style={styles.settlementText}>
                        <Text style={styles.settlementPersonName}>{item.fromName}</Text> owes you
                      </Text>
                    );
                  } else if (item.direction === 'owe') {
                    amountStyle = styles.oweAmount;
                    textNode = (
                      <Text style={styles.settlementText}>
                        You owe <Text style={styles.settlementPersonName}>{item.toName}</Text>
                      </Text>
                    );
                  } else {
                    textNode = (
                      <Text style={styles.settlementText}>
                        <Text style={styles.settlementPersonName}>{item.fromName}</Text> owes <Text style={styles.settlementPersonName}>{item.toName}</Text>
                      </Text>
                    );
                  }

                  return (
                    <View key={`${item.fromId}-${item.toId}-${index}`}>
                      <View style={styles.settlementRow}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          {textNode}
                          <Text style={styles.settlementSubtext}>
                            Simplified debt from all group expenses
                          </Text>
                        </View>
                        <View style={styles.settlementRight}>
                          <Text style={[styles.settlementAmount, amountStyle]}>
                            {formatMoney(item.amount, 'INR', true)}
                          </Text>
                          {(item.direction === 'owe' || item.direction === 'owed') && (
                            <TouchableOpacity
                              style={styles.settleButton}
                              onPress={() => handleOpenSettle(item)}
                              activeOpacity={0.7}>
                              <Text style={styles.settleButtonText}>Settle</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      {index < settlementItems.length - 1 && <View style={styles.settlementRowDivider} />}
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>
      </View>

      {/* SETTLED PAYMENTS HISTORY (when present) */}
      {paidSettlements.length > 0 && (
        <View style={styles.settlementsSection}>
          <View style={styles.settlementsCard}>
            <TouchableOpacity
              style={styles.settlementsHeader}
              onPress={() => setIsSettlementHistoryExpanded(prev => !prev)}
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
                  const fromName = ps.fromUserId === user?.id ? 'You' : (memberNames[ps.fromUserId] || ps.fromUserId);
                  const toName = ps.toUserId === user?.id ? 'You' : (memberNames[ps.toUserId] || ps.toUserId);
                  return (
                    <View key={ps.id || pIndex}>
                      <View style={styles.settlementRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settlementText}>
                            <Text style={styles.settlementPersonName}>{fromName}</Text> paid <Text style={styles.settlementPersonName}>{toName}</Text>
                          </Text>
                          <Text style={styles.settlementSubtext}>
                            {ps.paidAt ? formatDateTime(ps.paidAt) : 'Settled'} · Settlement
                          </Text>
                        </View>
                        <View style={styles.settledBadge}>
                          <CheckCircle2 size={13} color={theme.colors.success} style={{ marginRight: 4 }} />
                          <Text style={styles.settledBadgeText}>
                            {formatMoney(ps.amount || 0, ps.currency || 'INR', true)}
                          </Text>
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

      {/* EXPENSES Section */}
      <View style={styles.expensesContainer}>
        <View style={styles.expensesHeader}>
          <Text style={styles.expensesTitle}>EXPENSES</Text>
          {bills.length > 0 && (
            <Text style={styles.expensesCount}>
              {bills.length} {bills.length === 1 ? 'expense' : 'expenses'}
            </Text>
          )}
        </View>

        {bills.length > 0 ? (
          <FlatList
            data={bills}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <BillItem
                bill={item}
                memberNames={memberNames}
                currentUserId={user?.id}
                groupCurrency={groupCurrency}
              />
            )}
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
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.emptyContainer}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                colors={[theme.colors.primary]}
                tintColor={theme.colors.primary}
              />
            }>
            <Text style={styles.emptyText}>No bills yet</Text>
          </ScrollView>
        )}
      </View>

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab} onPress={handleAddBill}>
        <Plus size={28} color={theme.colors.cream} />
      </TouchableOpacity>

      {/* Record Settlement Modal */}
      <Modal
        visible={settleModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSettleModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Record Settlement</Text>
            {selectedDebt && (
              <>
                <Text style={styles.modalSubtitle}>
                  {selectedDebt.fromName} pays {selectedDebt.toName}
                </Text>
                <View style={styles.amountInputRow}>
                  <Text style={styles.amountPrefix}>{getCurrencySymbol('INR')}</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={settleAmount}
                    onChangeText={setSettleAmount}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={theme.colors.textSecondary}
                    autoFocus
                  />
                </View>
                <Text style={styles.modalHint}>
                  Full debt: {formatMoney(selectedDebt.amount, 'INR', true)}. You can edit the amount to record a partial settlement.
                </Text>
                <View style={styles.modalActionButtons}>
                  <TouchableOpacity
                    style={[styles.modalActionBtn, styles.modalBtnCancel]}
                    onPress={() => setSettleModalVisible(false)}>
                    <Text style={styles.modalBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalActionBtn, styles.modalBtnConfirm]}
                    onPress={handleConfirmSettlement}
                    disabled={isRecordingSettlement}>
                    {isRecordingSettlement ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.modalBtnConfirmText}>Confirm</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal
        visible={settingsModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSettingsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Group Settings</Text>

            {isGroupCreator && (
              <TouchableOpacity
                style={[styles.modalOption, styles.modalOptionDanger]}
                onPress={() => {
                  setSettingsModalVisible(false);
                  handleDeleteGroup();
                }}>
                <Trash2 size={20} color={theme.colors.danger} />
                <Text style={[styles.modalOptionText, { color: theme.colors.danger }]}>Delete Group</Text>
              </TouchableOpacity>
            )}

            {!isGroupCreator && (
              <TouchableOpacity
                style={[styles.modalOption, styles.modalOptionDanger]}
                onPress={() => {
                  setSettingsModalVisible(false);
                  handleLeaveGroup();
                }}>
                <LogOut size={20} color={theme.colors.danger} />
                <Text style={[styles.modalOptionText, { color: theme.colors.danger }]}>Leave Group</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => setSettingsModalVisible(false)}>
              <Text style={styles.modalOptionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  heroTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
  },
  settingsButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  membersRow: {
    flexDirection: 'row',
    gap: theme.spacing[16],
    marginBottom: theme.spacing[24],
  },
  memberItem: {
    alignItems: 'center',
    gap: theme.spacing[4],
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.heroBg,
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  memberAvatarText: {
    color: theme.colors.cream,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  memberName: {
    fontSize: 11,
    color: theme.colors.heroMuted,
    fontFamily: theme.fontFamily.regular,
  },
  memberCountText: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    marginBottom: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  addMemberButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.heroCircle,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.heroBg,
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
    color: theme.colors.success,
    fontFamily: theme.fontFamily.mono,
    marginBottom: theme.spacing[4],
  },
  balanceSubtitle: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    fontFamily: theme.fontFamily.regular,
  },
  settlementsSection: {
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[24],
  },
  settlementsCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  settlementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: theme.spacing[12],
  },
  settlementsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  settlementsTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  settlementsCount: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
    backgroundColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  settlementsBody: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  settlementsEmptyText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    paddingVertical: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[8],
  },
  settlementRowDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  settlementText: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  settlementPersonName: {
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  settlementAmount: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.mono,
  },
  oweAmount: {
    color: theme.colors.danger,
  },
  owedAmount: {
    color: theme.colors.success,
  },
  settlementOtherAmount: {
    color: theme.colors.textPrimary,
  },
  settlementSubtext: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontFamily: theme.fontFamily.regular,
  },
  expensesContainer: {
    flex: 1,
    paddingTop: theme.spacing[24],
  },
  expensesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[24],
    marginBottom: theme.spacing[12],
  },
  expensesTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  expensesCount: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[24],
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
  billShareText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  billPaidBy: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  billAmountContainer: {
    alignItems: 'flex-end',
  },
  billAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  billConvertedAmount: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.mono,
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: theme.spacing[24],
    bottom: theme.spacing[24],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
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
    width: '80%',
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: theme.spacing[16],
    gap: theme.spacing[8],
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
    textAlign: 'center',
    marginBottom: theme.spacing[8],
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[12],
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[12],
    borderRadius: 10,
  },
  modalOptionDanger: {
    backgroundColor: theme.colors.accentBg,
  },
  modalOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  settlementRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  settleButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 2,
  },
  settleButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
  },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
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
  modalSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: theme.fontFamily.regular,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 8,
  },
  amountPrefix: {
    fontSize: 24,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginRight: 6,
  },
  amountInput: {
    fontSize: 24,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    minWidth: 120,
    fontFamily: theme.fontFamily.mono,
  },
  modalHint: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16,
    fontFamily: theme.fontFamily.regular,
  },
  modalActionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  modalActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnCancel: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalBtnCancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  modalBtnConfirm: {
    backgroundColor: theme.colors.primary,
  },
  modalBtnConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
  },
});
