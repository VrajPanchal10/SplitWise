import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { ChevronLeft, QrCode } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';

export default function QrCodeScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const hasQr = !!user?.paymentQrUrl;

  return (
    <View style={styles.container}>
      {/* Header - back chevron only */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Center Content */}
      <View style={styles.content}>
        {hasQr ? (
          <>
            {/* QR Code Card */}
            <View style={styles.qrCard}>
              <Image
                key={user.paymentQrUrl!}
                source={{ uri: user.paymentQrUrl! }}
                style={styles.qrImage}
                resizeMode="contain"
                onError={(e) => console.log('[DEBUG] QR image failed to load:', e.nativeEvent?.error)}
              />
            </View>

            {/* Name & Subtitle */}
            <Text style={styles.userName}>{user?.fullName || 'User'}</Text>
            <Text style={styles.subtitle}>Scan to pay via UPI</Text>

            {/* Edit Button */}
            <TouchableOpacity
              style={styles.editButton}
              activeOpacity={0.7}
              onPress={() => router.push('/edit-profile')}>
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Empty State */}
            <View style={styles.emptyIconContainer}>
              <QrCode size={48} color={theme.colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>No QR code added yet</Text>
            <Text style={styles.emptySubtitle}>
              Add your UPI QR code so friends can scan and pay you directly
            </Text>
            <TouchableOpacity
              style={styles.addButton}
              activeOpacity={0.7}
              onPress={() => router.push('/edit-profile')}>
              <Text style={styles.addButtonText}>Add QR Code</Text>
            </TouchableOpacity>
          </>
        )}
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
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[16],
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[32],
  },
  qrCard: {
    width: 300,
    height: 300,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  qrImage: {
    width: 260,
    height: 260,
    borderRadius: 8,
  },
  userName: {
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginTop: theme.spacing[24],
    fontFamily: theme.fontFamily.regular,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  editButton: {
    marginTop: theme.spacing[24],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[16],
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.primary,
    fontFamily: theme.fontFamily.regular,
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[16],
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginTop: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  emptySubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing[8],
    marginBottom: theme.spacing[24],
    lineHeight: 20,
    fontFamily: theme.fontFamily.regular,
  },
  addButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[12],
    borderRadius: 12,
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  addButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
});