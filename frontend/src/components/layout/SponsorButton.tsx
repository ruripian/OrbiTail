/**
 * 후원 플로팅 버튼 — 우측 하단 고정
 * 클릭 시 Ko-fi 인앱 결제 패널 (iframe) + GitHub Sponsors 링크
 */

import { useState } from "react";
import { Heart, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const KOFI_USER = "ruripian";
const GITHUB_USER = "ruripian";

export function SponsorButton() {
  const [open, setOpen] = useState(false);

  if (import.meta.env.VITE_SHOW_SPONSOR === "false") return null;

  return (
    <>
      {/* 플로팅 버튼 — 우측 하단 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-all duration-base",
          open
            ? "bg-rose-500 text-white"
            : "bg-background border border-border text-muted-foreground hover:text-foreground hover:border-rose-300 hover:shadow-xl"
        )}
      >
        <Heart className={cn("h-3.5 w-3.5", open && "fill-white")} />
        <span>Support</span>
      </button>

      {/* 후원 패널 — Ko-fi iframe + GitHub Sponsors 링크 */}
      {open && (
        <div className="fixed bottom-14 right-4 z-50 w-[300px] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-base">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" />
              <span className="text-sm font-semibold">Support this project</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Ko-fi iframe — 인앱 결제 */}
          <iframe
            src={`https://ko-fi.com/${KOFI_USER}/?hidefeed=true&widget=true&embed=true`}
            className="w-full border-0"
            style={{ height: 570 }}
            title="Ko-fi donate"
          />

          {/* GitHub Sponsors 링크 */}
          <div className="px-4 py-2.5 border-t border-border">
            <a
              href={`https://github.com/sponsors/${GITHUB_USER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              GitHub Sponsors
            </a>
          </div>
        </div>
      )}
    </>
  );
}
