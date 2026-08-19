import { useEffect, useRef } from "react";

interface Options {
  hasNextPage: boolean;
  /** 로딩 중에는 관찰해도 재호출하지 않는다 — 같은 페이지를 중복 요청하지 않기 위함 */
  isFetching: boolean;
  onLoadMore: () => void;
  /** 바닥에 닿기 전에 미리 불러올 여유 거리 */
  rootMargin?: string;
}

/**
 * 목록 끝에 둔 sentinel 이 화면에 가까워지면 다음 페이지를 불러오는 훅.
 *
 * 반환한 ref 를 리스트 마지막 빈 div 에 달면 된다. root 를 지정하지 않아(=뷰포트 기준)
 * 페이지가 자체 스크롤 컨테이너를 갖는 구조에서도 그대로 동작한다.
 */
export function useInfiniteScroll({ hasNextPage, isFetching, onLoadMore, rootMargin = "300px" }: Options) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /* onLoadMore 는 렌더마다 새 함수라 의존성에 넣으면 observer 가 매번 재생성된다 — ref 로 최신값만 유지 */
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || isFetching) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, rootMargin]);

  return sentinelRef;
}
