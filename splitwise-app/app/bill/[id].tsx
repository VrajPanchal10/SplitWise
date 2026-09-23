import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { ChevronLeft, Pencil, Trash2, Receipt, UtensilsCrossed, Car, Film } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useLocalSearchParams } from 'expo-router';
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

interface ShareBreakdown {
  userId: string;
  name: string;
  share: number;
  profilePictureUrl?: string;
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

    const uniqueSharedBy = Array.from(new Set(item.sharedByUserIds));
    if (uniqueSharedBy.length === 0) continue;

    if (uniqueSharedBy.includes(userId)) {
      totalShare += item.price / uniqueSharedBy.length;
    }
  }
  return totalShare;
};

export default function BillDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const billId = params.id as string;
  const { user } = useAuth();

  const [bill, setBill] = useState<Bill | null>(null);
  const [shares, setShares] = useState<ShareBreakdown[]>([]);
  const [paidByName, setPaidByName] = useState('Unknown');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchBillData = useCallback(async () => {
    if (!billId) return;

    try {
      setIsLoading(true);

      // 1. Fetch bill details
      const billResponse = await apiClient.get(`/bills/${billId}`);
      const billData: Bill = billResponse.data;
      setBill(billData);

      // 2. Fetch payer name
      try {
        const payerResponse = await apiClient.get(`/users/${billData.paidBy}`);
        setPaidByName(payerResponse.data.fullName || 'Unknown');
      } catch (error) {
        console.error('Error fetching payer name:', error);
      }

      // 3. Build per-person share breakdown
      // Collect all unique participant IDs from all items
      const participantIds = new Set<string>();
      billData.items?.forEach((item) => {
        item.sharedByUserIds?.forEach((id) => participantIds.add(id));
      });

      // Calculate each participant's share
      const shareMap = new Map<string, number>();
      participantIds.forEach((participantId) => {
        shareMap.set(participantId, calculateUserShare(billData, participantId));
      });

      // Fetch names and profile pictures for all participants
      const breakdown: ShareBreakdown[] = [];
      for (const [participantId, share] of shareMap.entries()) {
        let name = participantId;
        let profilePictureUrl: string | undefined;
        try {
          const userResponse = await apiClient.get(`/users/${participantId}`);
          name = userResponse.data.fullName || participantId;
          profilePictureUrl = userResponse.data.profilePictureUrl;
        } catch (error) {
          console.error(`Error fetching user ${participantId}:`, error);
        }
        breakdown.push({ userId: participantId, name, share, profilePictureUrl });
      }

      // Sort: current user first, then by share descending
      breakdown.sort((a, b) => {
        if (a.userId === user?.id) return -1;
        if (b.userId === user?.id) return 1;
        return b.share - a.share;
      });

      setShares(breakdown);
    } catch (error) {
      console.error('Error fetching bill data:', error);
      Alert.alert('Error', 'Failed to load bill details');
    } finally {
      setIsLoading(false);
    }
  }, [billId, user]);

  useEffect(() => {
    fetchBillData();
  }, [fetchBillData]);

  const handleEdit = () => {
    if (!bill) return;
    router.push({
      pathname: '/manual-entry',
      params: { billId: bill.id },
    });
  };

  const handleDelete = () => {
    if (!bill) return;

    Alert.alert(
      'Delete this expense?',
      'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDeleting(true);
              await apiClient.delete(`/bills/${bill.id}`);
              router.back();
            } catch (error: any) {
              console.error('Error deleting bill:', error);
              Alert.alert(
                'Error',
                error.response?.status === 403
                  ? 'You can only delete bills you paid for'
                  : error.response?.data?.message || 'Failed to delete bill. Please try again.'
              );
            } finally {
              setIsDeleting(false);
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

  if (!bill) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Bill not found</Text>
      </View>
    );
  }

  const config = getCategoryConfig('food');
  const Icon = config.icon;
  const isPayer = user?.id === bill.paidBy;

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
          <Text style={styles.heroTitle} numberOfLines={1}>Bill Details</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Bill Summary */}
        <View style={styles.heroBill}>
          <View style={[styles.billIconContainer, { backgroundColor: config.tint }]}>
            <Icon size={24} color={config.color} />
          </View>
          <Text style={styles.billTitle} numberOfLines={2}>{bill.title}</Text>
          <Text style={styles.billAmount}>₹{bill.totalAmount.toLocaleString()}</Text>
          <Text style={styles.billMeta}>
            {new Date(bill.createdAt).toLocaleDateString()} · Paid by {paidByName}
          </Text>
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Body */}
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Per-Person Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who owes what</Text>
          <View style={styles.breakdownCard}>
            {shares.map((share, index) => (
              <View key={share.userId}>
                <View style={styles.shareRow}>
                  <View style={styles.sharePerson}>
                  <View style={[styles.shareAvatar, { backgroundColor: share.userId === user?.id ? theme.colors.primary : theme.colors.success }]}>
                      {share.profilePictureUrl ? (
                        <Image
                          key={share.profilePictureUrl}
                          source={{ uri: share.profilePictureUrl }}
                          style={styles.shareAvatarImage}
                          resizeMode="cover"
                          onError={(e) => console.log('[DEBUG] Participant avatar failed to load:', e.nativeEvent?.error)}
                        />
                      ) : (
                        <Text style={styles.shareAvatarText}>{share.name.charAt(0)}</Text>
                      )}
                    </View>
                    <View style={styles.shareInfo}>
                      <Text style={styles.shareName}>
                        {share.userId === user?.id ? 'You' : share.name}
                      </Text>
                      {share.userId === bill.paidBy && (
                        <Text style={styles.sharePaidLabel}>Paid</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.shareAmount}>₹{share.share.toFixed(2)}</Text>
                </View>
                {index < shares.length - 1 && <View style={styles.shareDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* Items Breakdown */}
        {bill.items && bill.items.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Items</Text>
            <View style={styles.itemsCard}>
              {bill.items.map((item, index) => (
                <View key={index}>
                  <View style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemSharedBy}>
                        Split between {item.sharedByUserIds?.length || 0} people
                      </Text>
                    </View>
                    <Text style={styles.itemPrice}>₹{item.price.toFixed(2)}</Text>
                  </View>
                  {index < bill.items.length - 1 && <View style={styles.itemDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[styles.editButton, isDeleting && styles.buttonDisabled]}
            onPress={handleEdit}
            disabled={isDeleting}
            activeOpacity={0.7}>
            {isDeleting ? (
              <ActivityIndicator size="small" color={theme.colors.cream} />
            ) : (
              <>
                <Pencil size={18} color={theme.colors.cream} />
                <Text style={styles.editButtonText}>Edit Bill</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteButton, isDeleting && styles.buttonDisabled]}
            onPress={handleDelete}
            disabled={isDeleting}
            activeOpacity={0.7}>
            {isDeleting ? (
              <ActivityIndicator size="small" color={theme.colors.danger} />
            ) : (
              <>
                <Trash2 size={18} color={theme.colors.danger} />
                <Text style={styles.deleteButtonText}>Delete Bill</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
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
  heroBill: {
    alignItems: 'center',
    paddingBottom: theme.spacing[24],
  },
  billIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  billTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: theme.colors.cream,
    textAlign: 'center',
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  billAmount: {
    fontSize: 32,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.mono,
    marginBottom: theme.spacing[4],
  },
  billMeta: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    fontFamily: theme.fontFamily.regular,
  },
  body: {
    flex: 1,
  },
  section: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  breakdownCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[8],
  },
  shareDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  sharePerson: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: theme.spacing[12],
  },
  shareAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  shareAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  shareAvatarText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  shareInfo: {
    flex: 1,
  },
  shareName: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  sharePaidLabel: {
    fontSize: 11,
    color: theme.colors.success,
    fontFamily: theme.fontFamily.regular,
  },
  shareAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  itemsCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[8],
  },
  itemDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  itemSharedBy: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  actionSection: {
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[24],
    gap: theme.spacing[12],
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.primary,
    height: 52,
    borderRadius: 14,
  },
  editButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.accentBg,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.danger + '30',
  },
  deleteButtonText: {
    color: theme.colors.danger,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
});