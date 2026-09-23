import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { theme } from '@/constants/theme';

interface ZigzagEdgeProps {
  fill?: string;
  height?: number;
  width?: number;
}

export const ZigzagEdge: React.FC<ZigzagEdgeProps> = ({
  fill = theme.colors.heroBg,
  height = 20,
  width = 400,
}) => {
  const zigzagHeight = height;
  const zigzagWidth = 20;
  const segments = Math.ceil(width / zigzagWidth);
  
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
    <Svg width={segments * zigzagWidth} height={zigzagHeight} style={{ marginTop: -1 }}>
      <Path d={path} fill={fill} />
    </Svg>
  );
};