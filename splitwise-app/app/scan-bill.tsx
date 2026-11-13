import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Camera, Image as ImageIcon, ChevronLeft, Crop, Check } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/constants/theme';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useBillCreation } from '../context/BillCreationContext';
import apiClient from '../services/apiClient';
import { ReceiptCropperModal } from '@/components/ReceiptCropperModal';

export default function ScanBillScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { setGroupId, setScannedItems, setReceiptUrl, groupId } = useBillCreation();

  // Selected (confirmed cropped) image
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // Raw uncropped source image from camera or gallery
  const [rawImage, setRawImage] = useState<string | null>(null);
  // Cropper visibility
  const [isCropperVisible, setIsCropperVisible] = useState<boolean>(false);
  // OCR scanning state
  const [isScanning, setIsScanning] = useState<boolean>(false);

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

    // Use full image capture without native uCrop fixed-ratio constraints
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1.0,
    });

    if (!result.canceled && result.assets[0]) {
      setRawImage(result.assets[0].uri);
      setIsCropperVisible(true);
    }
  };

  const chooseFromGallery = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    // Use full image selection without native uCrop fixed-ratio constraints
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1.0,
    });

    if (!result.canceled && result.assets[0]) {
      setRawImage(result.assets[0].uri);
      setIsCropperVisible(true);
    }
  };

  /**
   * Submits the cropped image to the backend OCR scan endpoint
   */
  const scanReceipt = async (imageUriToScan: string) => {
    if (!imageUriToScan) return;

    setIsScanning(true);

    try {
      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append('image', {
        uri: imageUriToScan,
        type: 'image/jpeg',
        name: 'bill.jpg',
      } as any);

      // Upload to OCR endpoint
      const response = await apiClient.post('/ocr/scan', formData, {
        timeout: 120000,
      });

      const confidence = response.data.confidence || 'LOW';
      const ocrItems = response.data.items || [];
      const extractedTitle = (response.data.suggestedTitle as string) || '';

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
        quantity: item.quantity || null,
        unitPrice: item.unitPrice || null,
        selected: true,
        sharedByUserIds: [],
      }));

      // Store items in context
      setScannedItems(billItems);

      // Extract receipt URL uploaded to Cloudinary
      const receiptUrl = response.data.receiptUrl || null;
      if (receiptUrl) {
        setReceiptUrl(receiptUrl);
      }

      console.log('[DEBUG] OCR result:', {
        confidence,
        suggestedTitle: extractedTitle,
        totalAmount: finalTotal,
        itemCount: billItems.length,
        receiptUrl,
      });

      // Close cropper modal if open
      setIsCropperVisible(false);

      // Navigate to OCR review/edit screen
      router.push({
        pathname: '/ocr-review',
        params: {
          rawScanData: JSON.stringify(response.data),
          scannedTitle: extractedTitle,
          scannedAmount: String(finalTotal),
          currency: response.data.currency || 'INR',
          receiptUrl: receiptUrl || '',
          localImageUri: imageUriToScan,
          groupId: groupId || '',
        },
      });
    } catch (error: any) {
      console.error('OCR scan error:', error);
      Alert.alert('Error', 'Failed to scan bill. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  /**
   * Called when user confirms crop by pressing "Done"
   */
  const handleCropDone = async (croppedUri: string) => {
    setSelectedImage(croppedUri);
    // Proceed to existing receipt-scanning flow
    await scanReceipt(croppedUri);
  };

  /**
   * Called when user cancels cropping
   */
  const handleCropCancel = () => {
    setIsCropperVisible(false);
    // Discard unconfirmed crop, leaving previous state intact
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
            <View style={styles.previewContainer}>
              <Image source={{ uri: selectedImage }} style={styles.previewImage} resizeMode="contain" />
              <View style={styles.previewBadge}>
                <Check size={14} color="#FFFFFF" />
                <Text style={styles.previewBadgeText}>Receipt Cropped ✓</Text>
              </View>
            </View>
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
          <View style={styles.selectedActionsContainer}>
            <View style={styles.buttonRow}>
              {rawImage && (
                <TouchableOpacity
                  style={styles.outlineButton}
                  onPress={() => setIsCropperVisible(true)}
                  disabled={isScanning}>
                  <Crop size={18} color={theme.colors.primary} />
                  <Text style={styles.outlineButtonText}>Adjust Crop</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.outlineButton}
                onPress={chooseFromGallery}
                disabled={isScanning}>
                <ImageIcon size={18} color={theme.colors.primary} />
                <Text style={styles.outlineButtonText}>Change Photo</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.continueButton}
              onPress={() => scanReceipt(selectedImage)}
              disabled={isScanning}>
              {isScanning ? (
                <ActivityIndicator color={theme.colors.cream} />
              ) : (
                <Text style={styles.continueButtonText}>Scan Bill</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Responsive Receipt Cropper Modal */}
      <ReceiptCropperModal
        visible={isCropperVisible}
        imageUri={rawImage}
        onDone={handleCropDone}
        onCancel={handleCropCancel}
        isProcessing={isScanning}
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
    overflow: 'hidden',
  },
  previewContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF8F5',
  },
  previewImage: {
    width: '90%',
    height: '90%',
  },
  previewBadge: {
    position: 'absolute',
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.success,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  previewBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  cameraCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.accentBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing[16],
  },
  uploadText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: theme.spacing[24],
    fontFamily: theme.fontFamily.regular,
  },
  selectedActionsContainer: {
    gap: theme.spacing[12],
    marginTop: 20,
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
