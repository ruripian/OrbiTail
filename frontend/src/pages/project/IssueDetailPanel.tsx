/**
 * 이슈 상세 모달 패널
 * - 화면 중앙에 팝업으로 표시 (슬라이드오버 → 센터 모달)
 * - 배경 블러 오버레이, 바깥 클릭 / Escape 로 닫기
 */

import { useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useMotion } from "@/lib/motion-provider";
import { Z_MODAL_OVERLAY, Z_MODAL } from "@/constants/z-index";
import { IssueDetailPage } from "./IssueDetailPage";

interface Props {
  issueId: string;
  onClose: () => void;
  /** 다른 프로젝트의 이슈를 띄울 때 사용 — 미지정 시 현재 라우트 params 사용 */
  workspaceSlug?: string;
  projectId?: string;
}

export function IssueDetailPanel({ issueId, onClose, workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { isRich, spring } = useMotion();

  /* Escape 키로 닫기 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* 오버레이 + 모달 wrapper */
  const Overlay = isRich ? motion.div : "div";
  const Modal = isRich ? motion.div : "div";

  const overlayProps = isRich ? {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2 },
  } : {};

  const modalProps = isRich ? {
    initial: { opacity: 0, scale: 0.95, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 20 },
    transition: spring,
  } : {};

  return (
    <>
      {/* 반투명 배경 오버레이 */}
      <Overlay
        className="fixed inset-0 bg-background/60"
        style={{ zIndex: Z_MODAL_OVERLAY }}
        onClick={onClose}
        {...overlayProps}
      />

      {/* 중앙 모달 컨테이너 — 데스크톱 해상도별 높이 유동화 */}
      <div className="fixed inset-0 flex items-center justify-center p-4 lg:p-6 pointer-events-none" style={{ zIndex: Z_MODAL }}>
        <Modal
          className="relative w-full max-w-[1400px] h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)] max-h-[960px] flex flex-col glass rounded-2xl border border-border shadow-2xl pointer-events-auto"
          {...modalProps}
        >
          {/* 닫기 버튼 — 콘텐츠와 겹치지 않도록 z-20 + 크기 확대 */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>

          {/* 이슈 상세 컨텐츠 */}
          <div className="flex-1 overflow-hidden rounded-2xl">
            <IssueDetailPage
              issueIdOverride={issueId}
              workspaceSlugOverride={workspaceSlug}
              projectIdOverride={projectId}
              inPanel
              onClose={onClose}
            />
          </div>
        </Modal>
      </div>
    </>
  );
}
