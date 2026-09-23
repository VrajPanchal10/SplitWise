import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/apiClient';

interface User {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl?: string;
  paymentQrUrl?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (fullName: string, email: string, password: string) => Promise<void>;
  logout: (router?: any) => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user;

  // Check for existing session on app mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await AsyncStorage.getItem('authToken');
        const userData = await AsyncStorage.getItem('userData');
        
        if (token && userData) {
          setUser(JSON.parse(userData));
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { token, userId, fullName, email: userEmail, profilePictureUrl, paymentQrUrl } = response.data;
      
      // Build user object from response
      const userData = {
        id: userId,
        fullName,
        email: userEmail,
        profilePictureUrl,
        paymentQrUrl,
      };
      
      // Store token and user data
      await AsyncStorage.setItem('authToken', token);
      await AsyncStorage.setItem('userData', JSON.stringify(userData));
      
      // Update state
      setUser(userData);
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const signup = async (fullName: string, email: string, password: string) => {
    try {
      const response = await apiClient.post('/auth/signup', { fullName, email, password });
      const { token, userId, fullName: userFullName, email: userEmail, profilePictureUrl, paymentQrUrl } = response.data;
      
      // Build user object from response
      const userData = {
        id: userId,
        fullName: userFullName,
        email: userEmail,
        profilePictureUrl,
        paymentQrUrl,
      };
      
      // Store token and user data
      await AsyncStorage.setItem('authToken', token);
      await AsyncStorage.setItem('userData', JSON.stringify(userData));
      
      // Update state
      setUser(userData);
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  };

  const updateUser = useCallback(async (updates: Partial<User>) => {
    try {
      setUser(prev => {
        const updatedUser = { ...(prev || {}), ...updates } as User;
        AsyncStorage.setItem('userData', JSON.stringify(updatedUser));
        return updatedUser;
      });
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }, []);

  const logout = async (router?: any) => {
    try {
      // Clear AsyncStorage
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
      
      // Reset state
      setUser(null);
      
      // Navigate to login screen if router is provided
      if (router) {
        router.replace('/(auth)/login');
      }
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        login,
        signup,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};