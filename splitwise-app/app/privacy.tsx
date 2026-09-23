import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { ChevronLeft, ShieldCheck, Eye, Trash2, Database, Share2 } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';

interface PrivacyToggle {
  key: string;
  title: string;
  subtitle: string;
  value: boolean;
}

export default function PrivacyScreen() {
  const router = useRouter();
  const [toggles, setToggles] = useState<PrivacyToggle[]>([
    {
      key: 'shareActivity',
      title: 'Share group activity',
      subtitle: 'Let group members see when you add or settle bills.',
      value: true,
    },
    {
      key: 'showMe',
      title: 'Show me to friends',
      subtitle: 'Allow friends to find you by email when splitting expenses.',
      value: true,
    },
    {
      key: 'keepHistory',
      title: 'Keep bill history',
      subtitle: 'Store past bills and settlements for future reference.',
      value: true,
    },
    {
      key: 'emailNotifications',
      title: 'Email updates',
      subtitle: 'Receive settlement reminders and group updates on email.',
      value: false,
    },
  ]);

  const toggleSwitch = (key: string) => {
    setToggles(prev =>
      prev.map(item =>
        item.key === key ? { ...item, value: !item.value } : item
      )
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Intro Card */}
        <View style={styles.introCard}>
          <View style={[styles.introIcon, { backgroundColor: '#F3E8FF' }]}>
            <ShieldCheck size={28} color="#7C3AED" />
          </View>
          <Text style={styles.introTitle}>Your privacy matters</Text>
          <Text style={styles.introText}>
            SplitWise only uses your data to track shared expenses within your groups.
            Your balances are only visible to members of the groups you join.
          </Text>
        </View>

        {/* Data usage */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How your data is used</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: theme.colors.foodTint }]}>
                <Database size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>Bills & expenses</Text>
                <Text style={styles.infoText}>
                  Stored to calculate who owes what and to show your expense history.
                </Text>
              </View>
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: theme.colors.travelTint }]}>
                <Eye size={18} color={theme.colors.success} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>Profile & group info</Text>
                <Text style={styles.infoText}>
                  Your name, photo and email are visible to others in groups you share.
                </Text>
              </View>
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: theme.colors.border }]}>
                <Share2 size={18} color={theme.colors.textSecondary} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>No third-party sharing</Text>
                <Text style={styles.infoText}>
                  We never sell or share your data with advertisers or third parties.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy controls</Text>
          <View style={styles.card}>
            {toggles.map((item, index) => (
              <View key={item.key}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextContainer}>
                    <Text style={styles.toggleTitle}>{item.title}</Text>
                    <Text style={styles.toggleSubtitle}>{item.subtitle}</Text>
                  </View>
                  <Switch
                    value={item.value}
                    onValueChange={() => toggleSwitch(item.key)}
                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                    thumbColor={theme.colors.cream}
                  />
                </View>
                {index < toggles.length - 1 && <View style={styles.rowDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* Delete data */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your data</Text>
          <TouchableOpacity style={styles.card} activeOpacity={0.7}>
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: theme.colors.foodTint }]}>
                <Trash2 size={18} color={theme.colors.danger} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={[styles.infoTitle, { color: theme.colors.danger }]}>
                  Delete my data
                </Text>
                <Text style={styles.infoText}>
                  Request deletion of all your bills, groups and account data.
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footerText}>
          Last updated: 12 August 2026
        </Text>
      </ScrollView>
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
  introCard: {
    marginHorizontal: theme.spacing[24],
    marginTop: theme.spacing[16],
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  introIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[12],
  },
  introTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  introText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
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
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  infoText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 18,
    fontFamily: theme.fontFamily.regular,
  },
  rowDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginLeft: 48,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  toggleSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 18,
    fontFamily: theme.fontFamily.regular,
  },
  footerText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing[24],
    marginBottom: theme.spacing[24],
    fontFamily: theme.fontFamily.regular,
  },
});