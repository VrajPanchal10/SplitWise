import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/constants/theme';

interface ReceiptCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const ZigzagPattern: React.FC<{ width: number }> = ({ width }) => {
  const zigzagHeight = 12;
  const zigzagWidth = 10;
  const segments = Math.ceil(width / zigzagWidth);
  
  let path = `M 0 0`;
  for (let i = 0; i < segments; i++) {
    const x1 = i * zigzagWidth;
    const x2 = (i + 1) * zigzagWidth;
    const midX = (x1 + x2) / 2;
    
    if (i % 2 === 0) {
      path += ` L ${x1} ${zigzagHeight} L ${midX} 0`;
    } else {
      path += ` L ${x1} 0 L ${midX} ${zigzagHeight}`;
    }
  }
  path += ` L ${width} 0 L ${width} ${zigzagHeight} L 0 ${zigzagHeight} Z`;
  
  return (
    <Svg width={width} height={zigzagHeight} style={styles.svg}>
      <Path d={path} fill={theme.colors.surface} stroke={theme.colors.border} strokeWidth="1" />
    </Svg>
  );
};

export const ReceiptCard: React.FC<ReceiptCardProps> = ({ children, style }) => {
  const [cardWidth, setCardWidth] = React.useState(0);

  return (
    <View 
      style={[styles.container, style]} 
      onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.cardContent}>
        {children}
      </View>
      {cardWidth > 0 && <ZigzagPattern width={cardWidth} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius[16],
    overflow: 'hidden',
    marginHorizontal: theme.spacing[16],
    marginVertical: theme.spacing[8],
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardContent: {
    padding: theme.spacing[16],
  },
  svg: {
    position: 'absolute',
    bottom: -12,
    left: 0,
  },
});