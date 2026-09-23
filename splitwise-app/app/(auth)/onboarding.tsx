import { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, SafeAreaView } from 'react-native';
import { Receipt, Users, TrendingUp } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useRouter } from 'expo-router';

interface Slide {
  id: string;
  icon: React.ReactNode;
  heading: string;
  subtext: string;
}

const slides: Slide[] = [
  {
    id: '1',
    icon: <Receipt size={80} color={theme.colors.primary} />,
    heading: 'Split bills in seconds',
    subtext: 'Scan any receipt and split it instantly with friends',
  },
  {
    id: '2',
    icon: <Users size={80} color={theme.colors.primary} />,
    heading: 'Split with your squad',
    subtext: 'Create groups for trips, flatmates, or daily expenses',
  },
  {
    id: '3',
    icon: <TrendingUp size={80} color={theme.colors.primary} />,
    heading: 'Track every rupee',
    subtext: 'See who owes what, settle up with one tap',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    }
  };

  const handleGetStarted = () => {
    router.push('/(auth)/signup');
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={styles.slide}>
      {/* Decorative Background Circle */}
      <View style={styles.decorativeCircle} />
      
      {/* Icon with Concentric Circles */}
      <View style={styles.iconContainer}>
        <View style={styles.outerRing} />
        <View style={styles.iconCircle}>
          {item.icon}
        </View>
      </View>

      {/* Text Content */}
      <Text style={styles.heading}>{item.heading}</Text>
      <Text style={styles.subtext}>{item.subtext}</Text>
    </View>
  );

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {slides.map((_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            index === currentIndex && styles.dotActive,
          ]}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / event.nativeEvent.layoutMeasurement.width);
          setCurrentIndex(index);
        }}
        contentContainerStyle={styles.flatListContent}
      />

      {/* Bottom Section with consistent button positioning */}
      <View style={styles.bottomSection}>
        {renderDots()}
        
        <View style={styles.buttonContainer}>
          {currentIndex < slides.length - 1 ? (
            <TouchableOpacity style={styles.actionButton} onPress={handleNext}>
              <Text style={styles.actionButtonText}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.actionButton} onPress={handleGetStarted}>
              <Text style={styles.actionButtonText}>Get Started</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flatListContent: {
    flexGrow: 1,
  },
  slide: {
    width: '100%',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[32],
    position: 'relative',
  },
  decorativeCircle: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: theme.colors.primary,
    opacity: 0.08,
  },
  iconContainer: {
    marginBottom: theme.spacing[24],
    position: 'relative',
  },
  outerRing: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -20,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: theme.colors.accentBg,
    opacity: 0.5,
  },
  iconCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: theme.colors.accentBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heading: {
    fontSize: 30,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: theme.spacing[12],
    fontFamily: theme.fontFamily.regular,
  },
  subtext: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: theme.fontFamily.regular,
  },
  bottomSection: {
    paddingHorizontal: theme.spacing[24],
    paddingBottom: theme.spacing[32],
    alignItems: 'center',
    gap: theme.spacing[16],
  },
  buttonContainer: {
    width: '100%',
  },
  actionButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing[16],
    borderRadius: 16,
    marginHorizontal: theme.spacing[24],
    shadowColor: theme.colors.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  actionButtonText: {
    color: theme.colors.surface,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: theme.fontFamily.regular,
    textAlign: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: theme.spacing[8],
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
  },
  dotActive: {
    width: 24,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
});