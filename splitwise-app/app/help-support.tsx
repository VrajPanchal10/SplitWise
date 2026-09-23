import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Alert } from 'react-native';
import { ChevronLeft, ChevronDown, MessageCircle, Mail, BookOpen } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';

interface FaqItem {
  question: string;
  answer: string;
  expanded: boolean;
}

const initialFaqs: FaqItem[] = [
  {
    question: 'How do I split a bill with a group?',
    answer:
      'Open the group, tap the "+" button, and select "Enter Manually" or "Scan a Bill".' +
      ' All group members are pre-selected by default. You can uncheck anyone who should not' +
      ' share the expense. Each item is split equally among the selected members automatically.',
    expanded: true,
  },
  {
    question: 'How are balances calculated?',
    answer:
      'For every group bill, the person who paid is credited the full amount, and each member' +
      ' who shared the bill is debited their per-person share. Balances are then simplified into' +
      ' the fewest possible "who pays whom" transactions, so you only settle one amount per person.',
    expanded: false,
  },
  {
    question: 'How do I settle a payment?',
    answer:
      'Go to the group, open the "Balances" section, and transfer the amount shown via UPI or any' +
      ' payment method you and the other person agree on. Once paid, the settlement can be marked' +
      ' as settled in the app.',
    expanded: false,
  },
  {
    question: 'What happens when I add a friend?',
    answer:
      'Adding a friend lets you split bills with them directly without creating a group. Your friend' +
      ' will receive an invitation and must accept it before you can split expenses together.',
    expanded: false,
  },
  {
    question: 'Can I delete a bill or expense?',
    answer:
      'Yes. Open the bill you want to remove — if you are the one who paid for it, you can delete' +
      ' it and all related balances will be recalculated automatically.',
    expanded: false,
  },
  {
    question: 'Is my data safe?',
    answer:
      'All your data stays private. Group balances are only visible to members of that group.' +
      ' See the Privacy section for full details on how your data is used.',
    expanded: false,
  },
];

export default function HelpSupportScreen() {
  const router = useRouter();
  const [faqs, setFaqs] = useState<FaqItem[]>(initialFaqs);

  const toggleFaq = (index: number) => {
    setFaqs(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, expanded: !item.expanded } : item
      )
    );
  };

  const handleEmailSupport = () => {
    Linking.openURL('mailto:supportsplitwise75@gmail.com?subject=SplitWise%20Support%20Request')
      .catch(() => Alert.alert('Error', 'Could not open your email app.'));
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Contact options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact us</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() =>
                Linking.openURL(
                  'https://wa.me/?text=Hi%20SplitWise%20Support%2C%20I%20need%20help%20with%20my%20account'
                ).catch(() => Alert.alert('Error', 'Could not open WhatsApp.'))
              }
              activeOpacity={0.7}>
              <View style={[styles.contactIcon, { backgroundColor: theme.colors.travelTint }]}>
                <MessageCircle size={18} color={theme.colors.success} />
              </View>
              <View style={styles.contactTextContainer}>
                <Text style={styles.contactTitle}>WhatsApp Support</Text>
                <Text style={styles.contactText}>Chat with us — we usually reply within a few hours</Text>
              </View>
              <ChevronRightIcon />
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity style={styles.contactRow} onPress={handleEmailSupport} activeOpacity={0.7}>
              <View style={[styles.contactIcon, { backgroundColor: theme.colors.foodTint }]}>
                <Mail size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.contactTextContainer}>
                <Text style={styles.contactTitle}>Email us</Text>
                <Text style={styles.contactText}>supportsplitwise75@gmail.com</Text>
              </View>
              <ChevronRightIcon />
            </TouchableOpacity>
          </View>
        </View>

        {/* FAQ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently asked questions</Text>
          <View style={styles.faqCard}>
            {faqs.map((faq, index) => (
              <View key={index}>
                <TouchableOpacity
                  style={styles.faqHeader}
                  onPress={() => toggleFaq(index)}
                  activeOpacity={0.7}>
                  <Text style={styles.faqQuestion}>{faq.question}</Text>
                  <ChevronDown
                    size={18}
                    color={theme.colors.textSecondary}
                    style={[styles.chevron, faq.expanded && styles.chevronExpanded]}
                  />
                </TouchableOpacity>
                {faq.expanded && (
                  <Text style={styles.faqAnswer}>{faq.answer}</Text>
                )}
                {index < faqs.length - 1 && <View style={styles.rowDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* More resources */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Still need help?</Text>
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() =>
              Linking.openURL(
                'mailto:supportsplitwise75@gmail.com?subject=SplitWise%20Bug%20Report&body=Describe%20the%20issue...'
              ).catch(() => Alert.alert('Error', 'Could not open your email app.'))
            }>
            <View style={styles.contactRow}>
              <View style={[styles.contactIcon, { backgroundColor: theme.colors.border }]}>
                <BookOpen size={18} color={theme.colors.textSecondary} />
              </View>
              <View style={styles.contactTextContainer}>
                <Text style={styles.contactTitle}>Report a problem</Text>
                <Text style={styles.contactText}>Found a bug? Tell us what happened and we will fix it</Text>
              </View>
              <ChevronRightIcon />
            </View>
          </TouchableOpacity>
        </View>

        {/* Version */}
        <Text style={styles.versionText}>SplitWise v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const ChevronRightIcon = () => (
  <ChevronDown
    size={18}
    color={theme.colors.textSecondary}
    style={{ transform: [{ rotate: '-90deg' }] }}
  />
);

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
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactTextContainer: {
    flex: 1,
  },
  contactTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  contactText: {
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
  faqCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  faqQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    lineHeight: 20,
    fontFamily: theme.fontFamily.regular,
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  faqAnswer: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 20,
    paddingBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  versionText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing[24],
    marginBottom: theme.spacing[24],
    fontFamily: theme.fontFamily.regular,
  },
});