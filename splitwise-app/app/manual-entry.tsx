import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { ChevronLeft, Check } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

interface Friend {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl?: string;
}

export default function ManualEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupId = params.groupId as string | undefined;
  const friendId = params.friendId as string | undefined;
  const billId = params.billId as string | undefined;
  const scannedTitle = params.scannedTitle as string | undefined;
  const scannedAmount = params.scannedAmount as string | undefined;
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState(scannedTitle || '');
  const [amount, setAmount] = useState(scannedAmount || '');
  const [description, setDescription] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [newFriendEmail, setNewFriendEmail] = useState('');
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [participantError, setParticipantError] = useState('');

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
      const response = await apiClient.get(`/groups/${groupId}/members`);
      const members = response.data;
      setFriends(members);
      setSelectedFriendIds(members.map((m: Friend) => m.id));
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

  const handleSave = async () => {
    // Clear previous errors
    setTitleError('');
    setAmountError('');
    setParticipantError('');

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

    const sharedByUserIds = Array.from(new Set([user?.id, ...selectedFriendIds].filter(Boolean)));
    if (sharedByUserIds.length === 0) {
      setParticipantError('At least one participant must be selected');
      hasError = true;
    }

    if (hasError || !user) return;

    setIsLoading(true);

    try {
      const billData: any = {
        title: title.trim(),
        totalAmount: totalAmount,
        paidBy: user.id,
        items: [
          {
            name: title.trim(),
            price: totalAmount,
            sharedByUserIds,
          }
        ],
      };

      if (groupId) {
        billData.groupId = groupId;
        billData.participantIds = sharedByUserIds;
      } else {
        billData.groupId = null;
        billData.participantIds = sharedByUserIds;
      }

      if (isEditMode && billId) {
        // Update existing bill
        await apiClient.put(`/bills/${billId}`, billData);
        router.back();
      } else {
        // Create new bill
        await apiClient.post('/bills', billData);

        if (groupId) {
          // Navigate back to group detail screen (will refetch bills on focus)
          router.replace({ pathname: '/group/[id]', params: { id: groupId } });
        } else {
          // Navigate to Dashboard (will refetch on focus)
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

  // Determine if we're in group mode
  const isGroupMode = groupId !== undefined;

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
            <Text style={styles.inputLabel}>Amount *</Text>
            <View style={styles.amountInputContainer}>
              <Text style={styles.currencySymbol}>₹</Text>
              <TextInput
                style={[styles.amountInput, amountError && styles.amountInputError]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="numeric"
              />
            </View>
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

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Date</Text>
            <View style={styles.dateDisplay}>
              <Text style={styles.dateText}>{today}</Text>
            </View>
          </View>
        </View>

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
});