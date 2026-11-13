import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Pressable,
} from 'react-native';
import { Check, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/constants/theme';
import {
  SUPPORTED_CURRENCIES,
  CurrencyConfig,
} from '../constants/currencies';

interface CurrencyPickerModalProps {
  visible: boolean;
  selectedCurrency: string;
  onSelect: (currencyCode: string) => void;
  onClose: () => void;
  title?: string;
}

export const CurrencyPickerModal: React.FC<CurrencyPickerModalProps> = ({
  visible,
  selectedCurrency,
  onSelect,
  onClose,
  title = 'Select Currency',
}) => {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const filteredCurrencies = SUPPORTED_CURRENCIES.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.symbol.toLowerCase().includes(q)
    );
  });

  const handleSelect = (code: string) => {
    onSelect(code);
    onClose();
  };

  const renderItem = ({ item }: { item: CurrencyConfig }) => {
    const isSelected = item.code.toUpperCase() === selectedCurrency.toUpperCase();
    return (
      <TouchableOpacity
        style={[styles.currencyRow, isSelected && styles.currencyRowSelected]}
        onPress={() => handleSelect(item.code)}
        activeOpacity={0.7}
      >
        <Text style={styles.flag}>{item.flag}</Text>
        <View style={styles.currencyDetails}>
          <View style={styles.codeRow}>
            <Text style={[styles.currencyCode, isSelected && styles.currencyCodeSelected]}>
              {item.code}
            </Text>
            <View style={[styles.currencySymbolBadge, isSelected && styles.currencySymbolBadgeSelected]}>
              <Text style={[styles.currencySymbolText, isSelected && styles.currencySymbolTextSelected]}>
                {item.symbol}
              </Text>
            </View>
          </View>
          <Text style={styles.currencyName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        {isSelected && (
          <View style={styles.checkIcon}>
            <Check size={16} color={theme.colors.primary} strokeWidth={2.5} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom + 16, 24) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Search size={18} color={theme.colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search currency (USD, EUR, Rupee...)"
              placeholderTextColor={theme.colors.textSecondary}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>

          <FlatList
            data={filteredCurrencies}
            keyExtractor={(item) => item.code}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  closeButton: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: theme.colors.background,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: theme.colors.textPrimary,
  },
  listContent: {
    paddingBottom: 16,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  currencyRowSelected: {
    backgroundColor: theme.colors.accentBg,
    borderColor: theme.colors.primary,
  },
  flag: {
    fontSize: 26,
    width: 36,
    textAlign: 'center',
    marginRight: 12,
  },
  currencyDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  currencyCodeSelected: {
    color: theme.colors.primary,
  },
  currencySymbolBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  currencySymbolBadgeSelected: {
    backgroundColor: '#FDECE6',
  },
  currencySymbolText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  currencySymbolTextSelected: {
    color: theme.colors.primary,
  },
  currencyName: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  checkIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FDECE6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
