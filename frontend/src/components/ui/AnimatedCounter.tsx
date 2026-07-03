import { useEffect, useRef } from 'react';
import { useSpring, useMotionValue, motion } from 'framer-motion';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}

export default function AnimatedCounter({ value, duration = 1.5, className = '', format }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, { duration: duration * 1000, bounce: 0 });

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest) => {
      if (ref.current) {
        const rounded = Math.round(latest);
        ref.current.textContent = format ? format(rounded) : rounded.toString();
      }
    });
    return unsubscribe;
  }, [springValue, format]);

  return <motion.span ref={ref} className={className}>0</motion.span>;
}
