import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { ChevronLeft, Camera, QrCode } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

export default function EditProfileScreen() {
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingQr, setIsUploadingQr] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(user?.profilePictureUrl || null);
  const [paymentQrUrl, setPaymentQrUrl] = useState<string | null>(user?.paymentQrUrl || null);

  // Fetch fresh user data from backend ONCE on mount to get latest profilePictureUrl
  // NOTE: Empty deps [] = run once on mount only. Do NOT include updateUser here
  // as it's recreated on every render and would cause an infinite loop.
  useEffect(() => {
    let isMounted = true;
    
    const fetchFreshUser = async () => {
      try {
        console.log('[DEBUG] Fetching fresh user data from /users/me');
        const response = await apiClient.get('/users/me');
        console.log('[DEBUG] Fresh user data:', JSON.stringify(response.data));
        
        if (!isMounted) return;
        
        // Only update if values actually differ from current context
        if (response.data?.profilePictureUrl && response.data.profilePictureUrl !== user?.profilePictureUrl) {
          console.log('[DEBUG] Setting profilePictureUrl from fresh data:', response.data.profilePictureUrl);
          setProfilePictureUrl(response.data.profilePictureUrl);
          await updateUser({ profilePictureUrl: response.data.profilePictureUrl });
        }
        if (response.data?.paymentQrUrl && response.data.paymentQrUrl !== user?.paymentQrUrl) {
          console.log('[DEBUG] Setting paymentQrUrl from fresh data:', response.data.paymentQrUrl);
          setPaymentQrUrl(response.data.paymentQrUrl);
          await updateUser({ paymentQrUrl: response.data.paymentQrUrl });
        }
        if (response.data?.fullName) {
          setFullName(response.data.fullName);
        }
        if (response.data?.email) {
          setEmail(response.data.email);
        }
      } catch (error) {
        console.error('[DEBUG] Error fetching fresh user data:', error);
      }
    };
    
    fetchFreshUser();
    
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll permissions to upload images.');
      return false;
    }
    return true;
  };

  const pickImage = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      return result.assets[0].uri;
    }
    return null;
  };

  const uploadImage = async (uri: string) => {
    const formData = new FormData();
    formData.append('image', {
      uri,
      type: 'image/jpeg',
      name: 'upload.jpg',
    } as any);

    // Let axios auto-detect FormData and set Content-Type with boundary
    const response = await apiClient.post('/upload/image', formData, {
      timeout: 30000,
    });

    return response.data.url;
  };

  const handleAvatarPress = async () => {
    const uri = await pickImage();
    if (!uri) return;

    setIsUploadingAvatar(true);
    try {
      const uploadedUrl = await uploadImage(uri);
      console.log('[DEBUG] Uploaded image URL:', uploadedUrl);
      
      console.log('[DEBUG] Calling PUT /users/me/profile-picture with:', { profilePictureUrl: uploadedUrl });
      const saveResponse = await apiClient.put('/users/me/profile-picture', { profilePictureUrl: uploadedUrl });
      console.log('[DEBUG] PUT /users/me/profile-picture response:', JSON.stringify(saveResponse.data));
      
      setProfilePictureUrl(uploadedUrl);
      
      // Update AuthContext so all screens see the new photo immediately
      console.log('[DEBUG] Calling updateUser with profilePictureUrl:', uploadedUrl);
      await updateUser({ profilePictureUrl: uploadedUrl });
      console.log('[DEBUG] updateUser completed successfully');
    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      console.log('Upload error message:', error.message);
      console.log('Upload error code:', error.code);
      console.log('Upload error response status:', error.response?.status);
      console.log('Upload error response data:', error.response?.data);
      console.log('Upload request headers:', error.config?.headers);
      Alert.alert('Error', error.userMessage || 'Failed to upload profile picture. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleQrUpload = async () => {
    const uri = await pickImage();
    if (!uri) return;

    setIsUploadingQr(true);
    try {
      const uploadedUrl = await uploadImage(uri);
      console.log('[DEBUG] Uploaded QR URL:', uploadedUrl);
      
      console.log('[DEBUG] Calling PUT /users/me/payment-qr with:', { paymentQrUrl: uploadedUrl });
      const saveResponse = await apiClient.put('/users/me/payment-qr', { paymentQrUrl: uploadedUrl });
      console.log('[DEBUG] PUT /users/me/payment-qr response:', JSON.stringify(saveResponse.data));
      
      setPaymentQrUrl(uploadedUrl);
      
      // Update AuthContext so all screens see the new QR immediately
      console.log('[DEBUG] Calling updateUser with paymentQrUrl:', uploadedUrl);
      await updateUser({ paymentQrUrl: uploadedUrl });
      console.log('[DEBUG] updateUser completed successfully');
    } catch (error: any) {
      console.error('Error uploading QR:', error);
      console.log('Upload error message:', error.message);
      console.log('Upload error code:', error.code);
      console.log('Upload error response status:', error.response?.status);
      console.log('Upload error response data:', error.response?.data);
      console.log('Upload request headers:', error.config?.headers);
      Alert.alert('Error', error.userMessage || 'Failed to upload QR code. Please try again.');
    } finally {
      setIsUploadingQr(false);
    }
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }

    setIsLoading(true);
    try {
      console.log('[DEBUG] Calling PUT /users/me with:', { fullName: fullName.trim() });
      const saveResponse = await apiClient.put('/users/me', { fullName: fullName.trim() });
      console.log('[DEBUG] PUT /users/me response:', JSON.stringify(saveResponse.data));
      
      // Update AuthContext with new name
      console.log('[DEBUG] Calling updateUser with fullName:', fullName.trim());
      await updateUser({ fullName: fullName.trim() });
      console.log('[DEBUG] updateUser completed successfully');
      
      Alert.alert('Success', 'Profile updated successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.8}>
            <View style={styles.avatarContainer}>
              {profilePictureUrl ? (
                <Image
                  key={profilePictureUrl}
                  source={{ uri: profilePictureUrl }}
                  style={styles.avatar}
                  resizeMode="cover"
                  onError={(e) => console.log('[DEBUG] Avatar image failed to load:', e.nativeEvent?.error)}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarText}>{user?.fullName?.charAt(0) || 'U'}</Text>
                </View>
              )}
              {isUploadingAvatar && (
                <View style={styles.avatarLoading}>
                  <ActivityIndicator color={theme.colors.cream} />
                </View>
              )}
              <View style={styles.cameraBadge}>
                <Camera size={16} color={theme.colors.primary} />
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Form Section */}
        <View style={styles.formSection}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your name"
              placeholderTextColor={theme.colors.textSecondary}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={[styles.input, styles.inputDisabled]}
              value={email}
              editable={false}
              placeholderTextColor={theme.colors.textSecondary}
            />
            <Text style={styles.inputNote}>Email cannot be changed</Text>
          </View>
        </View>

        {/* Payment QR Section */}
        <View style={styles.qrSection}>
          <Text style={styles.sectionTitle}>Payment QR Code</Text>

          {paymentQrUrl ? (
            <View style={styles.qrContainer}>
              <Image source={{ uri: paymentQrUrl }} style={styles.qrImage} />
              <TouchableOpacity onPress={handleQrUpload} style={styles.changeButton}>
                {isUploadingQr ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={styles.changeButtonText}>Change</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.qrUploadBox}
              onPress={handleQrUpload}
              activeOpacity={0.7}>
              {isUploadingQr ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <>
                  <QrCode size={40} color={theme.colors.textSecondary} />
                  <Text style={styles.qrUploadText}>
                    Add your UPI QR code so friends can pay you directly
                  </Text>
                  <Text style={styles.qrUploadButton}>Upload QR Code</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Save Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isLoading}>
            {isLoading ? (
              <ActivityIndicator color={theme.colors.cream} />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
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
  avatarSection: {
    alignItems: 'center',
    paddingTop: theme.spacing[24],
    paddingBottom: theme.spacing[24],
  },
  avatarContainer: {
    width: 80,
    height: 80,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
  },
  avatarFallback: {
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: theme.colors.cream,
    fontSize: 28,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  avatarLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formSection: {
    paddingHorizontal: theme.spacing[24],
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
  inputDisabled: {
    color: theme.colors.textSecondary,
  },
  inputNote: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  qrSection: {
    paddingHorizontal: theme.spacing[24],
    marginTop: theme.spacing[24],
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  qrUploadBox: {
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: theme.spacing[24],
    alignItems: 'center',
    gap: theme.spacing[12],
  },
  qrUploadText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontFamily: theme.fontFamily.regular,
  },
  qrUploadButton: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.primary,
    fontFamily: theme.fontFamily.regular,
  },
  qrContainer: {
    alignItems: 'center',
  },
  qrImage: {
    width: 160,
    height: 160,
    borderRadius: 12,
  },
  changeButton: {
    marginTop: theme.spacing[12],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[16],
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.primary,
    fontFamily: theme.fontFamily.regular,
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
});