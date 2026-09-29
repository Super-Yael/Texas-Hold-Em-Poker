"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Trophy, X } from "lucide-react";
import type { AccountHandHistoryItem } from "@/lib/rooms";
import { matchTime, money } from "@/lib/format";

export default function AccountHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [matches, setMatches] = useState<AccountHandHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    fetch("/api/users/history", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "历史记录载入失败");
        return data.matches as AccountHandHistoryItem[];
      })
      .then((history) => {
        if (active) setMatches(history);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "历史记录载入失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  const wins = matches.filter((match) => match.won).length;

  return createPortal(
    <div
      className="account-history-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="account-history-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-history-title"
      >
        <header className="account-history-heading">
          <div>
            <span className="section-overline">PLAYER RECORD</span>
            <h2 id="account-history-title">账号历史记录</h2>
            <p>你参与过的每手结束记录（最近 100 手）</p>
          </div>
          <button type="button" className="room-history-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="account-history-summary">
          <span>
            记录手数 <b>{matches.length}</b>
          </span>
          <span>
            获胜手数 <b>{wins}</b>
          </span>
        </div>
        <div className="account-history-list">
          {loading && matches.length === 0 && !error && (
            <div className="room-history-empty">
              <LoaderCircle className="spin" size={17} />
              正在载入历史记录…
            </div>
          )}
          {error && <div className="room-history-empty history-error">{error}</div>}
          {!loading && !error && matches.length === 0 && (
            <div className="room-history-empty">还没有牌局记录</div>
          )}
          {matches.map((match) => {
            return (
              <article className="account-history-match" key={`${match.gameId}:${match.handNo}`}>
                <div className="account-history-match-main">
                  <Trophy size={17} aria-hidden="true" />
                  <div>
                    <b>{match.won ? "你赢下本手" : match.outcome}</b>
                    <span>
                      房间 {match.roomId} · 第 {match.handNo} 手 · {match.playerCount} 人
                    </span>
                  </div>
                </div>
                <div className="account-history-match-result">
                  <b>{money(match.stack)} 点</b>
                  <time>{matchTime(match.completedAt)}</time>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>,
    document.body,
  );
}
