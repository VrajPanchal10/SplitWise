import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Camera, Image as ImageIcon, ChevronLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/constants/theme';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useBillCreation } from '../context/BillCreationContext';
import apiClient from '../services/apiClient';

export default function ScanBillScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { setGroupId, setScannedItems, groupId } = useBillCreation();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Set groupId from params if provided
  useEffect(() => {
    if (params.groupId) {
      setGroupId(params.groupId as string);
    }
  }, [params.groupId]);

  const requestPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll permissions to upload images.');
      return false;
    }
    return true;
  };

  const takePhoto = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const chooseFromGallery = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const handleContinue = async () => {
    if (!selectedImage) return;

    setIsScanning(true);

    try {
      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append('image', {
        uri: selectedImage,
        type: 'image/jpeg',
        name: 'bill.jpg',
      } as any);

      // Upload to OCR endpoint
      // NOTE: Do NOT manually set Content-Type header - axios auto-detects
      // FormData and sets the correct multipart/form-data with boundary.
      // Manually setting it strips the boundary and breaks backend parsing.
      const response = await apiClient.post('/ocr/scan', formData, {
        timeout: 30000,
      });

      // The backend now returns a structured parse result with a suggested
      // title, detected total, confidence, and parsed items. Prefer these
      // backend-computed values over any client-side re-parsing of rawText.
      const rawText = response.data.rawText || '';
      const confidence = response.data.confidence || 'LOW';
      const ocrItems = response.data.items || [];

      // Suggested title & total come from the backend's structured parse
      // (a more robust "total" line detector and merchant-name suggester).
      const extractedTitle =
        (response.data.suggestedTitle as string) || '';

      // Use backend detected total if available; otherwise fall back to
      // summing parsed items so we never pass 0/NaN to the entry screen.
      let finalTotal: number;
      const backendTotal = response.data.totalAmount
        ? parseFloat(response.data.totalAmount)
        : 0;
      if (backendTotal > 0) {
        finalTotal = backendTotal;
      } else {
        finalTotal = ocrItems.reduce(
          (sum: number, item: any) => sum + (item.price || 0),
          0
        );
      }

      // Transform OCR response to BillItem format
      const billItems = ocrItems.map((item: any, index: number) => ({
        id: `item-${index}`,
        name: item.name || item.description || 'Unknown Item',
        price: item.price || 0,
        selected: true,
        sharedByUserIds: [],
      }));

      // Store items in context
      setScannedItems(billItems);

      console.log('[DEBUG] OCR result:', {
        confidence,
        suggestedTitle: extractedTitle,
        totalAmount: finalTotal,
        itemCount: billItems.length,
      });

      // Navigate to manual-entry with extracted title and amount
      const navParams: any = {
        scannedTitle: extractedTitle,
        scannedAmount: String(finalTotal),
      };
      if (groupId) {
        navParams.groupId = groupId;
      }
      router.push({ pathname: '/manual-entry', params: navParams });
    } catch (error: any) {
      console.error('OCR scan error:', error);
      console.log('OCR error message:', error.message);
      console.log('OCR error code:', error.code);
      console.log('OCR error response status:', error.response?.status);
      console.log('OCR error response data:', error.response?.data);
      Alert.alert('Error', 'Failed to scan bill. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan Bill</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Camera/Upload Box */}
        <TouchableOpacity
          style={styles.uploadBox}
          onPress={selectedImage ? undefined : chooseFromGallery}
          activeOpacity={0.7}>
          {selectedImage ? (
            <Text style={styles.previewText}>Image selected ✓</Text>
          ) : (
            <>
              <View style={styles.cameraCircle}>
                <Camera size={36} color={theme.colors.primary} />
              </View>
              <Text style={styles.uploadText}>Tap to scan or upload a bill</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Action Buttons */}
        {!selectedImage ? (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={takePhoto}>
              <Camera size={20} color={theme.colors.cream} />
              <Text style={styles.primaryButtonText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.outlineButton} onPress={chooseFromGallery}>
              <ImageIcon size={20} color={theme.colors.primary} />
              <Text style={styles.outlineButtonText}>Choose from Gallery</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            disabled={isScanning}>
            {isScanning ? (
              <ActivityIndicator color={theme.colors.cream} />
            ) : (
              <Text style={styles.continueButtonText}>Continue</Text>
            )}
          </TouchableOpacity>
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
    justifyContent: 'center',
  },
  uploadBox: {
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    aspectRatio: 0.85,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[16],
  },
  cameraCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.accentBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: theme.spacing[24],
    fontFamily: theme.fontFamily.regular,
  },
  previewText: {
    fontSize: 16,
    color: theme.colors.success,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing[12],
    marginTop: theme.spacing[24],
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.primary,
    height: 50,
    borderRadius: 14,
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  outlineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.surface,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
  },
  outlineButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  continueButton: {
    backgroundColor: theme.colors.primary,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing[24],
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
});
