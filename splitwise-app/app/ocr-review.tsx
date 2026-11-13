import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  Info,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Calculator,
  ChevronDown,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBillCreation, BillItem } from '../context/BillCreationContext';
import {
  SUPPORTED_CURRENCIES,
  getCurrencyConfig,
  getCurrencySymbol,
  formatMoney,
} from '@/constants/currencies';
import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';

interface EditableItem {
  id: string;
  name: string;
  price: string;
  quantity: string;
  unitPrice: string;
}

export default function OcrReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { setScannedItems, setReceiptUrl: setContextReceiptUrl } = useBillCreation();

  // Parse raw scan data passed from scan-bill
  const rawScanData = useMemo(() => {
    try {
      return params.rawScanData ? JSON.parse(params.rawScanData as string) : {};
    } catch {
      return {};
    }
  }, [params.rawScanData]);

  const receiptUrl = (params.receiptUrl as string) || rawScanData.receiptUrl || null;
  const localImageUri = (params.localImageUri as string) || null;
  const previewImage = receiptUrl || localImageUri;
  const groupId = (params.groupId as string) || undefined;

  // Form states
  const [merchantTitle, setMerchantTitle] = useState(
    (params.scannedTitle as string) || rawScanData.suggestedTitle || 'Expense'
  );
  const [showImagePreview, setShowImagePreview] = useState(true);

  // Items state
  const [items, setItems] = useState<EditableItem[]>(() => {
    const sourceItems = rawScanData.items || [];
    if (sourceItems.length > 0) {
      return sourceItems.map((item: any, idx: number) => ({
        id: `item-${idx}-${Date.now()}`,
        name: item.name || item.description || `Item ${idx + 1}`,
        price: item.price != null ? String(item.price) : '0',
        quantity: item.quantity != null ? String(item.quantity) : '',
        unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
      }));
    }
    return [];
  });

  // Financial breakdown states
  const [subtotal, setSubtotal] = useState(
    rawScanData.subtotal != null ? String(rawScanData.subtotal) : ''
  );
  const [tax, setTax] = useState(
    rawScanData.tax != null
      ? String(rawScanData.tax)
      : rawScanData.cgst != null || rawScanData.sgst != null
      ? String(((rawScanData.cgst || 0) + (rawScanData.sgst || 0)).toFixed(2))
      : ''
  );
  const [serviceCharge, setServiceCharge] = useState(
    rawScanData.serviceCharge != null ? String(rawScanData.serviceCharge) : ''
  );
  const [discount, setDiscount] = useState(
    rawScanData.discount != null ? String(rawScanData.discount) : ''
  );
  const [tip, setTip] = useState(
    rawScanData.tip != null ? String(rawScanData.tip) : ''
  );
  const [roundOff, setRoundOff] = useState(
    rawScanData.roundOff != null ? String(rawScanData.roundOff) : ''
  );
  const [totalAmount, setTotalAmount] = useState(
    (params.scannedAmount as string) ||
      (rawScanData.totalAmount != null ? String(rawScanData.totalAmount) : '')
  );
  const [currency, setCurrency] = useState<string>(
    ((params.currency as string) || rawScanData.currency || 'INR').toUpperCase().trim()
  );
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);

  // Validation state (recalculated in real-time)
  const [validationStatus, setValidationStatus] = useState<
    'VALIDATED' | 'PARTIALLY_VALIDATED' | 'UNVERIFIED' | 'FAILED_VALIDATION'
  >(
    (rawScanData.validationStatus as any) ||
      (params.validationStatus as any) ||
      'UNVERIFIED'
  );
  const [validationMessage, setValidationMessage] = useState<string>(
    rawScanData.validationMessage || ''
  );

  // Sum of current items
  const itemsSum = useMemo(() => {
    return items.reduce((acc, curr) => {
      const p = parseFloat(curr.price);
      return acc + (isNaN(p) ? 0 : p);
    }, 0);
  }, [items]);

  // Recalculate validation status in real-time as user edits values
  useEffect(() => {
    const finalTotalNum = parseFloat(totalAmount);
    const subtotalNum = parseFloat(subtotal);
    const taxNum = parseFloat(tax) || 0;
    const scNum = parseFloat(serviceCharge) || 0;
    const discNum = parseFloat(discount) || 0;
    const tipNum = parseFloat(tip) || 0;
    const roNum = parseFloat(roundOff) || 0;

    if (isNaN(finalTotalNum) || finalTotalNum <= 0) {
      setValidationStatus('UNVERIFIED');
      setValidationMessage('Please enter a valid total amount.');
      return;
    }

    const tolerance = 1.05;

    // Case 1: Subtotal entered
    if (!isNaN(subtotalNum) && subtotalNum > 0) {
      const expectedTotal =
        Math.round((subtotalNum + taxNum + scNum - discNum + tipNum + roNum) * 100) /
        100;
      const diff = Math.abs(expectedTotal - finalTotalNum);
      const dynamicTol = Math.max(tolerance, finalTotalNum * 0.015);

      if (diff > dynamicTol) {
        setValidationStatus('FAILED_VALIDATION');
        setValidationMessage(
          `Detected total (${formatMoney(finalTotalNum, currency)}) does not match subtotal + taxes/charges (expected ${formatMoney(expectedTotal, currency)}). Please verify.`
        );
      } else {
        if (items.length > 0) {
          const itemDiff = Math.abs(itemsSum - subtotalNum);
          if (itemDiff <= Math.max(tolerance, subtotalNum * 0.02)) {
            setValidationStatus('VALIDATED');
            setValidationMessage('Receipt math fully verified: items match subtotal, and subtotal + charges match total.');
          } else {
            setValidationStatus('PARTIALLY_VALIDATED');
            setValidationMessage(
              `Receipt subtotal matches total (${formatMoney(finalTotalNum, currency)}), but sum of items (${formatMoney(itemsSum, currency)}) differs from printed subtotal (${formatMoney(subtotalNum, currency)}). Please verify items.`
            );
          }
        } else {
          setValidationStatus('PARTIALLY_VALIDATED');
          setValidationMessage('Subtotal and total match.');
        }
      }
      return;
    }

    // Case 2: Items exist without subtotal
    if (items.length > 0 && itemsSum > 0) {
      const expectedTotal =
        Math.round((itemsSum + taxNum + scNum - discNum + tipNum + roNum) * 100) /
        100;
      const diff = Math.abs(expectedTotal - finalTotalNum);
      const dynamicTol = Math.max(tolerance, finalTotalNum * 0.02);

      if (diff <= dynamicTol) {
        setValidationStatus('VALIDATED');
        setValidationMessage('Receipt math verified: items + taxes/charges match total.');
      } else {
        setValidationStatus('FAILED_VALIDATION');
        setValidationMessage(
          `Detected total (${formatMoney(finalTotalNum, currency)}) does not match items + taxes (expected ${formatMoney(expectedTotal, currency)}). Please verify.`
        );
      }
      return;
    }

    // Case 3: Only total exists
    setValidationStatus('UNVERIFIED');
    setValidationMessage('Total amount entered without breakdown. Please verify receipt details.');
  }, [totalAmount, subtotal, tax, serviceCharge, discount, tip, roundOff, items, itemsSum, currency]);

  // Item Handlers
  const handleAddItem = () => {
    const newItem: EditableItem = {
      id: `item-${Date.now()}`,
      name: '',
      price: '',
      quantity: '1',
      unitPrice: '',
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleUpdateItem = (id: string, field: keyof EditableItem, val: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: val };
        // Auto-calculate total price if qty and unitPrice are provided
        if ((field === 'quantity' || field === 'unitPrice') && updated.quantity && updated.unitPrice) {
          const q = parseFloat(updated.quantity);
          const u = parseFloat(updated.unitPrice);
          if (!isNaN(q) && !isNaN(u) && q > 0 && u > 0) {
            updated.price = (Math.round(q * u * 100) / 100).toFixed(2);
          }
        } else if (field === 'price' && updated.quantity) {
          const p = parseFloat(updated.price);
          const q = parseFloat(updated.quantity);
          if (!isNaN(p) && !isNaN(q) && q > 0) {
            updated.unitPrice = (Math.round((p / q) * 100) / 100).toFixed(2);
          }
        }
        return updated;
      })
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Recalculate Total from breakdown
  const handleAutoCalculateTotal = () => {
    const base = parseFloat(subtotal) || itemsSum || 0;
    const taxNum = parseFloat(tax) || 0;
    const scNum = parseFloat(serviceCharge) || 0;
    const discNum = parseFloat(discount) || 0;
    const tipNum = parseFloat(tip) || 0;
    const roNum = parseFloat(roundOff) || 0;
    const calculated = Math.round((base + taxNum + scNum - discNum + tipNum + roNum) * 100) / 100;
    setTotalAmount(calculated > 0 ? calculated.toFixed(2) : '');
  };

  // Confirm and continue to bill creation
  const handleConfirm = () => {
    const finalAmountNum = parseFloat(totalAmount);
    if (isNaN(finalAmountNum) || finalAmountNum <= 0) {
      Alert.alert('Invalid Amount', 'Please specify a valid total amount before continuing.');
      return;
    }

    if (!merchantTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a title or merchant name.');
      return;
    }

    // Convert confirmed editable items to BillItem format
    const confirmedBillItems: BillItem[] = items
      .filter((it) => it.name.trim() !== '' || parseFloat(it.price) > 0)
      .map((it, idx) => ({
        id: `item-${idx}-${Date.now()}`,
        name: it.name.trim() || `Item ${idx + 1}`,
        price: parseFloat(it.price) || 0,
        quantity: parseFloat(it.quantity) || null,
        unitPrice: parseFloat(it.unitPrice) || null,
        selected: true,
        sharedByUserIds: [],
      }));

    // If breakdown charges (tax, service charge, tip, round-off) exist and aren't already
    // represented as separate item lines, include them so items sum matches total amount
    const taxNum = parseFloat(tax) || 0;
    const scNum = parseFloat(serviceCharge) || 0;
    const tipNum = parseFloat(tip) || 0;
    const roNum = parseFloat(roundOff) || 0;

    const hasItemNamed = (kw: string) =>
      confirmedBillItems.some((it) => it.name.toLowerCase().includes(kw));

    if (confirmedBillItems.length > 0) {
      if (taxNum > 0 && !hasItemNamed('tax') && !hasItemNamed('gst')) {
        confirmedBillItems.push({
          id: `tax-${Date.now()}`,
          name: 'Tax / GST',
          price: taxNum,
          quantity: null,
          unitPrice: null,
          selected: true,
          sharedByUserIds: [],
        });
      }
      if (scNum > 0 && !hasItemNamed('service')) {
        confirmedBillItems.push({
          id: `sc-${Date.now()}`,
          name: 'Service Charge',
          price: scNum,
          quantity: null,
          unitPrice: null,
          selected: true,
          sharedByUserIds: [],
        });
      }
      if (tipNum > 0 && !hasItemNamed('tip') && !hasItemNamed('gratuity')) {
        confirmedBillItems.push({
          id: `tip-${Date.now()}`,
          name: 'Tip / Gratuity',
          price: tipNum,
          quantity: null,
          unitPrice: null,
          selected: true,
          sharedByUserIds: [],
        });
      }
      if (roNum > 0 && !hasItemNamed('round')) {
        confirmedBillItems.push({
          id: `ro-${Date.now()}`,
          name: 'Round Off',
          price: roNum,
          quantity: null,
          unitPrice: null,
          selected: true,
          sharedByUserIds: [],
        });
      }
    }

    // Update BillCreationContext
    setScannedItems(confirmedBillItems);
    if (receiptUrl) {
      setContextReceiptUrl(receiptUrl);
    }

    // Build confirmed financials payload
    const confirmedFinancials: any = {};
    if (subtotal) confirmedFinancials.subtotal = parseFloat(subtotal);
    if (tax) confirmedFinancials.tax = parseFloat(tax);
    if (serviceCharge) confirmedFinancials.serviceCharge = parseFloat(serviceCharge);
    if (discount) confirmedFinancials.discount = parseFloat(discount);
    if (tip) confirmedFinancials.tip = parseFloat(tip);
    if (roundOff) confirmedFinancials.roundOff = parseFloat(roundOff);

    // Navigate to manual-entry with USER-CONFIRMED values
    const navParams: any = {
      scannedTitle: merchantTitle.trim(),
      scannedAmount: finalAmountNum.toFixed(2),
      currency: currency,
      ocrConfidence: rawScanData.confidence || 'MEDIUM',
      validationStatus,
      receiptUrl: receiptUrl || '',
    };
    if (groupId) {
      navParams.groupId = groupId;
    }
    if (Object.keys(confirmedFinancials).length > 0) {
      navParams.ocrFinancials = JSON.stringify(confirmedFinancials);
    }

    router.push({
      pathname: '/manual-entry',
      params: navParams,
    });
  };

  // Helper styles based on validation status
  const getValidationBadge = () => {
    switch (validationStatus) {
      case 'VALIDATED':
        return {
          icon: <CheckCircle2 size={16} color={theme.colors.success} />,
          bg: '#E6F4EF',
          border: theme.colors.success,
          text: theme.colors.success,
          label: 'VALIDATED',
        };
      case 'FAILED_VALIDATION':
        return {
          icon: <AlertTriangle size={16} color={theme.colors.danger} />,
          bg: '#FEE2E2',
          border: theme.colors.danger,
          text: theme.colors.danger,
          label: 'FAILED VALIDATION',
        };
      case 'PARTIALLY_VALIDATED':
        return {
          icon: <Info size={16} color="#D97706" />,
          bg: '#FEF3C7',
          border: '#D97706',
          text: '#B45309',
          label: 'PARTIALLY VALIDATED',
        };
      default:
        return {
          icon: <Info size={16} color={theme.colors.textSecondary} />,
          bg: '#F3F4F6',
          border: theme.colors.border,
          text: theme.colors.textSecondary,
          label: 'UNVERIFIED',
        };
    }
  };

  const badge = getValidationBadge();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Receipt Review</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {/* Receipt Image Preview Accordion */}
        {previewImage && (
          <View style={styles.previewCard}>
            <TouchableOpacity
              style={styles.previewHeader}
              onPress={() => setShowImagePreview((prev) => !prev)}
              activeOpacity={0.8}>
              <View style={styles.previewTitleRow}>
                <Text style={styles.previewLabel}>Receipt Image</Text>
                <View
                  style={[
                    styles.badgeContainer,
                    { backgroundColor: badge.bg, borderColor: badge.border },
                  ]}>
                  {badge.icon}
                  <Text style={[styles.badgeText, { color: badge.text }]}>
                    {badge.label}
                  </Text>
                </View>
              </View>
              {showImagePreview ? (
                <EyeOff size={20} color={theme.colors.textSecondary} />
              ) : (
                <Eye size={20} color={theme.colors.textSecondary} />
              )}
            </TouchableOpacity>

            {showImagePreview && (
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: previewImage }}
                  style={styles.receiptImage}
                  resizeMode="contain"
                />
              </View>
            )}
          </View>
        )}

        {/* Validation Alert Banner */}
        <View
          style={[
            styles.bannerContainer,
            { backgroundColor: badge.bg, borderColor: badge.border },
          ]}>
          {badge.icon}
          <Text style={[styles.bannerText, { color: badge.text }]}>
            {validationMessage ||
              (validationStatus === 'VALIDATED'
                ? 'Receipt financial math validated.'
                : 'Please review all extracted values.')}
          </Text>
        </View>

        {/* Merchant / Suggested Title Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Merchant / Store Name</Text>
          <TextInput
            style={styles.titleInput}
            value={merchantTitle}
            onChangeText={setMerchantTitle}
            placeholder="e.g. Pizza Hut"
            placeholderTextColor={theme.colors.textSecondary}
          />
        </View>

        {/* Itemized Breakdown Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.cardTitle}>Items ({items.length})</Text>
              <Text style={styles.cardSubtitle}>
                Items Subtotal: {formatMoney(itemsSum, currency)}
                {!isNaN(parseFloat(subtotal)) && parseFloat(subtotal) > 0 && Math.abs(itemsSum - parseFloat(subtotal)) <= 0.05 && (
                  <Text style={styles.itemMatchNotice}> (Matches subtotal ✓)</Text>
                )}
              </Text>
              {!isNaN(parseFloat(subtotal)) && parseFloat(subtotal) > 0 && items.length > 0 && Math.abs(itemsSum - parseFloat(subtotal)) > 0.05 && (
                <Text style={styles.itemDiscrepancyNotice}>
                  Differs from printed subtotal ({formatMoney(parseFloat(subtotal), currency)})
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.addItemBtn}
              onPress={handleAddItem}
              activeOpacity={0.7}>
              <Plus size={16} color={theme.colors.primary} />
              <Text style={styles.addItemText}>Add Item</Text>
            </TouchableOpacity>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyItemsBox}>
              <Text style={styles.emptyItemsText}>
                No line items detected. You can add items or just specify the total.
              </Text>
            </View>
          ) : (
            items.map((item, idx) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <TextInput
                    style={styles.itemNameInput}
                    value={item.name}
                    onChangeText={(val) => handleUpdateItem(item.id, 'name', val)}
                    placeholder={`Item ${idx + 1}`}
                    placeholderTextColor={theme.colors.textSecondary}
                  />
                  {(item.quantity !== '' || item.unitPrice !== '') ? (
                    <View style={styles.itemSubRow}>
                      <Text style={styles.qtyLabel}>Qty:</Text>
                      <TextInput
                        style={styles.smallInput}
                        value={item.quantity}
                        onChangeText={(val) => handleUpdateItem(item.id, 'quantity', val)}
                        keyboardType="decimal-pad"
                        placeholder="1"
                        placeholderTextColor={theme.colors.textSecondary}
                      />
                      <Text style={styles.qtyLabel}>@ {getCurrencySymbol(currency)}</Text>
                      <TextInput
                        style={styles.smallInput}
                        value={item.unitPrice}
                        onChangeText={(val) => handleUpdateItem(item.id, 'unitPrice', val)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={theme.colors.textSecondary}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleUpdateItem(item.id, 'quantity', '1')}
                      style={styles.addQtyPill}
                      activeOpacity={0.7}>
                      <Text style={styles.addQtyPillText}>+ Qty</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.itemRight}>
                  <Text style={styles.currencyPrefix}>{getCurrencySymbol(currency)}</Text>
                  <TextInput
                    style={styles.itemPriceInput}
                    value={item.price}
                    onChangeText={(val) => handleUpdateItem(item.id, 'price', val)}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.colors.textSecondary}
                  />
                  <TouchableOpacity
                    onPress={() => handleRemoveItem(item.id)}
                    style={styles.deleteBtn}>
                    <Trash2 size={18} color={theme.colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Financial Breakdown Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Financial Breakdown</Text>
            <TouchableOpacity
              style={styles.calcBtn}
              onPress={handleAutoCalculateTotal}
              activeOpacity={0.7}>
              <Calculator size={15} color={theme.colors.primary} />
              <Text style={styles.calcBtnText}>Sync Total</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Subtotal</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>{getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={subtotal}
                onChangeText={setSubtotal}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Tax / GST</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>{getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={tax}
                onChangeText={setTax}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Service Charge / Admin Fee</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>{getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={serviceCharge}
                onChangeText={setServiceCharge}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Discount</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>- {getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={discount}
                onChangeText={setDiscount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Tip</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>{getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={tip}
                onChangeText={setTip}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Round Off</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.currencyPrefix}>{getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={roundOff}
                onChangeText={setRoundOff}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>

          {/* Grand Total Box */}
          <View style={styles.totalBox}>
            <View style={styles.totalHeaderRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.totalLabel}>Final Confirmed Total</Text>
                <Text style={styles.totalSubLabel}>Includes all charges and taxes</Text>
              </View>
              <TouchableOpacity
                style={styles.currencyPill}
                onPress={() => setIsCurrencyModalVisible(true)}
                activeOpacity={0.7}>
                <Text style={styles.currencyFlag}>{getCurrencyConfig(currency).flag}</Text>
                <Text style={styles.currencyCode}>{currency}</Text>
                <ChevronDown size={14} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.totalInputRow}>
              <Text style={styles.totalCurrency}>{getCurrencySymbol(currency)}</Text>
              <TextInput
                style={styles.totalInput}
                value={totalAmount}
                onChangeText={setTotalAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>
          </View>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          style={[styles.confirmButton, { marginBottom: Math.max(insets.bottom + 12, 20) }]}
          onPress={handleConfirm}
          activeOpacity={0.8}>
          <Text style={styles.confirmButtonText}>Confirm & Continue</Text>
        </TouchableOpacity>
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
    </KeyboardAvoidingView>
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
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing[16],
    gap: theme.spacing[16],
    paddingBottom: 40,
  },
  previewCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing[16],
  },
  previewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  previewLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  imageContainer: {
    height: 220,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  receiptImage: {
    width: '100%',
    height: '100%',
  },
  bannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[12],
    padding: theme.spacing[12],
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: theme.spacing[16],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[12],
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  titleInput: {
    height: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: theme.colors.textPrimary,
    marginTop: theme.spacing[8],
    backgroundColor: theme.colors.background,
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.accentBg,
  },
  addItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  emptyItemsBox: {
    paddingVertical: theme.spacing[16],
    alignItems: 'center',
  },
  emptyItemsText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 8,
  },
  itemLeft: {
    flex: 1,
    gap: 4,
  },
  itemNameInput: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    paddingVertical: 2,
  },
  itemSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  qtyLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  smallInput: {
    fontSize: 11,
    color: theme.colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    minWidth: 32,
    paddingVertical: 0,
    textAlign: 'center',
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  currencyPrefix: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  itemPriceInput: {
    minWidth: 75,
    maxWidth: 95,
    height: 36,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    textAlign: 'right',
    paddingHorizontal: 8,
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.background,
  },
  addQtyPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: theme.colors.accentBg,
    marginTop: 2,
  },
  addQtyPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  deleteBtn: {
    padding: 6,
    marginLeft: 2,
  },
  calcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: theme.colors.accentBg,
  },
  calcBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  fieldLabel: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fieldInput: {
    minWidth: 85,
    maxWidth: 120,
    height: 36,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    textAlign: 'right',
    paddingHorizontal: 8,
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.background,
  },
  totalBox: {
    marginTop: theme.spacing[16],
    paddingTop: theme.spacing[16],
    borderTopWidth: 1.5,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[12],
  },
  totalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  currencyFlag: {
    fontSize: 14,
  },
  currencyCode: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  totalSubLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  totalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  totalCurrency: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  totalInput: {
    minWidth: 110,
    maxWidth: 160,
    height: 44,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    textAlign: 'right',
    paddingHorizontal: 12,
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.primary,
    backgroundColor: theme.colors.accentBg,
  },
  itemMatchNotice: {
    fontSize: 11,
    color: theme.colors.success,
    fontWeight: '600',
  },
  itemDiscrepancyNotice: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '500',
    marginTop: 2,
  },
  confirmButton: {
    backgroundColor: theme.colors.primary,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    marginTop: theme.spacing[8],
  },
  confirmButtonText: {
    color: theme.colors.cream,
    fontSize: 16,
    fontWeight: '600',
  },
});
