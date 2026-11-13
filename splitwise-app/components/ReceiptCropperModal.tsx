import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  PanResponder,
  PanResponderInstance,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RotateCw, RefreshCw } from 'lucide-react-native';
import { manipulateAsync, SaveFormat, Action } from 'expo-image-manipulator';
import { theme } from '@/constants/theme';
import {
  calculateDisplayedImageLayout,
  mapScreenCropToImagePixels,
  calculateHandleDelta,
  CropRect,
  DisplayedImageLayout,
  HandleType,
} from '@/utils/cropUtils';

interface ReceiptCropperModalProps {
  visible: boolean;
  imageUri: string | null;
  onDone: (croppedUri: string) => Promise<void> | void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export function ReceiptCropperModal({
  visible,
  imageUri,
  onDone,
  onCancel,
  isProcessing = false,
}: ReceiptCropperModalProps) {
  const insets = useSafeAreaInsets();

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [isApplyingCrop, setIsApplyingCrop] = useState<boolean>(false);

  // References to keep PanResponder handlers synchronized with latest state
  const cropRectRef = useRef<CropRect>(cropRect);
  cropRectRef.current = cropRect;

  const layoutRef = useRef<DisplayedImageLayout | null>(null);

  // Compute displayed layout based on current container, image size, and rotation
  const layout = useMemo(() => {
    if (!containerSize || !imageSize) return null;
    const l = calculateDisplayedImageLayout(
      containerSize.width,
      containerSize.height,
      imageSize.width,
      imageSize.height,
      rotation
    );
    layoutRef.current = l;
    return l;
  }, [containerSize, imageSize, rotation]);

  // Load image dimensions whenever imageUri changes
  useEffect(() => {
    if (!imageUri) {
      setImageSize(null);
      setRotation(0);
      return;
    }

    setRotation(0);
    Image.getSize(
      imageUri,
      (width, height) => {
        setImageSize({ width, height });
      },
      (error) => {
        console.error('Failed to get image size:', error);
        Alert.alert('Image Error', 'Could not load image dimensions.');
      }
    );
  }, [imageUri]);

  // Initialize crop rect to encompass the entire displayed image whenever layout changes
  useEffect(() => {
    if (layout) {
      const initial: CropRect = {
        x: layout.offsetX,
        y: layout.offsetY,
        width: layout.displayedWidth,
        height: layout.displayedHeight,
      };
      setCropRect(initial);
      cropRectRef.current = initial;
    }
  }, [layout]);

  // Factory function to create PanResponder for handles
  const createPanResponder = (handleType: HandleType): PanResponderInstance => {
    let startCrop: CropRect = { x: 0, y: 0, width: 0, height: 0 };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startCrop = { ...cropRectRef.current };
      },
      onPanResponderMove: (_, gestureState) => {
        const curLayout = layoutRef.current;
        if (!curLayout) return;

        const bounds = {
          minX: curLayout.offsetX,
          minY: curLayout.offsetY,
          maxX: curLayout.offsetX + curLayout.displayedWidth,
          maxY: curLayout.offsetY + curLayout.displayedHeight,
        };

        const updated = calculateHandleDelta(
          handleType,
          startCrop,
          gestureState.dx,
          gestureState.dy,
          bounds,
          44
        );

        setCropRect(updated);
        cropRectRef.current = updated;
      },
      onPanResponderRelease: () => {},
      onPanResponderTerminate: () => {},
    });
  };

  // PanResponders for the 4 corners
  const panTl = useRef(createPanResponder('tl')).current;
  const panTr = useRef(createPanResponder('tr')).current;
  const panBl = useRef(createPanResponder('bl')).current;
  const panBr = useRef(createPanResponder('br')).current;

  // PanResponders for the 4 edges
  const panTop = useRef(createPanResponder('top')).current;
  const panBottom = useRef(createPanResponder('bottom')).current;
  const panLeft = useRef(createPanResponder('left')).current;
  const panRight = useRef(createPanResponder('right')).current;

  // PanResponder for moving the body
  const panBody = useRef(createPanResponder('body')).current;

  // Rotate 90 degrees clockwise
  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Reset crop to 100% full receipt
  const handleReset = () => {
    if (layout) {
      const full: CropRect = {
        x: layout.offsetX,
        y: layout.offsetY,
        width: layout.displayedWidth,
        height: layout.displayedHeight,
      };
      setCropRect(full);
      cropRectRef.current = full;
    }
  };

  // Apply crop and execute confirmation callback
  const handleDone = async () => {
    if (!imageUri || !imageSize || !layout || isApplyingCrop || isProcessing) {
      return;
    }

    try {
      setIsApplyingCrop(true);

      // Map on-screen crop box to exact source image pixel coordinates
      const pixelCrop = mapScreenCropToImagePixels(cropRectRef.current, layout);

      const actions: Action[] = [];
      if (rotation !== 0) {
        actions.push({ rotate: rotation });
      }
      actions.push({
        crop: {
          originX: pixelCrop.originX,
          originY: pixelCrop.originY,
          width: pixelCrop.width,
          height: pixelCrop.height,
        },
      });

      // Perform crop via expo-image-manipulator
      const result = await manipulateAsync(imageUri, actions, {
        compress: 0.92,
        format: SaveFormat.JPEG,
      });

      // Pass resulting image to the confirmation flow
      await onDone(result.uri);
    } catch (error) {
      console.error('Error applying crop:', error);
      Alert.alert('Crop Error', 'Failed to crop the receipt image. Please try again.');
    } finally {
      setIsApplyingCrop(false);
    }
  };

  const busy = isApplyingCrop || isProcessing;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} disabled={busy} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Crop Receipt</Text>

          <TouchableOpacity
            onPress={handleDone}
            disabled={busy}
            style={[styles.doneButton, busy && styles.doneButtonDisabled]}>
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.doneText}>Done</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Cropping Viewport */}
        <View
          style={styles.viewport}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setContainerSize({ width, height });
            }
          }}>
          {imageUri && layout && (
            <>
              {/* Displayed Image */}
              <Image
                source={{ uri: imageUri }}
                style={{
                  position: 'absolute',
                  left: layout.offsetX,
                  top: layout.offsetY,
                  width: layout.displayedWidth,
                  height: layout.displayedHeight,
                  transform: [{ rotate: `${rotation}deg` }],
                }}
                resizeMode="contain"
              />

              {/* Shaded backdrop outside crop area */}
              {/* Top shade */}
              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: 0,
                    top: 0,
                    width: containerSize?.width || 0,
                    height: Math.max(0, cropRect.y),
                  },
                ]}
              />
              {/* Bottom shade */}
              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: 0,
                    top: cropRect.y + cropRect.height,
                    width: containerSize?.width || 0,
                    height: Math.max(0, (containerSize?.height || 0) - (cropRect.y + cropRect.height)),
                  },
                ]}
              />
              {/* Left shade */}
              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: 0,
                    top: cropRect.y,
                    width: Math.max(0, cropRect.x),
                    height: cropRect.height,
                  },
                ]}
              />
              {/* Right shade */}
              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: cropRect.x + cropRect.width,
                    top: cropRect.y,
                    width: Math.max(0, (containerSize?.width || 0) - (cropRect.x + cropRect.width)),
                    height: cropRect.height,
                  },
                ]}
              />

              {/* Crop Frame Box */}
              <View
                style={[
                  styles.cropBox,
                  {
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.width,
                    height: cropRect.height,
                  },
                ]}>
                {/* Body drag area */}
                <View style={StyleSheet.absoluteFill} {...panBody.panHandlers} />

                {/* 3x3 Grid Lines */}
                <View pointerEvents="none" style={styles.gridContainer}>
                  <View style={[styles.gridLineH, { top: '33.33%' }]} />
                  <View style={[styles.gridLineH, { top: '66.66%' }]} />
                  <View style={[styles.gridLineV, { left: '33.33%' }]} />
                  <View style={[styles.gridLineV, { left: '66.66%' }]} />
                </View>

                {/* Edge Handles */}
                {/* Top Edge */}
                <View style={styles.edgeTouchTop} {...panTop.panHandlers}>
                  <View style={styles.edgePillH} />
                </View>

                {/* Bottom Edge */}
                <View style={styles.edgeTouchBottom} {...panBottom.panHandlers}>
                  <View style={styles.edgePillH} />
                </View>

                {/* Left Edge */}
                <View style={styles.edgeTouchLeft} {...panLeft.panHandlers}>
                  <View style={styles.edgePillV} />
                </View>

                {/* Right Edge */}
                <View style={styles.edgeTouchRight} {...panRight.panHandlers}>
                  <View style={styles.edgePillV} />
                </View>

                {/* 4 Corner Handles with large 48x48 touch targets */}
                {/* Top-Left Corner */}
                <View style={styles.cornerTouchTL} {...panTl.panHandlers}>
                  <View style={styles.cornerCircle} />
                </View>

                {/* Top-Right Corner */}
                <View style={styles.cornerTouchTR} {...panTr.panHandlers}>
                  <View style={styles.cornerCircle} />
                </View>

                {/* Bottom-Left Corner */}
                <View style={styles.cornerTouchBL} {...panBl.panHandlers}>
                  <View style={styles.cornerCircle} />
                </View>

                {/* Bottom-Right Corner */}
                <View style={styles.cornerTouchBR} {...panBr.panHandlers}>
                  <View style={styles.cornerCircle} />
                </View>
              </View>
            </>
          )}

          {(!imageUri || !layout) && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.loadingText}>Loading image...</Text>
            </View>
          )}

          {/* Full Screen Processing Overlay */}
          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.busyText}>
                {isProcessing ? 'Scanning receipt...' : 'Cropping image...'}
              </Text>
            </View>
          )}
        </View>

        {/* Bottom Toolbar */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            style={styles.toolButton}
            onPress={handleRotate}
            disabled={busy}
            activeOpacity={0.7}>
            <RotateCw size={22} color={theme.colors.cream} />
            <Text style={styles.toolButtonText}>Rotate 90°</Text>
          </TouchableOpacity>

          <Text style={styles.hintText}>Drag handles to fit receipt</Text>

          <TouchableOpacity
            style={styles.toolButton}
            onPress={handleReset}
            disabled={busy}
            activeOpacity={0.7}>
            <RefreshCw size={22} color={theme.colors.cream} />
            <Text style={styles.toolButtonText}>Full Receipt</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1511', // Deep charcoal/greenish dark background
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#243329',
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cancelText: {
    color: '#D1DCD5',
    fontSize: 16,
    fontFamily: theme.fontFamily.regular,
  },
  headerTitle: {
    color: '#FBF8F3',
    fontSize: 17,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  doneButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonDisabled: {
    opacity: 0.6,
  },
  doneText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  viewport: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#090D0B',
    overflow: 'hidden',
  },
  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  gridContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderStyle: 'dashed',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderStyle: 'dashed',
  },

  // 4 Corner Touch Areas (48x48 hit slop centered over corner)
  cornerTouchTL: {
    position: 'absolute',
    left: -24,
    top: -24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cornerTouchTR: {
    position: 'absolute',
    right: -24,
    top: -24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cornerTouchBL: {
    position: 'absolute',
    left: -24,
    bottom: -24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cornerTouchBR: {
    position: 'absolute',
    right: -24,
    bottom: -24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cornerCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.primary,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },

  // Edge Touch Areas
  edgeTouchTop: {
    position: 'absolute',
    top: -22,
    left: 30,
    right: 30,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9,
  },
  edgeTouchBottom: {
    position: 'absolute',
    bottom: -22,
    left: 30,
    right: 30,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9,
  },
  edgeTouchLeft: {
    position: 'absolute',
    left: -22,
    top: 30,
    bottom: 30,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9,
  },
  edgeTouchRight: {
    position: 'absolute',
    right: -22,
    top: 30,
    bottom: 30,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9,
  },
  edgePillH: {
    width: 32,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },
  edgePillV: {
    width: 5,
    height: 32,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },

  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#D1DCD5',
    fontSize: 14,
    fontFamily: theme.fontFamily.regular,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 20,
  },
  busyText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[16],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#243329',
    backgroundColor: '#0E1511',
  },
  toolButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  toolButtonText: {
    color: '#D1DCD5',
    fontSize: 12,
    fontFamily: theme.fontFamily.regular,
  },
  hintText: {
    color: '#8B9A8F',
    fontSize: 12,
    fontFamily: theme.fontFamily.regular,
  },
});
