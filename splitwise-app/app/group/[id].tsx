import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Alert, Image } from 'react-native';
import { ChevronLeft, Settings, Plus, ChevronDown, UtensilsCrossed, Car, Film, Receipt, Trash2, LogOut } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';

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
  paidBy: string;
  createdAt: string;
  items: any[];
}

interface SettlementItem {
  otherId: string;
  otherName: string;
  amount: number;
  direction: 'owe' | 'owed';
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

const BillItem: React.FC<{ bill: Bill; memberNames: { [id: string]: string } }> = ({ bill, memberNames }) => {
  const router = useRouter();
  const config = getCategoryConfig('food'); // Default category
  const Icon = config.icon;

  const paidByName = memberNames[bill.paidBy] || bill.paidBy;

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
        <Text style={styles.billName}>{bill.title}</Text>
        <Text style={styles.billDate}>{new Date(bill.createdAt).toLocaleDateString()}</Text>
        <Text style={styles.billPaidBy}>Paid by {paidByName}</Text>
      </View>
      <Text style={styles.billAmount}>₹{bill.totalAmount.toLocaleString()}</Text>
    </TouchableOpacity>
  );
};

export default function GroupDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupId = params.id as string;
  const groupName = params.name as string || 'Group';
  const { user } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [memberNames, setMemberNames] = useState<{ [id: string]: string }>({});
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userBalance, setUserBalance] = useState(0);
  const [totalBills, setTotalBills] = useState(0);
  const [youOweTotal, setYouOweTotal] = useState(0);
  const [youAreOwedTotal, setYouAreOwedTotal] = useState(0);
  const [settlementItems, setSettlementItems] = useState<SettlementItem[]>([]);
  const [isSettlementsExpanded, setIsSettlementsExpanded] = useState(true);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [isGroupCreator, setIsGroupCreator] = useState(false);

  const fetchGroupData = useCallback(async () => {
    if (!groupId) return;

    try {
      setIsLoading(true);

      // Fetch group details to check if current user is the creator
      const groupResponse = await apiClient.get(`/groups/${groupId}`);
      const groupData = groupResponse.data;
      if (user && groupData.createdBy) {
        setIsGroupCreator(groupData.createdBy === user.id);
      }

      // Fetch group members
      const membersResponse = await apiClient.get(`/groups/${groupId}/members`);
      const membersData = membersResponse.data;
      setMembers(membersData);

      // Build member name lookup map
      const memberNameMap: { [id: string]: string } = {};
      membersData.forEach((member: Member) => {
        memberNameMap[member.id] = member.fullName;
      });
      setMemberNames(memberNameMap);

      // Fetch group bills
      const billsResponse = await apiClient.get(`/bills/group/${groupId}`);
      const billsData = billsResponse.data;
      setBills(billsData);

      // Calculate total bills amount
      const total = billsData.reduce((sum: number, bill: Bill) => sum + bill.totalAmount, 0);
      setTotalBills(total);

      // Fetch settlements and build the per-member balance breakdown
      if (user) {
        const settlementsResponse = await apiClient.get(`/bills/group/${groupId}/settlements`);
        const settlements = settlementsResponse.data;

        let totalOwe = 0;
        let totalOwed = 0;
        const items: SettlementItem[] = [];

        for (const settlement of settlements) {
          if (settlement.fromUserId === user.id) {
            // I owe money to someone
            totalOwe += settlement.amount;
            const other = membersData.find((m: Member) => m.id === settlement.toUserId);
            items.push({
              otherId: settlement.toUserId,
              otherName: other?.fullName || settlement.toUserId,
              amount: settlement.amount,
              direction: 'owe',
            });
          } else if (settlement.toUserId === user.id) {
            // Someone owes me money
            totalOwed += settlement.amount;
            const other = membersData.find((m: Member) => m.id === settlement.fromUserId);
            items.push({
              otherId: settlement.fromUserId,
              otherName: other?.fullName || settlement.fromUserId,
              amount: settlement.amount,
              direction: 'owed',
            });
          }
        }

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
  }, [groupId, user]);

  useFocusEffect(
    useCallback(() => {
      fetchGroupData();
    }, [fetchGroupData])
  );

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
          <Text style={styles.balanceLabel}>Balance summary</Text>
          {youOweTotal - youAreOwedTotal > 0.005 ? (
            <Text style={[styles.balanceAmount, { color: theme.colors.danger }]}>
              You owe ₹{(youOweTotal - youAreOwedTotal).toFixed(2)}
            </Text>
          ) : youAreOwedTotal - youOweTotal > 0.005 ? (
            <Text style={[styles.balanceAmount, { color: theme.colors.success }]}>
              You are owed ₹{(youAreOwedTotal - youOweTotal).toFixed(2)}
            </Text>
          ) : (
            <Text style={[styles.balanceAmount, { color: theme.colors.cream }]}>
              All settled up
            </Text>
          )}
          <Text style={styles.balanceSubtitle}>
            Total bills: ₹{totalBills.toLocaleString()}
          </Text>
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Per-member balance breakdown (expandable) */}
      <View style={styles.settlementsSection}>
        <View style={styles.settlementsCard}>
          <TouchableOpacity
            style={styles.settlementsHeader}
            onPress={() => setIsSettlementsExpanded(prev => !prev)}
            activeOpacity={0.7}>
            <View style={styles.settlementsHeaderLeft}>
              <Text style={styles.settlementsTitle}>Balances</Text>
              {settlementItems.length > 0 && (
                <Text style={styles.settlementsCount}>
                  {settlementItems.length} {settlementItems.length === 1 ? 'person' : 'people'}
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
                  No outstanding balances in this group
                </Text>
              ) : (
                settlementItems.map((item, index) => (
                  <View key={`${item.otherId}-${item.direction}`}>
                    <View style={styles.settlementRow}>
                      <Text style={styles.settlementText}>
                        {item.direction === 'owe' ? (
                          <>
                            You owe <Text style={styles.settlementPersonName}>{item.otherName}</Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.settlementPersonName}>{item.otherName}</Text> owes you
                          </>
                        )}
                      </Text>
                      <Text
                        style={[
                          styles.settlementAmount,
                          item.direction === 'owe' ? styles.oweAmount : styles.owedAmount,
                        ]}>
                        ₹{item.amount.toFixed(2)}
                      </Text>
                    </View>
                    {index < settlementItems.length - 1 && <View style={styles.settlementRowDivider} />}
                  </View>
                ))
              )}
            </View>
          )}
        </View>
      </View>

      {/* Bills List */}
      {bills.length > 0 ? (
        <FlatList
          data={bills}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <BillItem bill={item} memberNames={memberNames} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.billSeparator} />}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No bills yet</Text>
        </View>
      )}

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab} onPress={handleAddBill}>
        <Plus size={28} color={theme.colors.cream} />
      </TouchableOpacity>

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
    paddingVertical: 4,
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
    flex: 1,
    fontSize: 14,
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
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[24],
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
  billPaidBy: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  billAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
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
});
