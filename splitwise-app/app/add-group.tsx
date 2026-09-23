import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Image } from 'react-native';
import { ChevronLeft, Users, Search, X, Plus, User } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

interface Member {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl?: string;
}

export default function AddGroupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [searchedUser, setSearchedUser] = useState<Member | null>(null);

  const canCreateGroup = groupName.trim().length > 0;

  const handleSearchEmail = async () => {
    if (!emailInput.trim()) return;

    setError(null);
    setIsSearching(true);
    setSearchedUser(null);

    try {
      const response = await apiClient.get(`/users/search`, {
        params: { email: emailInput.trim() }
      });
      setSearchedUser(response.data);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || 'User not found. Please check the email.';
      setError(errorMessage);
    } finally {
      setIsSearching(false);
    }
  };

  const addMember = (member: Member) => {
    setMembers(prev => {
      if (prev.some(m => m.id === member.id)) return prev;
      return [...prev, member];
    });
    setSearchedUser(null);
    setEmailInput('');
  };

  const removeMember = (memberId: string) => {
    setMembers(prev => prev.filter(m => m.id !== memberId));
  };

  const handleCreateGroup = async () => {
    if (!canCreateGroup || !user) return;

    setError(null);
    setIsLoading(true);

    try {
      // Create group with selected members
      await apiClient.post('/groups', {
        name: groupName.trim(),
        memberIds: members.map(m => m.id)
      });

      // Navigate back to groups tab
      router.replace('/(tabs)/groups');
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || 'Failed to create group. Please try again.';
      setError(errorMessage);
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
        <Text style={styles.headerTitle}>New Group</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.content}>
        {/* Group Name Input */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Group Name</Text>
          <View style={styles.inputWrapper}>
            <Users size={17} color={theme.colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Enter group name"
              placeholderTextColor={theme.colors.textSecondary}
              value={groupName}
              onChangeText={setGroupName}
            />
          </View>
        </View>

        {/* Add Members by Email */}
        <View style={styles.membersSection}>
          <Text style={styles.sectionLabel}>Add Members</Text>
          <View style={styles.searchRow}>
            <View style={styles.searchWrapper}>
              <Search size={17} color={theme.colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Enter friend's email"
                placeholderTextColor={theme.colors.textSecondary}
                value={emailInput}
                onChangeText={setEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
                onSubmitEditing={handleSearchEmail}
              />
            </View>
            <TouchableOpacity
              style={[styles.searchButton, isSearching && styles.searchButtonDisabled]}
              onPress={handleSearchEmail}
              disabled={isSearching || !emailInput.trim()}>
              {isSearching ? (
                <ActivityIndicator size="small" color={theme.colors.cream} />
              ) : (
                <Text style={styles.searchButtonText}>Add</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Searched User Result */}
          {searchedUser && (
            <View style={styles.searchedUserCard}>
              <View style={styles.memberAvatar}>
                {searchedUser.profilePictureUrl ? (
                  <Image
                    key={searchedUser.profilePictureUrl}
                    source={{ uri: searchedUser.profilePictureUrl }}
                    style={styles.memberAvatarImage}
                    resizeMode="cover"
                    onError={(e) => console.log('[DEBUG] User avatar failed to load:', e.nativeEvent?.error)}
                  />
                ) : (
                  <Text style={styles.memberAvatarText}>{searchedUser.fullName.charAt(0)}</Text>
                )}
              </View>
              <View style={styles.searchedUserInfo}>
                <Text style={styles.memberName}>{searchedUser.fullName}</Text>
                <Text style={styles.memberEmail}>{searchedUser.email}</Text>
              </View>
              <TouchableOpacity style={styles.addMemberButton} onPress={() => addMember(searchedUser)}>
                <Plus size={20} color={theme.colors.cream} />
              </TouchableOpacity>
            </View>
          )}

          {/* Selected Members */}
          {members.length > 0 && (
            <View style={styles.selectedContainer}>
              <Text style={styles.selectedLabel}>Selected Members ({members.length})</Text>
              {members.map((member) => (
                <View key={member.id} style={styles.selectedMemberRow}>
                  <View style={styles.memberAvatar}>
                    {member.profilePictureUrl ? (
                      <Image
                        key={member.profilePictureUrl}
                        source={{ uri: member.profilePictureUrl }}
                        style={styles.memberAvatarImage}
                        resizeMode="cover"
                        onError={(e) => console.log('[DEBUG] Member avatar failed to load:', e.nativeEvent?.error)}
                      />
                    ) : (
                      <Text style={styles.memberAvatarText}>{member.fullName.charAt(0)}</Text>
                    )}
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.fullName}</Text>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                  </View>
                  <TouchableOpacity style={styles.removeButton} onPress={() => removeMember(member.id)}>
                    <X size={18} color={theme.colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {members.length === 0 && !searchedUser && (
            <Text style={styles.helperText}>
              Search by email to add friends who have a SplitWise account
            </Text>
          )}
        </View>
      </View>

      {/* Error Banner */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Create Group Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.createButton,
            (!canCreateGroup || isLoading) && styles.createButtonDisabled,
          ]}
          disabled={!canCreateGroup || isLoading}
          onPress={handleCreateGroup}>
          {isLoading ? (
            <ActivityIndicator color={theme.colors.cream} />
          ) : (
            <Text style={styles.createButtonText}>
              Create Group{members.length > 0 ? ` (${members.length + 1} members)` : ''}
            </Text>
          )}
        </TouchableOpacity>
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
  },
  inputContainer: {
    marginBottom: theme.spacing[24],
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[4],
    fontFamily: theme.fontFamily.regular,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing[8],
    gap: theme.spacing[8],
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  membersSection: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  searchRow: {
    flexDirection: 'row',
    gap: theme.spacing[8],
    marginBottom: theme.spacing[16],
  },
  searchWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing[8],
    gap: theme.spacing[8],
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  searchButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing[16],
    paddingVertical: theme.spacing[8],
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonDisabled: {
    opacity: 0.6,
  },
  searchButtonText: {
    color: theme.colors.cream,
    fontSize: 14,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  searchedUserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: theme.spacing[12],
    marginBottom: theme.spacing[12],
    gap: theme.spacing[12],
  },
  searchedUserInfo: {
    flex: 1,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  memberAvatarText: {
    color: theme.colors.cream,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  memberEmail: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  memberInfo: {
    flex: 1,
  },
  addMemberButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedContainer: {
    marginTop: theme.spacing[4],
  },
  selectedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  selectedMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: theme.spacing[12],
    marginBottom: theme.spacing[8],
    gap: theme.spacing[12],
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  helperText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing[8],
    fontFamily: theme.fontFamily.regular,
  },
  bottomBar: {
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
  createButton: {
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
  createButtonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  createButtonText: {
    color: theme.colors.cream,
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  errorContainer: {
    backgroundColor: theme.colors.danger + '20',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: 8,
    padding: theme.spacing[12],
    marginHorizontal: theme.spacing[24],
    marginBottom: theme.spacing[12],
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: theme.fontFamily.regular,
  },
});