import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, TextInput, Image } from 'react-native';
import { ChevronLeft, ArrowRight } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useBillCreation } from '../context/BillCreationContext';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

interface FriendShare {
  userId: string;
  name: string;
  amount: number;
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
  const { scannedItems, groupId, resetBill } = useBillCreation();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [friendShares, setFriendShares] = useState<FriendShare[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [editingAmounts, setEditingAmounts] = useState<{ [userId: string]: string }>({});

  // Calculate shares on mount
  useEffect(() => {
    const selectedItems = scannedItems.filter(item => item.selected);
    const total = selectedItems.reduce((sum, item) => sum + item.price, 0);
    setTotalAmount(total);

    if (selectedItems.length === 0 || !user) return;

    // Calculate who shared each item
    const sharedBy: { [userId: string]: number } = {};

    for (const item of selectedItems) {
      if (item.sharedByUserIds.length === 0) {
        // If no one selected, skip items with no shares
        continue;
      }

      // Use custom shares if available, otherwise equal split
      if (item.customShares) {
        for (const userId of item.sharedByUserIds) {
          sharedBy[userId] = (sharedBy[userId] || 0) + (item.customShares[userId] || 0);
        }
      } else {
        // De-duplicate so the payer is never counted twice (matches backend math)
        const uniqueSharedBy = Array.from(new Set(item.sharedByUserIds));
        const splitAmount = item.price / uniqueSharedBy.length;
        for (const userId of uniqueSharedBy) {
          sharedBy[userId] = (sharedBy[userId] || 0) + splitAmount;
        }
      }
    }

    // Transform to display format
    const shares: FriendShare[] = Object.entries(sharedBy).map(([userId, amount]) => ({
      userId,
      name: userId === user.id ? 'You' : `User ${userId.slice(0, 4)}`,
      amount: Math.round(amount * 100) / 100,
      color: theme.colors.primary,
    }));

    setFriendShares(shares);
    // Initialize editing amounts
    const amounts: { [userId: string]: string } = {};
    shares.forEach(share => {
      amounts[share.userId] = share.amount.toFixed(2);
    });
    setEditingAmounts(amounts);

    // Calculate settlements
    const settlementList: Settlement[] = shares.map(share => ({
      from: share.name,
      fromColor: theme.colors.primary,
      to: 'You',
      toColor: theme.colors.success,
      amount: share.amount,
    }));

    setSettlements(settlementList);
  }, [scannedItems, user]);

  const handleAmountChange = (userId: string, value: string) => {
    setEditingAmounts(prev => ({ ...prev, [userId]: value }));

    // Update shares and settlements in real-time
    const newAmount = parseFloat(value) || 0;
    setFriendShares(prev => prev.map(share =>
      share.userId === userId ? { ...share, amount: newAmount } : share
    ));
    setSettlements(prev => prev.map(settlement => {
      const share = friendShares.find(s => s.userId === userId);
      if (share && settlement.from === share.name) {
        return { ...settlement, amount: newAmount };
      }
      return settlement;
    }));
  };

  const handleConfirm = async () => {
    if (!user) return;

    setIsLoading(true);

    try {
      // Prepare bill data
      const selectedItems = scannedItems.filter(item => item.selected);
      const total = selectedItems.reduce((sum, item) => sum + item.price, 0);

      if (total === 0) return;

      // Create bill items array for backend.
      // De-duplicate sharedByUserIds so the payer is never counted twice
      // (group members include the current user and may be toggled on).
      const billItems = selectedItems.map(item => ({
        name: item.name,
        price: item.price,
        sharedByUserIds: Array.from(new Set(item.sharedByUserIds)),
      }));

      // Create bill via API
      await apiClient.post('/bills', {
        title: `Bill ${new Date().toLocaleDateString()}`,
        totalAmount: total,
        groupId: groupId || null,
        paidBy: user.id,
        participantIds: undefined,
        items: billItems,
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
          <Text style={styles.cardTitle}>Bill Breakdown</Text>
          <Text style={styles.totalLabel}>Total Amount</Text>
          <Text style={styles.totalAmount}>₹{totalAmount}</Text>

          <View style={styles.divider} />

          {friendShares.map((friend, index) => (
            <View key={index}>
              <View style={styles.friendRow}>
                <View style={[styles.avatar, { backgroundColor: friend.color }]}>
                  {friend.userId === user?.id && user?.profilePictureUrl ? (
                    <Image source={{ uri: user.profilePictureUrl }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{friend.name.charAt(0)}</Text>
                  )}
                </View>
                <Text style={styles.friendName}>{friend.name}</Text>
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
              </View>
              {index < friendShares.length - 1 && <View style={styles.rowDivider} />}
            </View>
          ))}

          {friendShares.length === 0 && (
            <View style={styles.emptySharesContainer}>
              <Text style={styles.emptySharesText}>No items selected for sharing</Text>
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
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
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
});