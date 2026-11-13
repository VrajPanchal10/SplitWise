import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, Image, DeviceEventEmitter } from 'react-native';
import { ChevronLeft, Check, ChevronDown, ChevronUp, AlertTriangle, Edit3 } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useBillCreation } from '../context/BillCreationContext';
import apiClient from '../services/apiClient';
import {
  splitEquallyDeterministically,
  calculateBillBreakdown,
  validateCustomShares,
} from '../utils/splitCalculator';
import {
  SUPPORTED_CURRENCIES,
  getCurrencyConfig,
  getCurrencySymbol,
  getApproximateRate,
  formatMoney,
  formatDualCurrency,
} from '@/constants/currencies';
import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';
import { EXPENSE_CATEGORIES, getCategoryByKey } from '@/constants/categories';

interface Friend {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl?: string;
}

interface OcrItem {
  id: string;
  name: string;
  price: number;
  quantity: number | null;
  unitPrice: number | null;
}

export default function ManualEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupId = params.groupId as string | undefined;
  const friendId = params.friendId as string | undefined;
  const billId = params.billId as string | undefined;
  const scannedTitle = params.scannedTitle as string | undefined;
  const scannedAmount = params.scannedAmount as string | undefined;
  const scannedCurrency = (params.currency as string | undefined) || 'INR';
  const receiptUrl = params.receiptUrl as string | undefined;
  const ocrConfidence = params.ocrConfidence as string | undefined;
  const ocrFinancialsRaw = params.ocrFinancials as string | undefined;
  const { user } = useAuth();
  const { scannedItems, setScannedItems } = useBillCreation();
  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState(scannedTitle || '');
  const [amount, setAmount] = useState(scannedAmount || '');
  const [currency, setCurrency] = useState<string>(scannedCurrency.toUpperCase().trim());
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
  const [groupBaseCurrency, setGroupBaseCurrency] = useState<string>('INR');
  const [description, setDescription] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [newFriendEmail, setNewFriendEmail] = useState('');
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [participantError, setParticipantError] = useState('');
  const [category, setCategory] = useState('Other');

  // Split mode: equal vs unequal/custom
  const [splitMode, setSplitMode] = useState<'equal' | 'unequal'>('equal');
  const [customShares, setCustomShares] = useState<{ [userId: string]: string }>({});
  const [customShareError, setCustomShareError] = useState('');

  // OCR items for review/edit
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([]);
  const [showOcrItems, setShowOcrItems] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Financial breakdown from OCR
  const ocrFinancials = (() => {
    try {
      return ocrFinancialsRaw ? JSON.parse(ocrFinancialsRaw) : null;
    } catch {
      return null;
    }
  })();

  // Whether this screen was opened from OCR scan
  const isFromOcr = !!(scannedTitle || scannedAmount || ocrConfidence);

  // Load scanned items from context when coming from OCR
  useEffect(() => {
    if (scannedItems && scannedItems.length > 0 && isFromOcr) {
      const items: OcrItem[] = scannedItems.map((item: any) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity || null,
        unitPrice: item.unitPrice || null,
      }));
      setOcrItems(items);
      setShowOcrItems(true);
    }
  }, []);

  useEffect(() => {
    if (groupId) {
      fetchGroupMembers();
    } else {
      fetchFriends();
    }
  }, [groupId]);

  // Pre-select friend if friendId param is provided
  useEffect(() => {
    if (friendId && friends.length > 0) {
      setSelectedFriendIds([friendId]);
    }
  }, [friendId, friends]);

  // Load bill data for edit mode
  useEffect(() => {
    if (billId) {
      setIsEditMode(true);
      fetchBillForEdit(billId);
    }
  }, [billId]);

  const fetchBillForEdit = async (id: string) => {
    try {
      setIsLoading(true);
      const response = await apiClient.get(`/bills/${id}`);
      const bill = response.data;

      setTitle(bill.title || '');
      setAmount(bill.totalAmount ? String(bill.totalAmount) : '');
      if (bill.currency) {
        setCurrency(bill.currency.toUpperCase().trim());
      }
      if (bill.baseCurrency) {
        setGroupBaseCurrency(bill.baseCurrency.toUpperCase().trim());
      }
      if (bill.category) {
        setCategory(bill.category);
      }

      // Collect all unique participant IDs from items
      const participantIds = new Set<string>();
      bill.items?.forEach((item: any) => {
        item.sharedByUserIds?.forEach((uid: string) => participantIds.add(uid));
      });

      // Remove current user from selected friends (they're always included)
      const friendIds = Array.from(participantIds).filter((uid) => uid !== user?.id);
      setSelectedFriendIds(friendIds);

      // If the bill has a groupId, fetch group members
      if (bill.groupId) {
        try {
          const membersResponse = await apiClient.get(`/groups/${bill.groupId}/members`);
          setFriends(membersResponse.data);
        } catch (error) {
          console.error('Error fetching group members for edit:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching bill for edit:', error);
      Alert.alert('Error', 'Failed to load bill for editing');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGroupMembers = async () => {
    if (!groupId) return;
    
    try {
      setIsLoadingFriends(true);
      const [membersResponse, groupResponse] = await Promise.all([
        apiClient.get(`/groups/${groupId}/members`),
        apiClient.get(`/groups/${groupId}`).catch(() => null),
      ]);
      const members = membersResponse.data;
      setFriends(members);
      setSelectedFriendIds(members.map((m: Friend) => m.id));
      if (groupResponse?.data?.defaultCurrency) {
        const gCurr = groupResponse.data.defaultCurrency.toUpperCase().trim();
        if (!params.currency && !scannedCurrency) {
          setCurrency(gCurr);
        }
      }
      setGroupBaseCurrency('INR');
    } catch (error) {
      console.error('Error fetching group members:', error);
    } finally {
      setIsLoadingFriends(false);
    }
  };

  const fetchFriends = async () => {
    try {
      setIsLoadingFriends(true);
      const response = await apiClient.get('/users/me/friends');
      setFriends(response.data);
    } catch (error) {
      console.error('Error fetching friends:', error);
    } finally {
      setIsLoadingFriends(false);
    }
  };

  const toggleFriendSelection = (friendId: string) => {
    setSelectedFriendIds(prev => 
      prev.includes(friendId)
        ? prev.filter(id => id !== friendId)
        : [...prev, friendId]
    );
  };

  const handleAddFriend = async () => {
    if (!newFriendEmail.trim()) return;

    try {
      const response = await apiClient.post('/users/me/friends', {
        email: newFriendEmail.trim() 
      });
      
      setFriends(prev => [...prev, response.data]);
      setNewFriendEmail('');
    } catch (error) {
      console.error('Error adding friend:', error);
      Alert.alert('Error', 'Failed to add friend. Please try again.');
    }
  };

  // OCR item editing handlers
  const syncItemsToContext = (items: OcrItem[]) => {
    setScannedItems(items.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      selected: true,
      sharedByUserIds: [],
    })));
  };

  const updateOcrItemName = (itemId: string, newName: string) => {
    setOcrItems(prev => {
      const next = prev.map(item =>
        item.id === itemId ? { ...item, name: newName } : item
      );
      syncItemsToContext(next);
      return next;
    });
  };

  const updateOcrItemPrice = (itemId: string, newPriceStr: string) => {
    const newPrice = parseFloat(newPriceStr) || 0;
    setOcrItems(prev => {
      const next = prev.map(item =>
        item.id === itemId ? { ...item, price: newPrice } : item
      );
      syncItemsToContext(next);
      return next;
    });
  };

  const updateOcrItemQty = (itemId: string, newQtyStr: string) => {
    const newQty = parseFloat(newQtyStr) || null;
    setOcrItems(prev => {
      const next = prev.map(item =>
        item.id === itemId ? { ...item, quantity: newQty } : item
      );
      syncItemsToContext(next);
      return next;
    });
  };

  const removeOcrItem = (itemId: string) => {
    setOcrItems(prev => {
      const next = prev.filter(item => item.id !== itemId);
      syncItemsToContext(next);
      return next;
    });
  };

  const recalculateTotalFromItems = () => {
    const sum = ocrItems.reduce((acc, item) => acc + (item.price || 0), 0);
    setAmount(String(Math.round(sum * 100) / 100));
  };

  const isGroupMode = !!groupId;

  // Active participants list
  // In group mode, all group members (including the user) are in the selection list.
  // The user can select any subset (e.g. only Nidhi, 2 participants, or all 4).
  // In direct friends mode (outside a group), user is always included with selected friends.
  const activeParticipantIds = useMemo(() => {
    if (isGroupMode) {
      return Array.from(new Set(selectedFriendIds.filter(Boolean) as string[]));
    }
    return Array.from(new Set([user?.id, ...selectedFriendIds].filter(Boolean) as string[]));
  }, [isGroupMode, user?.id, selectedFriendIds]);

  const getParticipantName = (uid: string) => {
    if (uid === user?.id) return 'You';
    const found = friends.find(f => f.id === uid);
    return found ? found.fullName : `User ${uid.slice(0, 4)}`;
  };

  const getParticipantAvatar = (uid: string) => {
    if (uid === user?.id) return user.profilePictureUrl;
    const found = friends.find(f => f.id === uid);
    return found ? found.profilePictureUrl : undefined;
  };

  const handleSplitModeChange = (mode: 'equal' | 'unequal') => {
    setSplitMode(mode);
    setCustomShareError('');
    if (mode === 'unequal' && activeParticipantIds.length > 0) {
      const total = parseFloat(amount) || 0;
      const initial = splitEquallyDeterministically(total, activeParticipantIds, user?.id);
      const newShares: { [userId: string]: string } = {};
      for (const uid of activeParticipantIds) {
        newShares[uid] = initial[uid] !== undefined ? initial[uid].toFixed(2) : '0.00';
      }
      setCustomShares(newShares);
    }
  };

  const handleCustomShareChange = (uid: string, text: string) => {
    setCustomShares(prev => ({
      ...prev,
      [uid]: text,
    }));
    setCustomShareError('');
  };

  // Custom share validation
  const customValidation = useMemo(() => {
    if (splitMode !== 'unequal') {
      return { isValid: true, sum: 0, difference: 0 };
    }
    const total = parseFloat(amount) || 0;
    const numericShares: Record<string, number> = {};
    for (const uid of activeParticipantIds) {
      numericShares[uid] = parseFloat(customShares[uid] || '0') || 0;
    }
    return validateCustomShares(numericShares, total, getCurrencySymbol(currency));
  }, [splitMode, amount, activeParticipantIds, customShares, currency]);

  // Live breakdown computation for UI preview
  const liveBreakdown = useMemo(() => {
    const total = parseFloat(amount);
    if (!amount || isNaN(total) || total <= 0 || !user || activeParticipantIds.length === 0) {
      return null;
    }

    if (splitMode === 'unequal') {
      const numericShares: Record<string, number> = {};
      for (const uid of activeParticipantIds) {
        numericShares[uid] = parseFloat(customShares[uid] || '0') || 0;
      }
      return calculateBillBreakdown(total, user.id, activeParticipantIds, undefined, numericShares);
    } else {
      return calculateBillBreakdown(total, user.id, activeParticipantIds);
    }
  }, [amount, activeParticipantIds, user, splitMode, customShares]);

  const handleSave = async () => {
    // Clear previous errors
    setTitleError('');
    setAmountError('');
    setParticipantError('');
    setCustomShareError('');

    // Validation
    let hasError = false;

    if (!title.trim()) {
      setTitleError('Title is required');
      hasError = true;
    }

    const totalAmount = parseFloat(amount);
    if (!amount || isNaN(totalAmount) || totalAmount <= 0) {
      setAmountError('Please enter a valid positive amount');
      hasError = true;
    }

    const sharedByUserIds = activeParticipantIds;
    if (sharedByUserIds.length === 0) {
      setParticipantError('At least one participant must be selected');
      hasError = true;
    }

    if (splitMode === 'unequal') {
      if (!customValidation.isValid) {
        const msg = customValidation.message || 'Custom shares must equal the total bill amount';
        setCustomShareError(msg);
        Alert.alert('Invalid Custom Split', msg);
        hasError = true;
      }
    }

    if (hasError || !user) return;

    setIsLoading(true);

    try {
      // Build items list: use custom shares if unequal, OCR items if available, otherwise single item
      let items;
      if (splitMode === 'unequal') {
        const numericCustomShares: Record<string, number> = {};
        for (const uid of sharedByUserIds) {
          numericCustomShares[uid] = parseFloat(customShares[uid] || '0') || 0;
        }
        items = [
          {
            name: title.trim(),
            price: totalAmount,
            sharedByUserIds,
            customShares: numericCustomShares,
          }
        ];
      } else if (ocrItems.length > 0) {
        const itemsSum = ocrItems.reduce((s, i) => s + (i.price || 0), 0);
        const diff = Math.round((totalAmount - itemsSum) * 100) / 100;
        if (diff > 0.05) {
          // Extra charges/tax exist on receipt not represented as separate items
          items = [
            ...ocrItems.map((item) => ({
              name: item.name,
              price: item.price,
              sharedByUserIds,
            })),
            {
              name: 'Taxes, Tips & Other Charges',
              price: diff,
              sharedByUserIds,
            },
          ];
        } else if (diff < -0.05) {
          // Items sum exceeds total (e.g. discount applied to total), represent as unified bill item
          items = [
            {
              name: title.trim(),
              price: totalAmount,
              sharedByUserIds,
            },
          ];
        } else {
          items = ocrItems.map((item) => ({
            name: item.name,
            price: item.price,
            sharedByUserIds,
          }));
        }
      } else {
        items = [
          {
            name: title.trim(),
            price: totalAmount,
            sharedByUserIds,
          }
        ];
      }

      const billData: any = {
        title: title.trim(),
        totalAmount: totalAmount,
        paidBy: user.id,
        items,
        currency: currency.toUpperCase().trim(),
        baseCurrency: 'INR',
        category,
      };

      if (receiptUrl) {
        billData.receiptUrl = receiptUrl;
      }

      if (groupId) {
        billData.groupId = groupId;
        billData.participantIds = sharedByUserIds;
      } else {
        billData.groupId = null;
        billData.participantIds = sharedByUserIds;
      }

      if (isEditMode && billId) {
        // Update existing bill
        const response = await apiClient.put(`/bills/${billId}`, billData);
        DeviceEventEmitter.emit('bill:updated', { groupId, bill: response.data || billData });
        router.back();
      } else {
        // Create new bill
        const response = await apiClient.post('/bills', billData);
        const createdBill = response.data;
        DeviceEventEmitter.emit('bill:created', { groupId, bill: createdBill });

        if (groupId) {
          // Navigate back to group detail screen
          router.replace({ pathname: '/group/[id]', params: { id: groupId } });
        } else {
          // Navigate to Dashboard
          router.replace('/(tabs)');
        }
      }
    } catch (error) {
      console.error('Error saving bill:', error);
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


  const getConfidenceColor = () => {
    switch (ocrConfidence) {
      case 'HIGH': return theme.colors.success;
      case 'MEDIUM': return '#D4A017';
      case 'LOW': return theme.colors.danger;
      default: return theme.colors.textSecondary;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditMode ? 'Edit Details' : 'Enter Details'}</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* OCR Confidence Banner */}
        {isFromOcr && ocrConfidence && (
          <View style={[styles.confidenceBanner, { borderLeftColor: getConfidenceColor() }]}>
            {ocrConfidence !== 'HIGH' && (
              <AlertTriangle size={16} color={getConfidenceColor()} />
            )}
            <Text style={[styles.confidenceText, { color: getConfidenceColor() }]}>
              {ocrConfidence === 'HIGH'
                ? '✓ OCR confidence: High — please verify details'
                : ocrConfidence === 'MEDIUM'
                ? 'OCR confidence: Medium — some values may need correction'
                : 'OCR confidence: Low — values are unreliable, please verify all fields'}
            </Text>
          </View>
        )}

        <View style={styles.formSection}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Title *</Text>
            <TextInput
              style={[styles.input, titleError && styles.inputError]}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Dinner at Taj"
              placeholderTextColor={theme.colors.textSecondary}
            />
            {titleError ? <Text style={styles.errorText}>{titleError}</Text> : null}
          </View>

          <View style={styles.inputContainer}>
            <View style={styles.inputLabelRow}>
              <Text style={styles.inputLabel}>Amount *</Text>
              {currency !== groupBaseCurrency && (
                <Text style={styles.baseCurrencyBadge}>
                  Base: {groupBaseCurrency}
                </Text>
              )}
            </View>
            <View style={styles.amountInputContainer}>
              <TouchableOpacity
                style={styles.currencySelectorPill}
                onPress={() => setIsCurrencyModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.currencyFlagText}>{getCurrencyConfig(currency).flag}</Text>
                <Text style={styles.currencySelectorCode}>{currency}</Text>
                <Text style={styles.currencySelectorSymbol}>({getCurrencySymbol(currency)})</Text>
                <ChevronDown size={14} color={theme.colors.textSecondary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.amountInput, amountError && styles.amountInputError]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="numeric"
              />
            </View>
            {currency !== groupBaseCurrency && parseFloat(amount) > 0 ? (
              <View style={styles.conversionPreviewCard}>
                <Text style={styles.conversionPreviewText}>
                  ≈ {formatMoney(parseFloat(amount) * getApproximateRate(currency, groupBaseCurrency), groupBaseCurrency, true)}
                </Text>
                <Text style={styles.conversionRateText}>
                  (1 {currency} = {getApproximateRate(currency, groupBaseCurrency)} {groupBaseCurrency})
                </Text>
              </View>
            ) : null}
            {amountError ? <Text style={styles.errorText}>{amountError}</Text> : null}
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Add any additional details..."
              placeholderTextColor={theme.colors.textSecondary}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Category Picker */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {EXPENSE_CATEGORIES.map((cat) => {
                const isSelected = category === cat.key;
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      styles.categoryChip,
                      isSelected && { backgroundColor: cat.tint, borderColor: cat.color },
                    ]}
                    onPress={() => setCategory(cat.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.categoryChipEmoji}>{cat.emoji}</Text>
                    <Text
                      style={[
                        styles.categoryChipText,
                        isSelected && { color: cat.color, fontWeight: '700' },
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Date</Text>
            <View style={styles.dateDisplay}>
              <Text style={styles.dateText}>{today}</Text>
            </View>
          </View>
        </View>

        {/* OCR Scanned Items Section */}
        {isFromOcr && ocrItems.length > 0 && (
          <View style={styles.ocrSection}>
            <TouchableOpacity
              style={styles.ocrSectionHeader}
              onPress={() => setShowOcrItems(!showOcrItems)}
              activeOpacity={0.7}>
              <Text style={styles.sectionTitle}>
                Scanned Items ({ocrItems.length})
              </Text>
              {showOcrItems ? (
                <ChevronUp size={20} color={theme.colors.textSecondary} />
              ) : (
                <ChevronDown size={20} color={theme.colors.textSecondary} />
              )}
            </TouchableOpacity>

            {showOcrItems && (
              <View style={styles.ocrItemsList}>
                {ocrItems.map((item) => (
                  <View key={item.id} style={styles.ocrItemCard}>
                    {editingItemId === item.id ? (
                      /* Editing mode */
                      <View style={styles.ocrItemEditContainer}>
                        <TextInput
                          style={styles.ocrItemNameInput}
                          value={item.name}
                          onChangeText={(text) => updateOcrItemName(item.id, text)}
                          placeholder="Item name"
                          placeholderTextColor={theme.colors.textSecondary}
                        />
                        <View style={styles.ocrItemEditRow}>
                          {item.quantity !== null && (
                            <View style={styles.ocrItemEditField}>
                              <Text style={styles.ocrItemEditLabel}>Qty</Text>
                              <TextInput
                                style={styles.ocrItemSmallInput}
                                value={item.quantity !== null ? String(item.quantity) : ''}
                                onChangeText={(text) => updateOcrItemQty(item.id, text)}
                                keyboardType="numeric"
                              />
                            </View>
                          )}
                          <View style={[styles.ocrItemEditField, { flex: 1 }]}>
                            <Text style={styles.ocrItemEditLabel}>Price</Text>
                            <TextInput
                              style={styles.ocrItemSmallInput}
                              value={String(item.price)}
                              onChangeText={(text) => updateOcrItemPrice(item.id, text)}
                              keyboardType="numeric"
                            />
                          </View>
                        </View>
                        <View style={styles.ocrItemEditActions}>
                          <TouchableOpacity
                            style={styles.ocrItemDoneBtn}
                            onPress={() => setEditingItemId(null)}>
                            <Text style={styles.ocrItemDoneBtnText}>Done</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.ocrItemRemoveBtn}
                            onPress={() => removeOcrItem(item.id)}>
                            <Text style={styles.ocrItemRemoveBtnText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      /* Display mode */
                      <TouchableOpacity
                        style={styles.ocrItemDisplay}
                        onPress={() => setEditingItemId(item.id)}
                        activeOpacity={0.7}>
                        <View style={styles.ocrItemInfo}>
                          <Text style={styles.ocrItemName}>{item.name}</Text>
                          {item.quantity !== null && (
                            <Text style={styles.ocrItemQty}>
                              Qty: {item.quantity}
                              {item.unitPrice !== null ? ` × ${getCurrencySymbol(currency)}${item.unitPrice}` : ''}
                            </Text>
                          )}
                        </View>
                        <View style={styles.ocrItemRight}>
                          <Text style={styles.ocrItemPrice}>{getCurrencySymbol(currency)}{item.price}</Text>
                          <Edit3 size={14} color={theme.colors.textSecondary} />
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                {/* Recalculate total from items */}
                <TouchableOpacity
                  style={styles.recalcButton}
                  onPress={recalculateTotalFromItems}>
                  <Text style={styles.recalcButtonText}>
                    Use item total ({formatMoney(Math.round(ocrItems.reduce((s, i) => s + (i.price || 0), 0) * 100) / 100, currency)})
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* OCR Financial Breakdown */}
        {isFromOcr && ocrFinancials && (
          <View style={styles.financialSection}>
            <Text style={styles.financialTitle}>Receipt Breakdown</Text>
            {ocrFinancials.subtotal && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Subtotal</Text>
                <Text style={styles.financialValue}>{getCurrencySymbol(currency)}{ocrFinancials.subtotal}</Text>
              </View>
            )}
            {ocrFinancials.cgst && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>CGST</Text>
                <Text style={styles.financialValue}>{getCurrencySymbol(currency)}{ocrFinancials.cgst}</Text>
              </View>
            )}
            {ocrFinancials.sgst && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>SGST</Text>
                <Text style={styles.financialValue}>{getCurrencySymbol(currency)}{ocrFinancials.sgst}</Text>
              </View>
            )}
            {ocrFinancials.tax && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Tax</Text>
                <Text style={styles.financialValue}>{getCurrencySymbol(currency)}{ocrFinancials.tax}</Text>
              </View>
            )}
            {ocrFinancials.serviceCharge && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Service Charge</Text>
                <Text style={styles.financialValue}>{getCurrencySymbol(currency)}{ocrFinancials.serviceCharge}</Text>
              </View>
            )}
            {ocrFinancials.discount && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Discount</Text>
                <Text style={[styles.financialValue, { color: theme.colors.success }]}>
                  -{getCurrencySymbol(currency)}{Math.abs(ocrFinancials.discount)}
                </Text>
              </View>
            )}
            {ocrFinancials.roundOff && (
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Round Off</Text>
                <Text style={styles.financialValue}>{getCurrencySymbol(currency)}{ocrFinancials.roundOff}</Text>
              </View>
            )}
          </View>
        )}

        {/* Split With Section */}
        {isGroupMode ? (
          <View style={styles.splitSection}>
            <Text style={styles.sectionTitle}>Split with group members</Text>
            <Text style={styles.sectionSubtitle}>All members are included by default</Text>
            
            <View style={styles.friendsSection}>
              {isLoadingFriends ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
              ) : (
                <View style={styles.friendList}>
                  {friends.map((friend) => (
                    <TouchableOpacity
                      key={friend.id}
                      style={styles.friendItem}
                      onPress={() => toggleFriendSelection(friend.id)}
                      activeOpacity={0.7}>
                      <View style={styles.friendInfo}>
                        <View style={styles.friendAvatar}>
                          {friend.profilePictureUrl ? (
                            <Image
                              key={friend.profilePictureUrl}
                              source={{ uri: friend.profilePictureUrl }}
                              style={styles.friendAvatarImage}
                              resizeMode="cover"
                              onError={(e) => console.log('[DEBUG] Friend avatar failed to load:', e.nativeEvent?.error)}
                            />
                          ) : (
                            <Text style={styles.friendAvatarText}>
                              {friend.fullName.charAt(0)}
                            </Text>
                          )}
                        </View>
                        <View style={styles.friendDetails}>
                          <Text style={styles.friendName}>{friend.fullName}</Text>
                          <Text style={styles.friendEmail}>{friend.email}</Text>
                        </View>
                      </View>
                      <View style={[styles.checkbox, selectedFriendIds.includes(friend.id) && styles.checkboxSelected]}>
                        {selectedFriendIds.includes(friend.id) && (
                          <Check size={16} color={theme.colors.cream} />
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            {participantError ? <Text style={styles.errorText}>{participantError}</Text> : null}
          </View>
        ) : (
          <View style={styles.splitSection}>
            <Text style={styles.sectionTitle}>Split with</Text>
            
            <View style={styles.friendsSection}>
              {isLoadingFriends ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
              ) : friends.length === 0 ? (
                <View style={styles.noFriendsContainer}>
                  <Text style={styles.noFriendsText}>Add friends first to split expenses</Text>
                  
                  <View style={styles.addFriendContainer}>
                    <TextInput
                      style={styles.addFriendInput}
                      value={newFriendEmail}
                      onChangeText={setNewFriendEmail}
                      placeholder="Enter friend's email"
                      placeholderTextColor={theme.colors.textSecondary}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={styles.addFriendButton}
                      onPress={handleAddFriend}
                      disabled={!newFriendEmail.trim()}>
                      <Text style={styles.addFriendButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.friendList}>
                  {friends.map((friend) => (
                    <TouchableOpacity
                      key={friend.id}
                      style={styles.friendItem}
                      onPress={() => toggleFriendSelection(friend.id)}
                      activeOpacity={0.7}>
                      <View style={styles.friendInfo}>
                        <View style={styles.friendAvatar}>
                          {friend.profilePictureUrl ? (
                            <Image
                              key={friend.profilePictureUrl}
                              source={{ uri: friend.profilePictureUrl }}
                              style={styles.friendAvatarImage}
                              resizeMode="cover"
                              onError={(e) => console.log('[DEBUG] Friend avatar failed to load:', e.nativeEvent?.error)}
                            />
                          ) : (
                            <Text style={styles.friendAvatarText}>
                              {friend.fullName.charAt(0)}
                            </Text>
                          )}
                        </View>
                        <View style={styles.friendDetails}>
                          <Text style={styles.friendName}>{friend.fullName}</Text>
                          <Text style={styles.friendEmail}>{friend.email}</Text>
                        </View>
                      </View>
                      <View style={[styles.checkbox, selectedFriendIds.includes(friend.id) && styles.checkboxSelected]}>
                        {selectedFriendIds.includes(friend.id) && (
                          <Check size={16} color={theme.colors.cream} />
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Split Method & Live Breakdown Section */}
        {activeParticipantIds.length > 0 && parseFloat(amount) > 0 && (
          <View style={styles.splitConfigSection}>
            <Text style={styles.sectionTitle}>Split Method</Text>
            <View style={styles.splitModeSelector}>
              <TouchableOpacity
                style={[
                  styles.splitModeBtn,
                  splitMode === 'equal' && styles.splitModeBtnActive,
                ]}
                onPress={() => handleSplitModeChange('equal')}>
                <Text
                  style={[
                    styles.splitModeBtnText,
                    splitMode === 'equal' && styles.splitModeBtnTextActive,
                  ]}>
                  Equal Split
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.splitModeBtn,
                  splitMode === 'unequal' && styles.splitModeBtnActive,
                ]}
                onPress={() => handleSplitModeChange('unequal')}>
                <Text
                  style={[
                    styles.splitModeBtnText,
                    splitMode === 'unequal' && styles.splitModeBtnTextActive,
                  ]}>
                  Unequal / Custom
                </Text>
              </TouchableOpacity>
            </View>

            {/* Custom share inputs when splitMode is unequal */}
            {splitMode === 'unequal' && (
              <View style={styles.customSharesContainer}>
                <Text style={styles.customSharesHeader}>Enter individual shares:</Text>
                {activeParticipantIds.map((uid) => (
                  <View key={uid} style={styles.customShareRow}>
                    <View style={styles.customShareParticipant}>
                      <View style={styles.customShareAvatar}>
                        <Text style={styles.customShareAvatarText}>
                          {getParticipantName(uid).charAt(0)}
                        </Text>
                      </View>
                      <Text style={styles.customShareName}>
                        {uid === user?.id ? 'You' : getParticipantName(uid)}
                      </Text>
                    </View>
                    <View style={styles.customShareInputWrap}>
                      <Text style={styles.currencySymbolSmall}>{getCurrencySymbol(currency)}</Text>
                      <TextInput
                        style={styles.customShareInput}
                        value={customShares[uid] || ''}
                        onChangeText={(t) => handleCustomShareChange(uid, t)}
                        placeholder="0.00"
                        placeholderTextColor={theme.colors.textSecondary}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                ))}

                {/* Validation Status Badge */}
                <View
                  style={[
                    styles.validationBadge,
                    customValidation.isValid
                      ? styles.validationBadgeSuccess
                      : customValidation.difference > 0
                      ? styles.validationBadgeWarning
                      : styles.validationBadgeDanger,
                  ]}>
                  <Text
                    style={[
                      styles.validationBadgeText,
                      customValidation.isValid
                        ? styles.validationTextSuccess
                        : customValidation.difference > 0
                        ? styles.validationTextWarning
                        : styles.validationTextDanger,
                    ]}>
                    {customValidation.isValid
                      ? `✓ Shares match bill total (${formatMoney(customValidation.sum, currency)})`
                      : customValidation.message}
                  </Text>
                </View>
                {customShareError ? (
                  <Text style={styles.errorText}>{customShareError}</Text>
                ) : null}
              </View>
            )}

            {/* Live Expense Breakdown Preview */}
            {liveBreakdown && (
              <View style={styles.liveBreakdownCard}>
                <View style={styles.breakdownHeaderRow}>
                  <Text style={styles.liveBreakdownTitle}>Live Expense Breakdown</Text>
                  <Text style={styles.liveBreakdownSubtitle}>Deterministic · 100% Reconciled</Text>
                </View>

                {/* Top Summary Bar */}
                <View style={styles.breakdownSummaryBar}>
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillLabel}>Total Bill</Text>
                    <Text style={styles.summaryPillValue}>{formatMoney(liveBreakdown.totalAmount, currency)}</Text>
                  </View>
                  <View style={styles.summaryPillDivider} />
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillLabel}>Paid By</Text>
                    <Text style={styles.summaryPillValue}>You</Text>
                  </View>
                  <View style={styles.summaryPillDivider} />
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillLabel}>Participants</Text>
                    <Text style={styles.summaryPillValue}>{liveBreakdown.participantCount} people</Text>
                  </View>
                </View>

                {/* Participant breakdown items */}
                <View style={styles.breakdownList}>
                  {liveBreakdown.participants.map((p, idx) => {
                    const isPayer = p.userId === liveBreakdown.paidBy;
                    const isCurrentUser = p.userId === user?.id;
                    const pName = isCurrentUser ? 'You' : getParticipantName(p.userId);
                    return (
                      <View key={p.userId}>
                        <View style={styles.breakdownParticipantRow}>
                          <View style={styles.breakdownParticipantLeft}>
                            <View
                              style={[
                                styles.breakdownAvatar,
                                {
                                  backgroundColor: isCurrentUser
                                    ? theme.colors.primary
                                    : theme.colors.success,
                                },
                              ]}>
                              <Text style={styles.breakdownAvatarText}>{pName.charAt(0)}</Text>
                            </View>
                            <View style={styles.breakdownNameCol}>
                              <Text style={styles.breakdownNameText}>
                                {pName} {isPayer ? '(Payer)' : ''}
                              </Text>
                              <Text style={styles.breakdownMetaText}>
                                Paid: {formatMoney(p.paidAmount, currency)} · Share: {formatMoney(p.shareAmount, currency)}
                              </Text>
                            </View>
                          </View>

                          <View
                            style={[
                              styles.netAmountBadge,
                              p.netAmount > 0
                                ? styles.netBadgePositive
                                : p.netAmount < 0
                                ? styles.netBadgeNegative
                                : styles.netBadgeZero,
                            ]}>
                            <Text
                              style={[
                                styles.netAmountText,
                                p.netAmount > 0
                                  ? styles.netTextPositive
                                  : p.netAmount < 0
                                  ? styles.netTextNegative
                                  : styles.netTextZero,
                              ]}>
                              {p.netAmount > 0
                                ? `+${formatMoney(p.netAmount, currency)}`
                                : p.netAmount < 0
                                ? `-${formatMoney(Math.abs(p.netAmount), currency)}`
                                : formatMoney(0, currency)}
                            </Text>
                            <Text style={styles.netSubText}>
                              {p.netAmount > 0 ? 'receives' : p.netAmount < 0 ? 'owes' : 'settled'}
                            </Text>
                            {currency !== groupBaseCurrency && (
                              <Text style={styles.netConvertedSubText}>
                                ≈ {formatMoney(p.netAmount * getApproximateRate(currency, groupBaseCurrency), groupBaseCurrency)}
                              </Text>
                            )}
                          </View>
                        </View>
                        {idx < liveBreakdown.participants.length - 1 && (
                          <View style={styles.breakdownItemDivider} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isLoading}>
            {isLoading ? (
              <ActivityIndicator color={theme.colors.cream} />
            ) : (
              <Text style={styles.saveButtonText}>Save Expense</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Currency Picker Modal */}
      <CurrencyPickerModal
        visible={isCurrencyModalVisible}
        selectedCurrency={currency}
        onSelect={(newCurrency) => {
          setCurrency(newCurrency);
          setIsCurrencyModalVisible(false);
        }}
        onClose={() => setIsCurrencyModalVisible(false)}
      />
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
  // OCR Confidence Banner
  confidenceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
    marginHorizontal: theme.spacing[24],
    marginTop: theme.spacing[8],
    marginBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    borderLeftWidth: 3,
  },
  confidenceText: {
    fontSize: 13,
    fontFamily: theme.fontFamily.regular,
    flex: 1,
  },
  formSection: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  inputContainer: {
    marginBottom: theme.spacing[16],
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    fontSize: 16,
    color: theme.colors.textPrimary,
    paddingVertical: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  inputError: {
    borderBottomColor: theme.colors.danger,
  },
  amountInputError: {
    color: theme.colors.danger,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 12,
    marginTop: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  textArea: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    fontSize: 16,
    color: theme.colors.textPrimary,
    paddingVertical: theme.spacing[8],
    minHeight: 80,
    textAlignVertical: 'top',
    fontFamily: theme.fontFamily.regular,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing[8],
  },
  currencySymbol: {
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginRight: theme.spacing[8],
    fontFamily: theme.fontFamily.mono,
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  dateDisplay: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing[8],
  },
  dateText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  // OCR Items Section
  ocrSection: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  ocrSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ocrItemsList: {
    marginTop: theme.spacing[12],
  },
  ocrItemCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    marginBottom: theme.spacing[8],
    overflow: 'hidden',
  },
  ocrItemDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing[12],
  },
  ocrItemInfo: {
    flex: 1,
    marginRight: theme.spacing[12],
  },
  ocrItemName: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  ocrItemQty: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontFamily: theme.fontFamily.regular,
  },
  ocrItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  ocrItemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  // OCR Item Edit Mode
  ocrItemEditContainer: {
    padding: theme.spacing[12],
  },
  ocrItemNameInput: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    fontSize: 14,
    color: theme.colors.textPrimary,
    paddingVertical: theme.spacing[4],
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  ocrItemEditRow: {
    flexDirection: 'row',
    gap: theme.spacing[12],
  },
  ocrItemEditField: {
    minWidth: 70,
  },
  ocrItemEditLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  ocrItemSmallInput: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    fontSize: 14,
    color: theme.colors.textPrimary,
    paddingVertical: theme.spacing[4],
    fontFamily: theme.fontFamily.mono,
  },
  ocrItemEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing[12],
    marginTop: theme.spacing[8],
  },
  ocrItemDoneBtn: {
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[4],
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
  },
  ocrItemDoneBtnText: {
    color: theme.colors.cream,
    fontSize: 13,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  ocrItemRemoveBtn: {
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[4],
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  ocrItemRemoveBtnText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  recalcButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    marginTop: theme.spacing[4],
  },
  recalcButtonText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  // Financial Breakdown
  financialSection: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  financialTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[4],
  },
  financialLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  financialValue: {
    fontSize: 13,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  // Split section
  splitSection: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[32],
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  toggleContainer: {
    flexDirection: 'row',
    gap: theme.spacing[12],
    marginBottom: theme.spacing[16],
  },
  toggleOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    paddingVertical: theme.spacing[12],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  toggleOptionSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + '10',
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  toggleText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  toggleTextSelected: {
    color: theme.colors.primary,
    fontWeight: '500',
  },
  friendsSection: {
    marginTop: theme.spacing[16],
  },
  friendList: {
    marginTop: theme.spacing[16],
  },
  loadingContainer: {
    paddingVertical: theme.spacing[24],
    alignItems: 'center',
  },
  noFriendsContainer: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: theme.spacing[16],
    alignItems: 'center',
  },
  noFriendsText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  addFriendContainer: {
    flexDirection: 'row',
    gap: theme.spacing[8],
    width: '100%',
  },
  addFriendInput: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    fontSize: 14,
    color: theme.colors.textPrimary,
    paddingVertical: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  addFriendButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[8],
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addFriendButtonText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: theme.spacing[12],
    marginBottom: theme.spacing[8],
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: theme.spacing[12],
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  friendAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  friendAvatarText: {
    color: theme.colors.cream,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  friendDetails: {
    flex: 1,
  },
  friendName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  friendEmail: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  buttonContainer: {
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[24],
  },
  saveButton: {
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
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  splitConfigSection: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[16],
    marginBottom: theme.spacing[8],
  },
  splitModeSelector: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 4,
    marginBottom: theme.spacing[16],
    gap: 4,
  },
  splitModeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  splitModeBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  splitModeBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  splitModeBtnTextActive: {
    color: theme.colors.cream,
    fontWeight: '600',
  },
  customSharesContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[16],
  },
  customSharesHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  customShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing[8],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  customShareParticipant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
    flex: 1,
  },
  customShareAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customShareAvatarText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '600',
  },
  customShareName: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  customShareInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    width: 110,
  },
  currencySymbolSmall: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginRight: 4,
  },
  customShareInput: {
    flex: 1,
    height: 36,
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
    paddingVertical: 0,
  },
  validationBadge: {
    marginTop: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[12],
    borderRadius: 8,
    alignItems: 'center',
  },
  validationBadgeSuccess: {
    backgroundColor: '#E8F5E9',
  },
  validationBadgeWarning: {
    backgroundColor: '#FFF8E1',
  },
  validationBadgeDanger: {
    backgroundColor: '#FFEBEE',
  },
  validationBadgeText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  validationTextSuccess: {
    color: '#2E7D32',
  },
  validationTextWarning: {
    color: '#F57F17',
  },
  validationTextDanger: {
    color: '#C62828',
  },
  liveBreakdownCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[16],
    marginBottom: theme.spacing[8],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  breakdownHeaderRow: {
    marginBottom: theme.spacing[12],
  },
  liveBreakdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  liveBreakdownSubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
    marginTop: 2,
  },
  breakdownSummaryBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: theme.spacing[16],
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryPill: {
    alignItems: 'center',
  },
  summaryPillLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  summaryPillValue: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  summaryPillDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.colors.border,
  },
  breakdownList: {
    gap: 8,
  },
  breakdownParticipantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  breakdownParticipantLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  breakdownAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  breakdownAvatarText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '600',
  },
  breakdownNameCol: {
    flex: 1,
  },
  breakdownNameText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  breakdownMetaText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontFamily: theme.fontFamily.regular,
  },
  netAmountBadge: {
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  netBadgePositive: {
    backgroundColor: '#E8F5E9',
  },
  netBadgeNegative: {
    backgroundColor: '#FFEBEE',
  },
  netBadgeZero: {
    backgroundColor: theme.colors.background,
  },
  netAmountText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: theme.fontFamily.regular,
  },
  netTextPositive: {
    color: '#2E7D32',
  },
  netTextNegative: {
    color: '#C62828',
  },
  netTextZero: {
    color: theme.colors.textSecondary,
  },
  netSubText: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  breakdownItemDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 4,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  baseCurrencyBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.primary,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    fontFamily: theme.fontFamily.regular,
  },
  currencySelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  currencyFlagText: {
    fontSize: 16,
  },
  currencySelectorCode: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  currencySelectorSymbol: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.mono,
  },
  conversionPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  conversionPreviewText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#166534',
    fontFamily: theme.fontFamily.regular,
  },
  conversionRateText: {
    fontSize: 11,
    color: '#15803D',
    fontFamily: theme.fontFamily.mono,
  },
  netConvertedSubText: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontFamily: theme.fontFamily.mono,
  },
  categoryScroll: {
    marginTop: 4,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    marginRight: 8,
  },
  categoryChipEmoji: {
    fontSize: 15,
  },
  categoryChipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
});