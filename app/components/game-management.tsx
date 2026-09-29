"use client";

import { useState } from "react";
import { Users, X, MailPlus } from "lucide-react";
import type { RoomSettings } from "@/lib/settings";
import type { RoomView, ServerUser } from "@/lib/table-types";
import { money } from "@/lib/format";
import Avatar from "./avatar";
import RoomSettingsPanel from "./room-settings-panel";

export default function GameManagement({
  view,
  users,
  busy,
  error,
  onClose,
  onSave,
  onInvite,
  onKick,
  onTopUp,
}: {
  view: RoomView;
  users: ServerUser[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (settings: RoomSettings, resetBlinds?: boolean) => void;
  onInvite: (userId: string) => void;
  onKick: (userId: string) => void;
  onTopUp: (userId: string, amount: number) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const game = view.game!;
  const settings = view.room.settings;
  const pending = view.invitations.filter((invitation) => invitation.status === "pending").length;
  const full = view.members.length + pending >= settings.maxPlayers;
  return (
    <div
      className="game-manage-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-manage-title"
    >
      <div className="game-manage-card">
        <div className="game-manage-heading">
          <div>
            <span className="section-overline">BETWEEN HANDS</span>
            <h2 id="game-manage-title">局内管理</h2>
            <p>房主可在两手之间调整规则、人数和筹码。修改后，大家需要重新确认继续。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭局内管理">
            <X size={19} />
          </button>
        </div>
        <RoomSettingsPanel
          settings={settings}
          isHost
          busy={busy}
          betweenHands
          currentBlinds={{ smallBlind: game.smallBlind, bigBlind: game.bigBlind }}
          onSave={onSave}
        />
        <section className="lobby-panel manage-players-panel">
          <div className="panel-heading">
            <div>
              <Users size={16} />
              <b>
                当前玩家 · {view.members.length}/{settings.maxPlayers}
              </b>
            </div>
            <span>只能在两手之间操作</span>
          </div>
          <div className="manage-player-list">
            {view.members.map((member) => {
              const player = game.players.find((entry) => entry.id === member.id);
              const amount = amounts[member.id] ?? String(settings.startingStack);
              const validAmount =
                Number.isSafeInteger(Number(amount)) &&
                Number(amount) >= 1 &&
                Number(amount) <= 10_000_000;
              return (
                <div className="manage-player" key={member.id}>
                  <Avatar avatar={member.avatar} nickname={member.nickname} size="small" />
                  <div className="manage-player-name">
                    <b>
                      {member.nickname}
                      {member.id === view.room.hostId ? " · 房主" : ""}
                    </b>
                    <span>当前筹码 {money(player?.stack ?? 0)}</span>
                  </div>
                  <label>
                    补充
                    <input
                      type="number"
                      min="1"
                      max="10000000"
                      step="1"
                      value={amount}
                      onChange={(event) =>
                        setAmounts((previous) => ({ ...previous, [member.id]: event.target.value }))
                      }
                      aria-label={`为 ${member.nickname} 补充筹码`}
                    />
                  </label>
                  <button
                    type="button"
                    className="manage-add-chips"
                    disabled={busy || !validAmount}
                    onClick={() => onTopUp(member.id, Number(amount))}
                  >
                    添加
                  </button>
                  {member.id !== view.room.hostId && (
                    <button
                      type="button"
                      className="manage-kick"
                      disabled={busy || view.members.length <= 2}
                      onClick={() => onKick(member.id)}
                    >
                      移出
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="lobby-panel manage-invites-panel">
          <div className="panel-heading">
            <div>
              <MailPlus size={16} />
              <b>邀请新玩家</b>
            </div>
            <span>
              {full
                ? "座位已满"
                : `还可邀请 ${settings.maxPlayers - view.members.length - pending} 人`}
            </span>
          </div>
          <div className="manage-invite-list">
            {users.filter((person) => !view.members.some((member) => member.id === person.id))
              .length === 0 ? (
              <p>暂无可邀请的其他玩家</p>
            ) : (
              users
                .filter((person) => !view.members.some((member) => member.id === person.id))
                .map((person) => {
                  const sent = view.invitations.some(
                    (invitation) =>
                      invitation.userId === person.id && invitation.status === "pending",
                  );
                  return (
                    <div className="manage-invite" key={person.id}>
                      <Avatar avatar={person.avatar} nickname={person.nickname} size="small" />
                      <b>{person.nickname}</b>
                      <span>{person.busy ? "在其他牌桌" : person.online ? "在线" : "离线"}</span>
                      <button
                        type="button"
                        disabled={busy || full || person.busy || sent}
                        onClick={() => onInvite(person.id)}
                      >
                        {sent ? "已邀请" : "邀请"}
                      </button>
                    </div>
                  );
                })
            )}
          </div>
        </section>
        {error && (
          <div className="manage-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
