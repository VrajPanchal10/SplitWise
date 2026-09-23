import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, ActivityIndicator, Image } from 'react-native';
import { ChevronLeft, Check, X } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useBillCreation } from '../context/BillCreationContext';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

interface Friend {
  id: string;
  fullName: string;
  email: string;
  color?: string;
  profilePictureUrl?: string;
}

export default function SelectItemsScreen() {
  const router = useRouter();
  const { scannedItems, setScannedItems, groupId } = useBillCreation();
  const { user } = useAuth();
  const [items, setItems] = useState(scannedItems);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch group members
  useEffect(() => {
    const fetchMembers = async () => {
      if (!groupId) return;

      try {
        const response = await apiClient.get(`/groups/${groupId}/members`);
        setFriends(response.data);
      } catch (error) {
        console.error('Error fetching members:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();
  }, [groupId]);

  const toggleItemSelection = (id: string) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, selected: !item.selected } : item
    ));
  };

  const toggleFriendForItem = (itemId: string, friendId: string) => {
    setItems(items.map(item => {
      if (item.id === itemId) {
        const sharedByUserIds = item.sharedByUserIds.includes(friendId)
          ? item.sharedByUserIds.filter(id => id !== friendId)
          : [...item.sharedByUserIds, friendId];
        return { ...item, sharedByUserIds };
      }
      return item;
    }));
  };

  const getTotal = () => {
    return items
      .filter(item => item.selected)
      .reduce((sum, item) => sum + item.price, 0);
  };

  const getSelectedCount = () => {
    return items.filter(item => item.selected).length;
  };

  const handleCalculateSplit = () => {
    // Update context with modified items
    setScannedItems(items);
    router.push('/split-summary');
  };

  const selectedItem = items.find(item => item.id === selectedItemId);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Items</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Items List */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.itemCard}
            onPress={() => toggleItemSelection(item.id)}
            onLongPress={() => setSelectedItemId(item.id)}
            activeOpacity={0.7}>
            {/* Checkbox */}
            <View style={[styles.checkbox, item.selected && styles.checkboxChecked]}>
              {item.selected && <Check size={16} color={theme.colors.cream} />}
            </View>

            {/* Item Info */}
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>₹{item.price}</Text>
            </View>

            {/* Friend Avatars */}
            <View style={styles.friendsRow}>
              {item.sharedByUserIds.slice(0, 3).map((friendId, index) => {
                const friend = friends.find(f => f.id === friendId);
                if (!friend) return null;
                return (
                  <View
                    key={friendId}
                    style={[
                      styles.friendAvatar,
                      { backgroundColor: theme.colors.primary, marginLeft: index > 0 ? -8 : 0 },
                    ]}>
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
                );
              })}
            </View>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Bottom Sticky Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.totalContainer}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>₹{getTotal()}</Text>
        </View>
        <TouchableOpacity
          style={[
            styles.calculateButton,
            getSelectedCount() === 0 && styles.calculateButtonDisabled,
          ]}
          disabled={getSelectedCount() === 0}
          onPress={handleCalculateSplit}>
          <Text style={styles.calculateButtonText}>Calculate Split</Text>
        </TouchableOpacity>
      </View>

      {/* Friend Selection Modal */}
      <Modal
        visible={!!selectedItemId}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedItemId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Share "{selectedItem?.name}" with
              </Text>
              <TouchableOpacity onPress={() => setSelectedItemId(null)}>
                <X size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={friends}
              keyExtractor={(friend) => friend.id}
              renderItem={({ item: friend }) => {
                const isSelected = selectedItem?.sharedByUserIds.includes(friend.id);
                return (
                  <TouchableOpacity
                    style={styles.friendRow}
                    onPress={() => selectedItemId && toggleFriendForItem(selectedItemId, friend.id)}
                    activeOpacity={0.7}>
                    <View style={[styles.friendAvatarLarge, { backgroundColor: theme.colors.primary }]}>
                      {friend.profilePictureUrl ? (
                        <Image
                          key={friend.profilePictureUrl}
                          source={{ uri: friend.profilePictureUrl }}
                          style={styles.friendAvatarLargeImage}
                          resizeMode="cover"
                          onError={(e) => console.log('[DEBUG] Friend avatar failed to load:', e.nativeEvent?.error)}
                        />
                      ) : (
                        <Text style={styles.friendAvatarLargeText}>
                          {friend.fullName.charAt(0)}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.friendName}>{friend.fullName}</Text>
                    <View style={[styles.friendCheckbox, isSelected && styles.friendCheckboxChecked]}>
                      {isSelected && <Check size={16} color={theme.colors.cream} />}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity style={styles.doneButton} onPress={() => setSelectedItemId(null)}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  listContent: {
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[8],
    paddingBottom: theme.spacing[24],
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: theme.spacing[8],
    gap: theme.spacing[12],
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
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  itemPrice: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.mono,
  },
  friendsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  friendAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surface,
    overflow: 'hidden',
  },
  friendAvatarImage: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  friendAvatarText: {
    color: theme.colors.cream,
    fontSize: 10,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[16],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  totalContainer: {
    flex: 1,
  },
  totalLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 2,
    fontFamily: theme.fontFamily.regular,
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.mono,
  },
  calculateButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing[24],
    paddingVertical: theme.spacing[12],
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
  calculateButtonDisabled: {
    backgroundColor: theme.colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  calculateButtonText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[16],
    paddingBottom: theme.spacing[24],
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[16],
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    flex: 1,
    fontFamily: theme.fontFamily.regular,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[12],
    gap: theme.spacing[12],
  },
  friendAvatarLarge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  friendAvatarLargeImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  friendAvatarLargeText: {
    color: theme.colors.cream,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  friendName: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  friendCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendCheckboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  doneButton: {
    backgroundColor: theme.colors.primary,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing[16],
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  doneButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
});
