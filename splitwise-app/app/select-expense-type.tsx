import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronLeft, Users } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';

export default function SelectExpenseTypeScreen() {
  const router = useRouter();

  const handleSplitExpense = () => {
    router.push('/select-items');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Expense Type</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title}>Who is this expense for?</Text>
        <Text style={styles.subtitle}>Choose how you want to split this bill</Text>

        {/* Split Expense Option */}
        <TouchableOpacity
          style={styles.optionCard}
          onPress={handleSplitExpense}
          activeOpacity={0.7}>
          <View style={[styles.iconContainer, { backgroundColor: theme.colors.travelTint }]}>
            <Users size={28} color={theme.colors.success} />
          </View>
          <View style={styles.optionInfo}>
            <Text style={styles.optionTitle}>Split with someone</Text>
            <Text style={styles.optionSubtitle}>
              Share this bill with friends or group
            </Text>
          </View>
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
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[32],
  },
  title: {
    fontSize: 24,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[32],
    fontFamily: theme.fontFamily.regular,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: theme.spacing[16],
    gap: theme.spacing[16],
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionInfo: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  optionSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
});