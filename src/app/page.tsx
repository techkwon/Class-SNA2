"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import Dashboard from "@/components/dashboard/Dashboard";
import { type ParseResult } from "@/lib/parser";
import { UploadPage } from "@/components/upload/UploadPage";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function Home() {
  const [analyzedData, setAnalyzedData] = useState<ParseResult | null>(null);

  if (analyzedData) {
    return (
      <Dashboard
        data={analyzedData}
        onReset={() => setAnalyzedData(null)}
        onReplaceData={(next) => setAnalyzedData(next)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans relative">
      <motion.div
        className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full bg-primary/15 blur-3xl"
        animate={{ x: [0, 28, 0], y: [0, 18, 0] }}
        transition={{ repeat: Infinity, duration: 9, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-28 -right-24 h-80 w-80 rounded-full bg-accent/15 blur-3xl"
        animate={{ x: [0, -32, 0], y: [0, -20, 0] }}
        transition={{ repeat: Infinity, duration: 10.5, ease: "easeInOut" }}
      />
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur px-4 sm:px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card shadow-lg">
              <Image src="/icon.png" alt="Class-SNA 아이콘" width={24} height={24} priority className="h-6 w-6 rounded-md" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg sm:text-xl font-extrabold">Class-SNA</h1>
              <p className="hidden sm:block text-xs text-muted-foreground">학급 네트워크 분석 플랫폼</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">Beta</span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full flex justify-center items-center px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <UploadPage onAnalysisComplete={(data: ParseResult) => setAnalyzedData(data)} />
      </main>

      <footer className="py-6 text-center text-muted-foreground font-medium text-sm mt-auto">
        <p>© 2026 선생님을 위한 교우관계 네트워크 분석 도구</p>
      </footer>
    </div>
  );
}
