import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, Image } from 'react-native';
import { ChevronLeft, ArrowRight, Bell, CheckCircle, Check } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';

interface Settlement {
  id: string;
  from: string;
  fromColor: string;
  to: string;
  toColor: string;
  amount: number;
  paid: boolean;
}

const initialSettlements: Settlement[] = [
  {
    id: '1',
    from: 'Aman',
    fromColor: theme.colors.primary,
    to: 'You',
    toColor: theme.colors.success,
    amount: 210,
    paid: false,
  },
  {
    id: '2',
    from: 'Priya',
    fromColor: theme.colors.success,
    to: 'You',
    toColor: theme.colors.success,
    amount: 180,
    paid: false,
  },
  {
    id: '3',
    from: 'Rahul',
    fromColor: '#7C3AED',
    to: 'You',
    toColor: theme.colors.success,
    amount: 150,
    paid: true,
  },
];

export default function SettlementScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [settlements, setSettlements] = useState<Settlement[]>(initialSettlements);

  const handleMarkAsPaid = (id: string) => {
    setSettlements(settlements.map(s => 
      s.id === id ? { ...s, paid: true } : s
    ));
  };

  const handleRemind = (name: string) => {
    Alert.alert('Reminder Sent', `Payment reminder sent to ${name}`);
  };

  const pendingSettlements = settlements.filter(s => !s.paid);
  const allSettled = pendingSettlements.length === 0;

  const renderSettlementItem = ({ item }: { item: Settlement }) => (
    <View style={[styles.settlementCard, item.paid && styles.settlementCardPaid]}>
      <View style={styles.avatarsContainer}>
        <View style={[styles.avatar, { backgroundColor: item.fromColor }]}>
          {item.from === 'You' && user?.profilePictureUrl ? (
            <Image source={{ uri: user.profilePictureUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{item.from.charAt(0)}</Text>
          )}
        </View>
        <View style={styles.arrowContainer}>
          <ArrowRight size={18} color={theme.colors.textSecondary} />
        </View>
        <View style={[styles.avatar, { backgroundColor: item.toColor }]}>
          {item.to === 'You' && user?.profilePictureUrl ? (
            <Image source={{ uri: user.profilePictureUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{item.to.charAt(0)}</Text>
          )}
        </View>
      </View>

      <View style={styles.amountContainer}>
        <Text style={[styles.amount, item.paid && styles.amountPaid]}>₹{item.amount}</Text>
        {item.paid && (
          <View style={styles.paidBadge}>
            <Check size={12} color={theme.colors.cream} />
            <Text style={styles.paidText}>Paid</Text>
          </View>
        )}
      </View>

      <View style={styles.actionsContainer}>
        {!item.paid && (
          <>
            <TouchableOpacity
              style={styles.remindButton}
              onPress={() => handleRemind(item.from)}>
              <Bell size={14} color={theme.colors.primary} />
              <Text style={styles.remindButtonText}>Remind</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.markPaidButton}
              onPress={() => handleMarkAsPaid(item.id)}>
              <Check size={16} color={theme.colors.cream} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settle Up</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      {allSettled ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <CheckCircle size={48} color={theme.colors.success} />
          </View>
          <Text style={styles.emptyTitle}>All settled up!</Text>
          <Text style={styles.emptySubtitle}>No pending payments</Text>
        </View>
      ) : (
        <FlatList
          data={pendingSettlements}
          keyExtractor={(item) => item.id}
          renderItem={renderSettlementItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[8],
  },
  settlementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: theme.spacing[8],
    gap: theme.spacing[12],
  },
  settlementCardPaid: {
    opacity: 0.5,
  },
  avatarsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
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
  arrowContainer: {
    marginHorizontal: theme.spacing[4],
  },
  amountContainer: {
    flex: 1,
    alignItems: 'flex-end',
    gap: theme.spacing[4],
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  amountPaid: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[4],
    backgroundColor: theme.colors.success,
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[4],
    borderRadius: 8,
  },
  paidText: {
    color: theme.colors.cream,
    fontSize: 10,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  remindButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[4],
    height: 34,
    paddingHorizontal: theme.spacing[12],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  remindButtonText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  markPaidButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing[12],
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.travelTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  emptySubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
});