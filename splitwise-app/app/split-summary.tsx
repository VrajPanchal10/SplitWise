import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, TextInput, Image } from 'react-native';
import { ChevronLeft, ArrowRight } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useBillCreation } from '../context/BillCreationContext';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';
import {
  calculateItemShares,
  calculateBillBreakdown,
  validateCustomShares,
  type ParticipantBreakdown,
} from '../utils/splitCalculator';

interface FriendShare {
  userId: string;
  name: string;
  paidAmount: number;
  shareAmount: number;
  netAmount: number;
  color: string;
}

interface Settlement {
  from: string;
  fromColor: string;
  to: string;
  toColor: string;
  amount: number;
}

export default function SplitSummaryScreen() {
  const router = useRouter();
  const { scannedItems, groupId, receiptUrl, resetBill } = useBillCreation();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [friendShares, setFriendShares] = useState<FriendShare[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [editingAmounts, setEditingAmounts] = useState<{ [userId: string]: string }>({});

  // Calculate shares on mount using deterministic split calculator
  useEffect(() => {
    const selectedItems = scannedItems.filter(item => item.selected);
    const total = selectedItems.reduce((sum, item) => sum + item.price, 0);
    setTotalAmount(Math.round(total * 100) / 100);

    if (selectedItems.length === 0 || !user) return;

    // Collect all unique participant IDs from selected items
    const allParticipantIds = new Set<string>();
    for (const item of selectedItems) {
      for (const uid of item.sharedByUserIds) {
        allParticipantIds.add(uid);
      }
    }
    const participantIds = Array.from(allParticipantIds);

    // Build items for the deterministic calculator
    const itemsToSplit = selectedItems
      .filter(item => item.sharedByUserIds.length > 0)
      .map(item => ({
        name: item.name,
        price: item.price,
        sharedByUserIds: item.sharedByUserIds,
        customShares: item.customShares,
      }));

    // Use the deterministic breakdown calculator
    const breakdown = calculateBillBreakdown(
      Math.round(total * 100) / 100,
      user.id,
      participantIds,
      itemsToSplit
    );

    // Transform to display format with Paid/Share/Net
    const shares: FriendShare[] = breakdown.participants.map(p => ({
      userId: p.userId,
      name: p.userId === user.id ? 'You' : `User ${p.userId.slice(0, 4)}`,
      paidAmount: p.paidAmount,
      shareAmount: p.shareAmount,
      netAmount: p.netAmount,
      color: p.userId === user.id ? theme.colors.primary : theme.colors.success,
    }));

    setFriendShares(shares);
    // Initialize editing amounts with share amounts
    const amounts: { [userId: string]: string } = {};
    shares.forEach(share => {
      amounts[share.userId] = share.shareAmount.toFixed(2);
    });
    setEditingAmounts(amounts);

    // Calculate settlements (only non-payer participants who owe money)
    const settlementList: Settlement[] = shares
      .filter(share => share.netAmount < 0)
      .map(share => ({
        from: share.name,
        fromColor: theme.colors.primary,
        to: 'You',
        toColor: theme.colors.success,
        amount: Math.abs(share.netAmount),
      }));

    setSettlements(settlementList);
  }, [scannedItems, user]);

  const handleAmountChange = (userId: string, value: string) => {
    setEditingAmounts(prev => ({ ...prev, [userId]: value }));

    // Update shares and settlements in real-time
    const newShareAmount = parseFloat(value) || 0;
    const isPayer = userId === user?.id;
    const paidAmount = isPayer ? totalAmount : 0;
    const newNet = Math.round((paidAmount - newShareAmount) * 100) / 100;

    setFriendShares(prev => prev.map(share =>
      share.userId === userId
        ? { ...share, shareAmount: newShareAmount, netAmount: newNet }
        : share
    ));
    setSettlements(prev => {
      const share = friendShares.find(s => s.userId === userId);
      if (!share) return prev;
      return prev.map(settlement =>
        settlement.from === share.name
          ? { ...settlement, amount: Math.abs(newNet) }
          : settlement
      );
    });
  };

  // Validation: sum of edited shares should equal totalAmount
  const sharesValidation = useMemo(() => {
    const numericShares: Record<string, number> = {};
    for (const [uid, val] of Object.entries(editingAmounts)) {
      numericShares[uid] = parseFloat(val) || 0;
    }
    return validateCustomShares(numericShares, totalAmount);
  }, [editingAmounts, totalAmount]);

  const handleConfirm = async () => {
    if (!user) return;

    // Validate shares before saving
    if (!sharesValidation.isValid) {
      Alert.alert(
        'Invalid Split',
        sharesValidation.message || 'Shares must sum to the bill total',
      );
      return;
    }

    setIsLoading(true);

    try {
      // Prepare bill data
      const selectedItems = scannedItems.filter(item => item.selected);
      const total = selectedItems.reduce((sum, item) => sum + item.price, 0);

      if (total === 0) return;

      // Build custom shares map from editing amounts if user modified them
      const customSharesMap: Record<string, number> = {};
      for (const [uid, val] of Object.entries(editingAmounts)) {
        customSharesMap[uid] = parseFloat(val) || 0;
      }

      // Create bill items array for backend.
      // De-duplicate sharedByUserIds so the payer is never counted twice.
      const billItems = selectedItems.map(item => ({
        name: item.name,
        price: item.price,
        sharedByUserIds: Array.from(new Set(item.sharedByUserIds)),
        customShares: item.customShares || undefined,
      }));

      // Create bill via API
      await apiClient.post('/bills', {
        title: `Bill ${new Date().toLocaleDateString()}`,
        totalAmount: Math.round(total * 100) / 100,
        groupId: groupId || null,
        paidBy: user.id,
        participantIds: undefined,
        items: billItems,
        receiptUrl: receiptUrl || null,
      });

      // Reset bill creation state
      resetBill();

      // Navigate back
      Alert.alert('Success', 'Bill created successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error creating bill:', error);
      Alert.alert('Error', 'Failed to save expense. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Split Summary</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Bill Breakdown Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Expense Breakdown</Text>
          <Text style={styles.totalLabel}>Total Amount</Text>
          <Text style={styles.totalAmount}>₹{totalAmount.toFixed(2)}</Text>
          <Text style={styles.paidByLabel}>
            Paid by You · {friendShares.length} participant{friendShares.length !== 1 ? 's' : ''}
          </Text>

          <View style={styles.divider} />

          {friendShares.map((friend, index) => (
            <View key={friend.userId}>
              <View style={styles.friendRow}>
                <View style={[styles.avatar, { backgroundColor: friend.color }]}>
                  {friend.userId === user?.id && user?.profilePictureUrl ? (
                    <Image source={{ uri: user.profilePictureUrl }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{friend.name.charAt(0)}</Text>
                  )}
                </View>
                <View style={styles.friendMeta}>
                  <Text style={styles.friendName}>
                    {friend.name} {friend.userId === user?.id ? '(Payer)' : ''}
                  </Text>
                  <Text style={styles.friendPaidLabel}>
                    Paid: ₹{friend.paidAmount.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.shareColumn}>
                  <View style={styles.amountInputContainer}>
                    <Text style={styles.currencySymbol}>₹</Text>
                    <TextInput
                      style={styles.amountInput}
                      value={editingAmounts[friend.userId] || ''}
                      onChangeText={(value) => handleAmountChange(friend.userId, value)}
                      keyboardType="numeric"
                      placeholder="0.00"
                      placeholderTextColor={theme.colors.textSecondary}
                    />
                  </View>
                  <View
                    style={[
                      styles.netBadge,
                      friend.netAmount > 0
                        ? styles.netBadgePositive
                        : friend.netAmount < 0
                        ? styles.netBadgeNegative
                        : styles.netBadgeZero,
                    ]}>
                    <Text
                      style={[
                        styles.netBadgeText,
                        friend.netAmount > 0
                          ? styles.netTextPositive
                          : friend.netAmount < 0
                          ? styles.netTextNegative
                          : styles.netTextZero,
                      ]}>
                      {friend.netAmount > 0
                        ? `Gets back ₹${friend.netAmount.toFixed(2)}`
                        : friend.netAmount < 0
                        ? `Owes ₹${Math.abs(friend.netAmount).toFixed(2)}`
                        : 'Settled'}
                    </Text>
                  </View>
                </View>
              </View>
              {index < friendShares.length - 1 && <View style={styles.rowDivider} />}
            </View>
          ))}

          {friendShares.length === 0 && (
            <View style={styles.emptySharesContainer}>
              <Text style={styles.emptySharesText}>No items selected for sharing</Text>
            </View>
          )}

          {/* Validation badge */}
          {friendShares.length > 0 && (
            <View
              style={[
                styles.validationBar,
                sharesValidation.isValid
                  ? styles.validationBarSuccess
                  : styles.validationBarDanger,
              ]}>
              <Text
                style={[
                  styles.validationBarText,
                  sharesValidation.isValid
                    ? styles.validationBarTextSuccess
                    : styles.validationBarTextDanger,
                ]}>
                {sharesValidation.isValid
                  ? `✓ Shares reconcile to ₹${sharesValidation.sum.toFixed(2)}`
                  : sharesValidation.message}
              </Text>
            </View>
          )}
        </View>

        {/* Who Pays Whom */}
        {settlements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Who pays whom</Text>
            <View style={styles.card}>
              {settlements.map((settlement, index) => (
                <View key={index}>
                  <View style={styles.settlementRow}>
                    <View style={styles.settlementPerson}>
                      <View style={[styles.settlementAvatar, { backgroundColor: settlement.fromColor }]}>
                        {settlement.from === 'You' && user?.profilePictureUrl ? (
                          <Image source={{ uri: user.profilePictureUrl }} style={styles.settlementAvatarImage} />
                        ) : (
                          <Text style={styles.settlementAvatarText}>
                            {settlement.from.charAt(0)}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.settlementName}>{settlement.from}</Text>
                    </View>

                    <View style={styles.arrowContainer}>
                      <ArrowRight size={18} color={theme.colors.textSecondary} />
                    </View>

                    <View style={styles.settlementPerson}>
                      <View style={[styles.settlementAvatar, { backgroundColor: settlement.toColor }]}>
                        {settlement.to === 'You' && user?.profilePictureUrl ? (
                          <Image source={{ uri: user.profilePictureUrl }} style={styles.settlementAvatarImage} />
                        ) : (
                          <Text style={styles.settlementAvatarText}>
                            {settlement.to.charAt(0)}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.settlementName}>{settlement.to}</Text>
                    </View>

                    <Text style={styles.settlementAmount}>₹{settlement.amount.toFixed(2)}</Text>
                  </View>
                  {index < settlements.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.confirmButton, isLoading && styles.confirmButtonDisabled]}
          onPress={handleConfirm}
          disabled={isLoading || totalAmount === 0}>
          {isLoading ? (
            <ActivityIndicator color={theme.colors.cream} />
          ) : (
            <Text style={styles.confirmButtonText}>Confirm & Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[16],
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  placeholder: {
    width: 40,
  },
  body: {
    flex: 1,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: theme.spacing[24],
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  totalLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  totalAmount: {
    fontSize: 28,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
    marginBottom: theme.spacing[4],
  },
  paidByLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
    marginBottom: theme.spacing[16],
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing[8],
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  rowDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 52,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  friendName: {
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  friendMeta: {
    flex: 1,
  },
  friendPaidLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
    marginTop: 2,
  },
  shareColumn: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing[4],
    minWidth: 90,
  },
  currencySymbol: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginRight: 2,
    fontFamily: theme.fontFamily.mono,
  },
  amountInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
    textAlign: 'right',
    padding: 0,
    minWidth: 60,
  },
  emptySharesContainer: {
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
  },
  emptySharesText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
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
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[8],
  },
  settlementPerson: {
    alignItems: 'center',
    gap: theme.spacing[4],
  },
  settlementAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  settlementAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  settlementAvatarText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  settlementName: {
    fontSize: 12,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  arrowContainer: {
    flex: 1,
    alignItems: 'center',
  },
  settlementAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.success,
    fontFamily: theme.fontFamily.mono,
  },
  bottomBar: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[16],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  confirmButton: {
    backgroundColor: theme.colors.primary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  netBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  netBadgePositive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  netBadgeNegative: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },
  netBadgeZero: {
    backgroundColor: 'rgba(148, 163, 184, 0.10)',
  },
  netBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: theme.fontFamily.mono,
  },
  netTextPositive: {
    color: theme.colors.success,
  },
  netTextNegative: {
    color: theme.colors.danger,
  },
  netTextZero: {
    color: theme.colors.textSecondary,
  },
  validationBar: {
    marginTop: theme.spacing[12],
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  validationBarSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
  },
  validationBarDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  validationBarText: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  validationBarTextSuccess: {
    color: theme.colors.success,
  },
  validationBarTextDanger: {
    color: theme.colors.danger,
  },
});