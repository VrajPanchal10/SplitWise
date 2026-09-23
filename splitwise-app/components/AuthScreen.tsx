import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Receipt, Eye, EyeOff, User, Mail, Lock, ArrowRight } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';

interface AuthScreenProps {
  initialTab?: 'signup' | 'login';
}

const ZigzagEdge: React.FC = () => {
  const zigzagHeight = 20;
  const zigzagWidth = 20;
  const segments = 20;
  
  let path = `M 0 ${zigzagHeight}`;
  for (let i = 0; i < segments; i++) {
    const x1 = i * zigzagWidth;
    const x2 = (i + 1) * zigzagWidth;
    const midX = (x1 + x2) / 2;
    
    if (i % 2 === 0) {
      path += ` L ${x1} 0 L ${midX} ${zigzagHeight}`;
    } else {
      path += ` L ${x1} ${zigzagHeight} L ${midX} 0`;
    }
  }
  path += ` L ${segments * zigzagWidth} ${zigzagHeight} L ${segments * zigzagWidth} 0 L 0 0 Z`;
  
  return (
    <Svg width={segments * zigzagWidth} height={zigzagHeight} style={styles.zigzag}>
      <Path d={path} fill={theme.colors.heroBg} />
    </Svg>
  );
};

export default function AuthScreen({ initialTab = 'signup' }: AuthScreenProps) {
  const router = useRouter();
  const { login, signup } = useAuth();
  const [activeTab, setActiveTab] = useState<'signup' | 'login'>(initialTab);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const getPasswordStrength = () => {
    if (password.length === 0) return 0;
    if (password.length < 6) return 1;
    if (password.length < 10) return 2;
    return 3;
  };

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const handleSubmit = async () => {
    // Clear previous error
    setError(null);

    // Validate fields
    if (!email || !password) {
      setError('Please fill in all required fields');
      return;
    }
    if (activeTab === 'signup' && !fullName) {
      setError('Please enter your full name');
      return;
    }
    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      if (activeTab === 'signup') {
        await signup(fullName, email, password);
      } else {
        await login(email, password);
      }
      // On success, navigate to tabs
      router.replace('/(tabs)');
    } catch (err: any) {
      // Extract error message from backend response.
      // Backend returns {"error": "..."} (see GlobalExceptionHandler).
      const errorMessage =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.userMessage ||
        'An error occurred. Please try again.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const passwordStrength = getPasswordStrength();

  return (
    <View style={styles.container}>
      {/* Hero Header */}
      <View style={styles.hero}>
        {/* Decorative Circles */}
        <View style={styles.heroCircles}>
          <View style={[styles.circle, styles.circleTopRight]} />
          <View style={[styles.circle, styles.circleBottomLeft]} />
        </View>

        {/* Logo and Title */}
        <View style={styles.heroTop}>
          <View style={styles.logoContainer}>
            <View style={styles.logoMark}>
              <Receipt size={18} color={theme.colors.cream} />
            </View>
            <Text style={styles.logoText}>SplitWise</Text>
          </View>
        </View>

        {/* Hero Bottom Content */}
        <View style={styles.heroBottom}>
          <Text style={styles.stepLabel}>Step 1 of 1</Text>
          <Text style={styles.heroHeading}>Let's get you{'\n'}splitting bills.</Text>
        </View>

        {/* Zigzag Edge */}
        <ZigzagEdge />
      </View>

      {/* Form Section */}
      <KeyboardAvoidingView
        style={styles.formContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.formScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          
          {/* Segmented Toggle */}
          <View style={styles.segmentedContainer}>
            <TouchableOpacity
              style={[styles.segment, activeTab === 'signup' && styles.segmentActive]}
              onPress={() => setActiveTab('signup')}>
              <Text style={[styles.segmentText, activeTab === 'signup' && styles.segmentTextActive]}>
                Sign up
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, activeTab === 'login' && styles.segmentActive]}
              onPress={() => setActiveTab('login')}>
              <Text style={[styles.segmentText, activeTab === 'login' && styles.segmentTextActive]}>
                Log in
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form Fields */}
          <View style={styles.formFields}>
            {activeTab === 'signup' && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={[
                  styles.inputWrapper,
                  focusedField === 'name' && styles.inputWrapperFocused,
                ]}>
                  <User size={17} color={focusedField === 'name' ? theme.colors.primary : theme.colors.textSecondary} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your full name"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={fullName}
                    onChangeText={setFullName}
                    onFocus={() => setFocusedField('name')}
                    onBlur={() => setFocusedField(null)}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            )}

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={[
                styles.inputWrapper,
                focusedField === 'email' && styles.inputWrapperFocused,
              ]}>
                <Mail size={17} color={focusedField === 'email' ? theme.colors.primary : theme.colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={theme.colors.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={[
                styles.inputWrapper,
                focusedField === 'password' && styles.inputWrapperFocused,
              ]}>
                <Lock size={17} color={focusedField === 'password' ? theme.colors.primary : theme.colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder={activeTab === 'signup' ? 'Create a password' : 'Enter your password'}
                  placeholderTextColor={theme.colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}>
                  {showPassword ? (
                    <EyeOff size={17} color={theme.colors.textSecondary} />
                  ) : (
                    <Eye size={17} color={theme.colors.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
              
              {/* Password Strength Indicator */}
              {activeTab === 'signup' && password.length > 0 && (
                <View style={styles.passwordStrength}>
                  <View style={[styles.strengthBar, { backgroundColor: passwordStrength >= 1 ? theme.colors.success : theme.colors.border }]} />
                  <View style={[styles.strengthBar, { backgroundColor: passwordStrength >= 2 ? theme.colors.success : theme.colors.border }]} />
                  <View style={[styles.strengthBar, { backgroundColor: passwordStrength >= 3 ? theme.colors.success : theme.colors.border }]} />
                </View>
              )}

              {activeTab === 'login' && (
                <TouchableOpacity style={styles.forgotPassword}>
                  <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Error Banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Primary Button */}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSubmit}
            disabled={isLoading}
            activeOpacity={0.85}>
            {isLoading ? (
              <ActivityIndicator color={theme.colors.cream} />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>
                  {activeTab === 'signup' ? 'Create account' : 'Log in'}
                </Text>
                <ArrowRight size={18} color={theme.colors.cream} />
              </>
            )}
          </TouchableOpacity>

          {/* Legal Text */}
          <Text style={styles.legalText}>
            By continuing you agree to our{' '}
            <Text style={styles.legalLink}>Terms</Text>
            {' '}and{' '}
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Text>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Button */}
          <TouchableOpacity style={styles.googleButton}>
            <Text style={styles.googleIcon}>G</Text>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  hero: {
    backgroundColor: theme.colors.heroBg,
    paddingTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[24],
    position: 'relative',
    overflow: 'hidden',
  },
  heroCircles: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  circle: {
    position: 'absolute',
    borderRadius: 200,
    backgroundColor: theme.colors.heroCircle,
  },
  circleTopRight: {
    top: -100,
    right: -100,
    width: 300,
    height: 300,
  },
  circleBottomLeft: {
    bottom: -80,
    left: -80,
    width: 250,
    height: 250,
  },
  heroTop: {
    marginBottom: theme.spacing[32],
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[8],
  },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '500',
    color: theme.colors.cream,
    fontFamily: theme.fontFamily.regular,
  },
  heroBottom: {
    paddingBottom: theme.spacing[24],
  },
  stepLabel: {
    fontSize: 13,
    color: theme.colors.mutedGreen,
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  heroHeading: {
    fontSize: 26,
    fontWeight: '500',
    color: theme.colors.cream,
    lineHeight: 34,
    fontFamily: theme.fontFamily.regular,
  },
  zigzag: {
    marginTop: -1,
  },
  formContainer: {
    flex: 1,
  },
  formScrollContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[24],
    paddingTop: theme.spacing[24],
    paddingBottom: theme.spacing[24],
  },
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: theme.colors.border,
    borderRadius: 12,
    padding: 3,
    marginBottom: theme.spacing[24],
  },
  segment: {
    flex: 1,
    paddingVertical: theme.spacing[8],
    alignItems: 'center',
    borderRadius: 9,
  },
  segmentActive: {
    backgroundColor: theme.colors.cream,
  },
  segmentText: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  segmentTextActive: {
    color: theme.colors.textPrimary,
  },
  formFields: {
    marginBottom: theme.spacing[24],
  },
  inputContainer: {
    marginBottom: theme.spacing[16],
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing[8],
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
  inputWrapperFocused: {
    borderBottomColor: theme.colors.primary,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
  eyeIcon: {
    padding: theme.spacing[4],
  },
  passwordStrength: {
    flexDirection: 'row',
    gap: theme.spacing[4],
    marginTop: theme.spacing[8],
  },
  strengthBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginTop: theme.spacing[8],
  },
  forgotPasswordText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[8],
    backgroundColor: theme.colors.primary,
    height: 52,
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
    fontSize: 15,
    fontWeight: '500',
    fontFamily: theme.fontFamily.regular,
  },
  legalText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing[16],
    fontFamily: theme.fontFamily.regular,
  },
  legalLink: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
  },
  errorBanner: {
    backgroundColor: theme.colors.danger + '20',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: 8,
    padding: theme.spacing[12],
    marginBottom: theme.spacing[16],
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: theme.fontFamily.regular,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: theme.spacing[24],
    gap: theme.spacing[12],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  dividerText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fontFamily.regular,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 14,
    backgroundColor: theme.colors.background,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    gap: theme.spacing[8],
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  googleButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textPrimary,
    fontFamily: theme.fontFamily.regular,
  },
});