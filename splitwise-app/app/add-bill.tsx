import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronLeft, Camera, Edit3 } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function AddBillScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupId = params.groupId as string | undefined;

  const handleScanBill = () => {
    if (groupId) {
      router.push({
        pathname: '/scan-bill',
        params: { groupId }
      });
    } else {
      router.push('/scan-bill');
    }
  };

  const handleEnterManually = () => {
    if (groupId) {
      router.push({
        pathname: '/manual-entry',
        params: { groupId }
      });
    } else {
      router.push('/manual-entry');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Expense</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Scan a Bill Option */}
        <TouchableOpacity
          style={styles.optionCard}
          onPress={handleScanBill}
          activeOpacity={0.7}>
          <View style={[styles.iconContainer, { backgroundColor: theme.colors.foodTint }]}>
            <Camera size={28} color={theme.colors.primary} />
          </View>
          <View style={styles.optionInfo}>
            <Text style={styles.optionTitle}>Scan a Bill</Text>
            <Text style={styles.optionSubtitle}>
              Snap a photo and we'll read the items for you
            </Text>
          </View>
        </TouchableOpacity>

        {/* Enter Manually Option */}
        <TouchableOpacity
          style={styles.optionCard}
          onPress={handleEnterManually}
          activeOpacity={0.7}>
          <View style={[styles.iconContainer, { backgroundColor: theme.colors.travelTint }]}>
            <Edit3 size={28} color={theme.colors.success} />
          </View>
          <View style={styles.optionInfo}>
            <Text style={styles.optionTitle}>Enter Manually</Text>
            <Text style={styles.optionSubtitle}>
              Type in the details yourself
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
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 20,
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