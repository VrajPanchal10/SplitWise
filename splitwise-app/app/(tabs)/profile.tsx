import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image } from 'react-native';
import { User, Bell, Shield, HelpCircle, LogOut, ChevronRight, QrCode } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { ZigzagEdge } from '@/components/ZigzagEdge';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../services/apiClient';

interface UserStats {
  totalBills: number;
  groupsCount: number;
  friendsCount: number;
}

interface SettingItemProps {
  icon: React.ReactNode;
  label: string;
  tint: string;
  color: string;
  onPress?: () => void;
}

const SettingItem: React.FC<SettingItemProps> = ({ icon, label, tint, color, onPress }) => (
  <TouchableOpacity style={styles.settingItem} onPress={onPress} activeOpacity={0.7}>
    <View style={[styles.settingIconContainer, { backgroundColor: tint }]}>
      {icon}
    </View>
    <Text style={styles.settingLabel}>{label}</Text>
    <ChevronRight size={20} color={theme.colors.textSecondary} />
  </TouchableOpacity>
);

interface StatProps {
  value: string;
  label: string;
}

const Stat: React.FC<StatProps> = ({ value, label }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout, updateUser } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<UserStats>({
    totalBills: 0,
    groupsCount: 0,
    friendsCount: 0,
  });

  const fetchProfileData = useCallback(async () => {
    try {
      setIsLoading(true);

      // Fetch fresh user data from backend to get latest profilePictureUrl
      const userResponse = await apiClient.get('/users/me');
      console.log('[DEBUG] Fetched fresh user data:', JSON.stringify(userResponse.data));
      
      // Only update AuthContext if the fetched URL is DIFFERENT from current
      // This prevents unnecessary state updates that cause re-renders
      if (userResponse.data?.profilePictureUrl && userResponse.data.profilePictureUrl !== user?.profilePictureUrl) {
        console.log('[DEBUG] Updating AuthContext with fresh profilePictureUrl:', userResponse.data.profilePictureUrl);
        await updateUser({ profilePictureUrl: userResponse.data.profilePictureUrl });
      }
      if (userResponse.data?.paymentQrUrl && userResponse.data.paymentQrUrl !== user?.paymentQrUrl) {
        console.log('[DEBUG] Updating AuthContext with fresh paymentQrUrl:', userResponse.data.paymentQrUrl);
        await updateUser({ paymentQrUrl: userResponse.data.paymentQrUrl });
      }

      // Fetch user stats
      const statsResponse = await apiClient.get('/users/me/stats');
      setStats(statsResponse.data);
    } catch (error: any) {
      console.error('Error fetching profile data:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchProfileData();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const handleLogout = async () => {
    await logout(router);
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

        {/* QR Code Thumbnail - Top Right */}
        <TouchableOpacity
          style={styles.qrThumbnail}
          activeOpacity={0.7}
          onPress={() => router.push('/qr-code')}>
          {user?.paymentQrUrl ? (
            <Image
              key={user.paymentQrUrl}
              source={{ uri: user.paymentQrUrl }}
              style={styles.qrThumbnailImage}
              resizeMode="cover"
              onError={(e) => console.log('[DEBUG] QR thumbnail failed to load:', e.nativeEvent?.error)}
            />
          ) : (
            <View style={styles.qrThumbnailPlaceholder}>
              <QrCode size={22} color={theme.colors.textSecondary} />
            </View>
          )}
        </TouchableOpacity>

        {/* Hero Content */}
        <View style={styles.heroContent}>
          {user?.profilePictureUrl ? (
            <Image
              key={user.profilePictureUrl}
              source={{ uri: user.profilePictureUrl }}
              style={styles.avatar}
              resizeMode="cover"
              onError={(e) => console.log('[DEBUG] Avatar image failed to load:', e.nativeEvent?.error)}
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.fullName?.charAt(0) || 'U'}</Text>
            </View>
          )}
          <Text style={styles.userName}>{user?.fullName || 'User'}</Text>
          <Text style={styles.userEmail}>{user?.email || ''}</Text>
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Body Content */}
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Stats Row */}
        <View style={styles.statsCard}>
          <Stat value={stats.totalBills.toString()} label="Total bills" />
          <View style={styles.statDivider} />
          <Stat value={stats.groupsCount.toString()} label="Groups" />
          <View style={styles.statDivider} />
          <Stat value={stats.friendsCount.toString()} label="Friends" />
        </View>

        {/* Settings List */}
        <View style={styles.section}>
          <View style={styles.settingsCard}>
            <SettingItem
              icon={<User size={18} color={theme.colors.primary} />}
              label="Edit Profile"
              tint={theme.colors.foodTint}
              color={theme.colors.primary}
              onPress={() => router.push('/edit-profile')}
            />
            <View style={styles.settingDivider} />
            <SettingItem
              icon={<Bell size={18} color="#B45309" />}
              label="Notifications"
              tint={theme.colors.entertainmentTint}
              color="#B45309"
            />
            <View style={styles.settingDivider} />
            <SettingItem
              icon={<Shield size={18} color="#7C3AED" />}
              label="Privacy"
              tint="#F3E8FF"
              color="#7C3AED"
              onPress={() => router.push('/privacy')}
            />
            <View style={styles.settingDivider} />
            <SettingItem
              icon={<HelpCircle size={18} color={theme.colors.textSecondary} />}
              label="Help & Support"
              tint={theme.colors.border}
              color={theme.colors.textSecondary}
              onPress={() => router.push('/help-support')}
            />
          </View>
        </View>

        {/* Log Out */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
          <LogOut size={18} color={theme.colors.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
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
    paddingTop: theme.spacing[32],
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
  qrThumbnail: {
    position: 'absolute',
    top: 44,
    right: theme.spacing[16],
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  qrThumbnailImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  qrThumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: theme.colors.heroCircle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContent: {
    alignItems: 'center',
    paddingBottom: theme.spacing[24],
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
    overflow: 'hidden',
  },
  avatarText: {
    color: theme.colors.cream,
    fontSize: 24,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  userName: {
    fontSize: 18,
    fontWeight: '500',
    color: theme.colors.cream,
    marginBottom: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  userEmail: {
    fontSize: 13,
    color: theme.colors.heroMuted,
    fontFamily: theme.fontFamily.regular,
  },
  body: {
    flex: 1,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    marginHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: theme.colors.border,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
    marginBottom: theme.spacing[4],
  },
  statLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  section: {
    marginTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[24],
  },
  settingsCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  settingDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 50,
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingLabel: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    marginHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
    marginBottom: theme.spacing[24],
    paddingVertical: theme.spacing[12],
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: 14,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.danger,
    fontFamily: theme.fontFamily.regular,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
});