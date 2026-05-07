import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";

interface IntroAnimationProps {
  onComplete: () => void;
}

export function IntroAnimation({ onComplete }: IntroAnimationProps) {
  const [phase, setPhase] = useState<"flash" | "title" | "out">("flash");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("title"), 700);
    const t2 = setTimeout(() => setPhase("out"), 3200);
    const t3 = setTimeout(() => onComplete(), 3900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {phase !== "out" && (
        <motion.div
          key="intro"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          onClick={() => onComplete()}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center cursor-pointer overflow-hidden"
          style={{
            background: "radial-gradient(ellipse at center, hsl(225 30% 8%) 0%, hsl(225 35% 3%) 70%, #000 100%)",
          }}
        >
          {/* Lightning flash */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.2, 1, 0] }}
            transition={{ duration: 0.8, times: [0, 0.05, 0.15, 0.25, 1] }}
            style={{ background: "linear-gradient(120deg, transparent 40%, hsl(210 100% 75% / 0.55) 50%, transparent 60%)" }}
          />
          {/* Lightning bolt icon */}
          <motion.div
            initial={{ scale: 0, rotate: -45, opacity: 0 }}
            animate={
              phase === "flash"
                ? { scale: [0, 1.6, 1.2], rotate: [-45, 10, 0], opacity: [0, 1, 1] }
                : { scale: 0.6, opacity: 0, y: -100 }
            }
            transition={{ duration: 0.7, ease: "backOut" }}
            className="absolute"
          >
            <Zap className="h-32 w-32 text-cyan-300" style={{ filter: "drop-shadow(0 0 30px hsl(185 100% 50%)) drop-shadow(0 0 60px hsl(210 100% 60%))" }} />
          </motion.div>

          {/* Title */}
          <AnimatePresence>
            {phase === "title" && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="relative z-10 flex flex-col items-center text-center px-6"
              >
                <motion.h1
                  initial={{ letterSpacing: "0.5em", opacity: 0 }}
                  animate={{ letterSpacing: "0.05em", opacity: 1 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="font-bold text-5xl md:text-7xl text-transparent bg-clip-text"
                  style={{
                    backgroundImage: "linear-gradient(135deg, hsl(210 100% 80%) 0%, hsl(185 100% 65%) 50%, hsl(270 90% 75%) 100%)",
                    filter: "drop-shadow(0 0 25px hsl(210 100% 55% / 0.6))",
                  }}
                >
                  RAG System
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.6 }}
                  className="mt-4 text-lg md:text-2xl font-light tracking-[0.3em] uppercase text-cyan-200/80"
                  style={{ textShadow: "0 0 20px hsl(185 100% 50% / 0.5)" }}
                >
                  &amp; Agentic AI Workflow
                </motion.p>
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.8, duration: 0.6 }}
                  className="mt-8 h-px w-64 bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent"
                />
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.5 }}
                  transition={{ delay: 1.5, duration: 0.5 }}
                  className="mt-12 text-xs tracking-widest text-muted-foreground/60 uppercase"
                >
                  Click anywhere to enter
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}