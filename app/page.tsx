"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  Copy,
  Crown,
  Expand,
  History,
  LoaderCircle,
  LogOut,
  MailPlus,
  MoreHorizontal,
  Plus,
  Settings2,
  Spade,
  Trophy,
  Users,
  X,
} from "lucide-react";
import Avatar from "./components/avatar";
import RoomSettingsPanel from "./components/room-settings-panel";
import GameManagement from "./components/game-management";
import AvatarUpload from "./components/avatar-upload";
import AccountHistory from "./components/account-history";
import TableCanvas from "./table-canvas";
import { parseRoomAction } from "@/lib/room-command";
import { TableRealtime } from "@/lib/realtime/client";
import type { RoomSettings } from "@/lib/settings";

import type {
  Profile,
  ServerUser,
  Game,
  Invite,
  MatchHistoryItem,
  RoomView,
} from "@/lib/table-types";

const phaseName: Record<Game["stage"], string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  complete: "本手结束",
};
import { money, matchTime } from "@/lib/format";

async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败");
  return data;
}

function ConnectionWarning({ message }: { message: string }) {
  return message ? (
    <div className="connection-warning" role="status">
      {message}
    </div>
  ) : null;
}

export default function PokerHome() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState<Profile | null>(null);
  const [roomView, setRoomView] = useState<RoomView | null>(null);
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [incoming, setIncoming] = useState<Invite[]>([]);
  const [nickname, setNickname] = useState("");
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountHistoryOpen, setAccountHistoryOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [matchHistory, setMatchHistory] = useState<MatchHistoryItem[]>([]);
  const [showInviteNotice, setShowInviteNotice] = useState<Invite | null>(null);
  const realtime = useRef<TableRealtime | null>(null);
  const roomViewRef = useRef(roomView);
  roomViewRef.current = roomView;
  const syncing = useRef(false);
  const dismissedNotices = useRef(new Set<string>());
  const syncGeneration = useRef(0);
  const mutating = useRef(false);
  const roomScreenRef = useRef<HTMLElement | null>(null);
  const gameToolsRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sync = useCallback(async () => {
    if (
      syncing.current ||
      mutating.current ||
      !user ||
      roomViewRef.current?.room.status === "playing"
    )
      return;
    syncing.current = true;
    const generation = ++syncGeneration.current;
    try {
      let view = roomViewRef.current;
      if (!view) {
        const roomResponse = await fetch("/api/rooms", { cache: "no-store" });
        const roomData = await readResponse(roomResponse);
        if (generation !== syncGeneration.current) return;
        view = roomData.view;
        roomViewRef.current = view;
        setRoomView(view);
      }
      const roomData = { view };
      if (roomData.view?.room.status === "playing") {
        setSyncError("");
        return;
      }
      const [inviteResponse, usersResponse] = await Promise.all([
        fetch("/api/invitations", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      const [inviteData, usersData] = await Promise.all([
        readResponse(inviteResponse),
        readResponse(usersResponse),
      ]);
      if (generation !== syncGeneration.current) return;
      setIncoming(inviteData.incoming ?? []);
      setUsers(usersData.users ?? []);
      setSyncError("");
      const visibleInvites = (inviteData.incoming ?? []).filter(
        (invite: Invite) => !dismissedNotices.current.has(invite.id),
      );
      if (!roomData.view && visibleInvites.length)
        setShowInviteNotice((previous) =>
          previous && visibleInvites.some((invite: Invite) => invite.id === previous.id)
            ? previous
            : visibleInvites[0],
        );
      else setShowInviteNotice(null);
    } catch (err) {
      if (generation !== syncGeneration.current) return;
      if (err instanceof Error && err.message.includes("注册")) setUser(null);
      else setSyncError("连接中断，牌局状态可能已过期；正在重试…");
    } finally {
      syncing.current = false;
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then(readResponse)
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user || roomView?.room.status === "playing") return;
    const poll = () => {
      if (document.visibilityState === "visible") void sync();
    };
    poll();
    const timer = window.setInterval(poll, 3500);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [user, roomView?.room.status, sync]);
  useEffect(() => {
    if (!user || !roomView?.room.id) return;
    const connection = new TableRealtime(
      roomView.room.id,
      (view) => {
        syncGeneration.current += 1;
        roomViewRef.current = view;
        setRoomView(view);
        if (!view) void sync();
      },
      setSyncError,
    );
    realtime.current = connection;
    connection.start();
    return () => {
      connection.stop();
      if (realtime.current === connection) realtime.current = null;
    };
  }, [user?.id, roomView?.room.id, sync]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (roomView?.game?.stage !== "complete") setManageOpen(false);
  }, [roomView?.game?.stage]);
  useEffect(() => {
    if (!manageOpen || roomView?.room.status !== "playing" || roomView.room.hostId !== user?.id)
      return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/users", { cache: "no-store" });
        const data = await readResponse(response);
        if (active) setUsers(data.users ?? []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "玩家列表载入失败");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [manageOpen, roomView?.room.status, roomView?.room.hostId, user?.id]);
  const activeRoomId = roomView?.room.status === "playing" ? roomView.room.id : null;
  const currentPlayer = roomView?.game?.players.find((p) => p.id === user?.id);
  useEffect(() => {
    setGameMenuOpen(false);
    setHistoryOpen(false);
    setCloseConfirmOpen(false);
  }, [activeRoomId]);
  useEffect(() => {
    if (roomView?.game?.closeRequest) setCloseConfirmOpen(false);
  }, [roomView?.game?.closeRequest]);
  useEffect(() => {
    if (!closeConfirmOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCloseConfirmOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeConfirmOpen]);
  useEffect(() => {
    if (!gameMenuOpen && !historyOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (gameToolsRef.current?.contains(event.target as Node)) return;
      setGameMenuOpen(false);
      setHistoryOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGameMenuOpen(false);
      setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [gameMenuOpen, historyOpen]);
  useEffect(() => {
    if (!historyOpen || !activeRoomId) return;
    let active = true;
    let loading = false;
    setMatchHistory([]);
    const load = async () => {
      if (loading) return;
      loading = true;
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const response = await fetch(`/api/rooms/${activeRoomId}/history`, { cache: "no-store" });
        const data = await readResponse(response);
        if (active) setMatchHistory(data.matches ?? []);
      } catch (err) {
        if (active) setHistoryError(err instanceof Error ? err.message : "对局历史载入失败");
      } finally {
        loading = false;
        if (active) setHistoryLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [historyOpen, activeRoomId]);
  useEffect(() => {
    const game = roomView?.game;
    if (game?.canAct && game.canRaise && currentPlayer) {
      const max = currentPlayer.streetBet + currentPlayer.stack;
      setRaiseTo(Math.min(max, game.minRaiseTo + Math.max(2, Math.round(game.pot * 0.55))));
    } else setRaiseOpen(false);
  }, [
    roomView?.game?.handNo,
    roomView?.game?.stage,
    roomView?.game?.canAct,
    roomView?.game?.canRaise,
    roomView?.game?.minRaiseTo,
    roomView?.game?.highestBet,
    roomView?.game?.pot,
    currentPlayer?.stack,
    currentPlayer?.streetBet,
  ]);

  const mutate = async (url: string, body: unknown) => {
    if (busy) return null;
    setBusy(true);
    mutating.current = true;
    syncGeneration.current += 1;
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return await readResponse(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      if (url === "/api/auth" && message.includes("已经被使用")) {
        setAuthMode("login");
        setError("这个昵称已经注册，已切换到登录；点击“登录牌桌”继续。");
      } else setError(message);
      return null;
    } finally {
      setBusy(false);
      mutating.current = false;
    }
  };
  const uploadAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || file.size > 500 * 1024) {
      setError("头像请使用小于 500KB 的 PNG、JPG 或 WebP 图片");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      setAvatarData(data);
      setAvatarPreview(data);
      setError("");
    };
    reader.readAsDataURL(file);
  };
  const saveAvatar = async (avatar: string) => {
    const data = await mutate("/api/auth", { action: "update-avatar", avatar });
    if (data?.user) {
      setUser(data.user);
      setToast("头像已更新");
      void sync();
    }
  };
  const register = async (event: FormEvent) => {
    event.preventDefault();
    if (!nickname.trim()) {
      setError("请先填写昵称");
      return;
    }
    const data = await mutate("/api/auth", { action: "register", nickname, avatar: avatarData });
    if (data?.user) {
      setUser(data.user);
      setError("");
    }
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!nickname.trim()) {
      setError("请输入注册时使用的昵称");
      return;
    }
    const data = await mutate("/api/auth", { action: "login", nickname });
    if (data?.user) {
      setUser(data.user);
      setError("");
    }
  };
  const createRoom = async () => {
    const data = await mutate("/api/rooms", {});
    if (data?.view) {
      setRoomView(data.view);
      setError("");
    }
  };
  const doRoomAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!roomView || busy || mutating.current) return false;
    setBusy(true);
    mutating.current = true;
    syncGeneration.current += 1;
    setError("");
    try {
      if (!realtime.current) throw new Error("正在连接牌桌，请稍后再操作");
      await realtime.current.action(parseRoomAction({ action, ...extra }));
      setRaiseOpen(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
      mutating.current = false;
    }
  };
  const saveRoomSettings = async (settings: RoomSettings, resetBlinds = false) => {
    if (await doRoomAction("settings", { settings, resetBlinds })) setToast("牌桌设置已保存");
  };
  const addChips = async (userId: string, amount: number) => {
    if (await doRoomAction("add-chips", { userId, amount })) setToast("筹码已补充");
  };
  const kickPlayer = async (userId: string) => {
    if (await doRoomAction("kick", { userId })) setToast("玩家已移出牌桌");
  };
  const inviteUser = async (targetId: string) => {
    if (!roomView) return;
    const data = await mutate("/api/invitations", {
      action: "invite",
      roomId: roomView.room.id,
      userId: targetId,
    });
    if (data?.ok) {
      setToast("邀请已发送");
      void sync();
    }
  };
  const respondInvite = async (invite: Invite, action: "accept" | "decline") => {
    const data = await mutate("/api/invitations", { action, invitationId: invite.id });
    if (data?.ok) {
      dismissedNotices.current.add(invite.id);
      setShowInviteNotice(null);
      if (action === "accept") setToast("已加入牌桌，等待房主开始");
      else setToast("已忽略这条邀请");
      void sync();
    }
  };
  const leaveRoom = () => doRoomAction("leave");
  const copyRoomId = async () => {
    if (!roomView) return;
    await navigator.clipboard?.writeText(roomView.room.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const enterFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void roomScreenRef.current?.requestFullscreen?.();
  };
  const closeAccountHistory = useCallback(() => setAccountHistoryOpen(false), []);

  if (checkingSession)
    return (
      <div className="screen-loading">
        <LoaderCircle className="spin" size={24} />
        <span>正在连接牌桌…</span>
      </div>
    );
  if (!user)
    return (
      <main className="register-screen">
        <div className="register-card">
          <div className="auth-brand">
            <div className="brand-mark">
              <Spade size={20} fill="currentColor" />
            </div>
            <div>
              <b>FELT CLUB</b>
              <span>德州扑克 · 好友牌桌</span>
            </div>
          </div>
          <div className="auth-mode-tabs">
            <button
              type="button"
              className={authMode === "register" ? "selected" : ""}
              onClick={() => {
                setAuthMode("register");
                setError("");
              }}
            >
              注册
            </button>
            <button
              type="button"
              className={authMode === "login" ? "selected" : ""}
              onClick={() => {
                setAuthMode("login");
                setError("");
              }}
            >
              已有账号登录
            </button>
          </div>
          <div className="auth-copy">
            <span className="section-overline">
              {authMode === "register" ? "CREATE YOUR PROFILE" : "WELCOME BACK"}
            </span>
            <h1>{authMode === "register" ? "先认识一下你。" : "欢迎回来。"}</h1>
            <p>
              {authMode === "register"
                ? "注册只需要一个昵称，头像可以之后再说。"
                : "输入注册时使用的昵称，继续进入牌桌。"}
            </p>
          </div>
          <form onSubmit={authMode === "register" ? register : login}>
            <label className="field-label" htmlFor="nickname">
              昵称 <b>必填</b>
            </label>
            <input
              id="nickname"
              className="nickname-input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={16}
              required
              autoComplete="username"
              placeholder="牌桌上怎么称呼你？"
              autoFocus
            />
            {authMode === "register" && (
              <div className="avatar-field">
                <div>
                  <span className="field-label">
                    头像 <small>选填</small>
                  </span>
                  <p>上传一张图片，朋友更容易认出你。</p>
                </div>
                <button
                  type="button"
                  className="avatar-picker"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Avatar avatar={avatarPreview} nickname={nickname || "?"} size="large" />
                  <span>{avatarPreview ? "更换头像" : "添加头像"}</span>
                  <Plus size={14} />
                </button>
                <input
                  className="avatar-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={uploadAvatar}
                />
              </div>
            )}
            {error && <div className="error-note">{error}</div>}
            <button className="primary-cta auth-submit" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}{" "}
              {authMode === "register" ? "创建个人资料" : "登录牌桌"} <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-foot">
            <span>
              {authMode === "register"
                ? "昵称用于识别你的牌桌身份"
                : "本牌桌用昵称识别账号，不设密码"}
            </span>
            <span>2–6 人好友牌局</span>
          </div>
        </div>
      </main>
    );

  if (roomView?.room.status === "lobby")
    return (
      <main className="lobby-screen">
        <ConnectionWarning message={syncError} />
        <AccountHistory open={accountHistoryOpen} onClose={closeAccountHistory} />
        <header className="lobby-topbar">
          <button className="back-button" onClick={leaveRoom}>
            <ArrowLeft size={16} /> 退出房间
          </button>
          <div className="room-wordmark">
            <Spade size={16} fill="currentColor" /> FELT CLUB <span>·</span> 房间大厅
          </div>
          <div className="user-chip">
            <AvatarUpload
              profile={user}
              onUpload={saveAvatar}
              onError={setError}
              onAccountHistory={() => setAccountHistoryOpen(true)}
              disabled={busy}
            />
            <span>{user.nickname}</span>
          </div>
        </header>
        <section className="lobby-content">
          <div className="lobby-heading">
            <div>
              <span className="section-overline">PRIVATE TABLE · 2–6 PLAYERS</span>
              <h1>好友牌桌</h1>
              <p>
                邀请最多 {roomView.room.settings.maxPlayers - 1}{" "}
                位朋友。大家加入后，房主就可以发牌。
              </p>
            </div>
            <div className="room-code" role="button" tabIndex={0} onClick={() => void copyRoomId()}>
              <span>房间号</span>
              <b>{roomView.room.id}</b>
              <span className="copy-label">
                <Copy size={13} /> {copied ? "已复制" : "复制"}
              </span>
            </div>
          </div>
          <div
            className={`lobby-grid ${user.id === roomView.room.hostId ? "" : "lobby-grid-single"}`}
          >
            <section className="lobby-panel seats-panel">
              <div className="panel-heading">
                <div>
                  <Users size={16} />
                  <b>牌桌座位</b>
                </div>
                <span>
                  {roomView.members.length} / {roomView.room.settings.maxPlayers} 人
                </span>
              </div>
              <div className="seat-list">
                {Array.from({ length: roomView.room.settings.maxPlayers }, (_, seat) => seat).map(
                  (seat) => {
                    const member = roomView.members.find((p) => p.seat === seat);
                    return (
                      <div className={`lobby-seat ${member ? "seat-occupied" : ""}`} key={seat}>
                        {member ? (
                          <>
                            <Avatar avatar={member.avatar} nickname={member.nickname} />
                            <div className="seat-player-name">
                              <b>
                                {member.nickname}
                                {member.id === roomView.room.hostId && (
                                  <span className="host-label">房主</span>
                                )}
                              </b>
                              <span>
                                <i className={member.online ? "online-dot" : "offline-dot"} />
                                {member.online ? "在线" : "暂离"}
                              </span>
                            </div>
                            {member.id === user.id && <span className="you-seat">你</span>}
                          </>
                        ) : (
                          <>
                            <div className="empty-seat-icon">
                              <Plus size={16} />
                            </div>
                            <span className="empty-seat-label">等待玩家加入</span>
                          </>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
              <div className="lobby-rule-note">
                <Spade size={13} /> 无限注德州扑克 <i /> {roomView.room.settings.deckCount} 副牌{" "}
                <i /> 盲注 {money(roomView.room.settings.smallBlind)} /{" "}
                {money(roomView.room.settings.bigBlind)} <i /> 每人{" "}
                {money(roomView.room.settings.startingStack)} 筹码
              </div>
              {user.id === roomView.room.hostId ? (
                <button
                  className="primary-cta start-game"
                  onClick={() => void doRoomAction("start")}
                  disabled={busy || roomView.members.length < 2}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Spade size={16} fill="currentColor" />
                  )}{" "}
                  {roomView.members.length < 2 ? "邀请至少一位玩家后开始" : "开始游戏"}{" "}
                  <ArrowRight size={17} />
                </button>
              ) : (
                <div className="waiting-host">
                  <LoaderCircle className="spin" size={16} /> 等房主邀请玩家并开始游戏…
                </div>
              )}
            </section>
            {user.id === roomView.room.hostId && (
              <section className="lobby-panel invite-panel">
                <div className="panel-heading">
                  <div>
                    <MailPlus size={16} />
                    <b>邀请玩家</b>
                  </div>
                  <span>服务器玩家</span>
                </div>
                <div className="invite-list">
                  {users.length === 0 ? (
                    <div className="empty-users">
                      <Users size={21} />
                      <span>还没有其他注册玩家</span>
                      <small>把这个页面分享给朋友，他们注册后就会出现在这里。</small>
                    </div>
                  ) : (
                    users.map((player) => {
                      const sent = roomView.invitations.some(
                        (i) => i.userId === player.id && i.status === "pending",
                      );
                      const member = roomView.members.some((m) => m.id === player.id);
                      return (
                        <div className="invite-user" key={player.id}>
                          <Avatar avatar={player.avatar} nickname={player.nickname} />
                          <div className="invite-user-copy">
                            <b>{player.nickname}</b>
                            <span>
                              <i className={player.online ? "online-dot" : "offline-dot"} />
                              {player.busy ? "在其他牌桌" : player.online ? "在线" : "离线"}
                            </span>
                          </div>
                          {member ? (
                            <span className="joined-tag">
                              <Check size={13} /> 已加入
                            </span>
                          ) : sent ? (
                            <span className="sent-tag">已邀请</span>
                          ) : (
                            <button
                              className="invite-button"
                              disabled={
                                busy ||
                                player.busy ||
                                roomView.members.length +
                                  roomView.invitations.filter((i) => i.status === "pending")
                                    .length >=
                                  roomView.room.settings.maxPlayers
                              }
                              onClick={() => void inviteUser(player.id)}
                            >
                              邀请
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="invite-foot">
                  <Bell size={13} /> 玩家会收到站内邀请通知；离线玩家下次打开时也能看到。
                </div>
              </section>
            )}
          </div>
          <RoomSettingsPanel
            settings={roomView.room.settings}
            isHost={user.id === roomView.room.hostId}
            busy={busy}
            onSave={(settings) => void saveRoomSettings(settings)}
          />
          {error && (
            <div className="floating-error">
              {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {toast && <div className="toast-message">{toast}</div>}
        </section>
      </main>
    );

  if (roomView?.room.status === "playing" && roomView.game && user) {
    const game = roomView.game;
    const settings = roomView.room.settings;
    const closeRequest = game.closeRequest;
    const closeApprovals = new Set(closeRequest?.approvals ?? []);
    const roomMemberIds = new Set(roomView.members.map((member) => member.id));
    const eligibleVoterIds = new Set(
      game.matchComplete && !game.matchWinner
        ? roomView.members.map((member) => member.id)
        : game.players
            .filter(
              (player) => !player.eliminated && player.stack > 0 && roomMemberIds.has(player.id),
            )
            .map((player) => player.id),
    );
    const continueVotes = new Set(
      (game.continueVotes ?? []).filter((id) => eligibleVoterIds.has(id)),
    );
    const continueCount = continueVotes.size;
    const continueTotal = eligibleVoterIds.size;
    const alreadyContinued = continueVotes.has(user.id);
    const maxRaiseTo = currentPlayer ? currentPlayer.streetBet + currentPlayer.stack : 0;
    const opponents = game.players.filter((p) => !p.folded && !p.eliminated).length;
    const viewerEliminated =
      !!currentPlayer && (currentPlayer.eliminated || currentPlayer.stack <= 0);
    return (
      <main className="poker-room-screen" ref={roomScreenRef}>
        <ConnectionWarning message={syncError} />
        <AccountHistory open={accountHistoryOpen} onClose={closeAccountHistory} />
        <header className="poker-room-topbar">
          <div className="game-header-summary">
            <strong>第 {game.handNo} 手</strong>
            <span className="game-header-divider" aria-hidden="true" />
            <span>
              盲注 {money(game.smallBlind)}/{money(game.bigBlind)}
            </span>
            {(game.ante > 0 ||
              game.deckCount > 1 ||
              settings.fourOfAKindMultiplier > 1 ||
              settings.straightMultiplier > 1 ||
              settings.jokersEnabled) && (
              <span className="game-rule-badge" title="牌桌启用了特殊规则">
                特殊规则
              </span>
            )}
          </div>
          <div className="game-tools" ref={gameToolsRef}>
            <button
              type="button"
              className="game-menu-trigger"
              aria-label="牌桌菜单"
              aria-haspopup="true"
              aria-expanded={gameMenuOpen}
              onClick={() => {
                setHistoryOpen(false);
                setGameMenuOpen((open) => !open);
              }}
            >
              <MoreHorizontal size={21} />
              <span>更多</span>
            </button>
            {gameMenuOpen && (
              <div className="game-menu" aria-label="牌桌菜单">
                <div className="game-menu-room">
                  <span>房间 {roomView.room.id}</span>
                  <button type="button" onClick={() => void copyRoomId()} aria-label="复制房间号">
                    <Copy size={15} />
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                {(game.ante > 0 ||
                  game.deckCount > 1 ||
                  settings.fourOfAKindMultiplier > 1 ||
                  settings.straightMultiplier > 1 ||
                  settings.jokersEnabled) && (
                  <p className="game-menu-rules">
                    {game.ante > 0 ? `前注 ${money(game.ante)}` : "无前注"} · {game.deckCount} 副牌
                    {settings.fourOfAKindMultiplier > 1
                      ? ` · 四条 ${settings.fourOfAKindMultiplier}×`
                      : ""}
                    {settings.straightMultiplier > 1
                      ? ` · 顺子 ${settings.straightMultiplier}×`
                      : ""}
                    {settings.jokersEnabled ? ` · 王 ${settings.jokerMultiplier}×` : ""}
                  </p>
                )}
                <button
                  type="button"
                  className="game-menu-item"
                  onClick={() => {
                    setGameMenuOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <History size={18} />
                  对局历史
                </button>
                <AvatarUpload
                  profile={user}
                  onUpload={(avatar) => {
                    setGameMenuOpen(false);
                    void saveAvatar(avatar);
                  }}
                  onError={setError}
                  onAccountHistory={() => {
                    setGameMenuOpen(false);
                    setAccountHistoryOpen(true);
                  }}
                  disabled={busy}
                  showText
                  className="game-menu-avatar"
                />
                <button
                  type="button"
                  className="game-menu-item"
                  onClick={() => {
                    setGameMenuOpen(false);
                    enterFullscreen();
                  }}
                >
                  <Expand size={18} />
                  切换全屏
                </button>
                <button
                  type="button"
                  className="game-menu-item game-menu-danger"
                  disabled={busy || !!closeRequest}
                  onClick={() => {
                    setGameMenuOpen(false);
                    setCloseConfirmOpen(true);
                  }}
                >
                  <LogOut size={18} />
                  {closeRequest ? "等待关闭" : "申请关闭牌桌"}
                </button>
              </div>
            )}
            {historyOpen && (
              <section className="room-history-panel" role="dialog" aria-label="房间历史对局">
                <div className="room-history-heading">
                  <div>
                    <b>房间对局历史</b>
                    <small>{matchHistory.length} 场已结束</small>
                  </div>
                  <button
                    type="button"
                    className="room-history-close"
                    aria-label="关闭对局历史"
                    onClick={() => setHistoryOpen(false)}
                  >
                    <X size={17} />
                  </button>
                </div>
                {historyLoading && matchHistory.length === 0 && !historyError && (
                  <div className="room-history-empty">
                    <LoaderCircle className="spin" size={16} />
                    正在载入对局历史…
                  </div>
                )}
                {historyError && (
                  <div className="room-history-empty history-error">{historyError}</div>
                )}
                {!historyLoading && !historyError && matchHistory.length === 0 && (
                  <div className="room-history-empty">还没有整场结束的记录</div>
                )}
                {matchHistory.map((match) => (
                  <div className="room-history-match" key={match.gameId}>
                    <div className="room-history-winner">
                      <Trophy size={17} />
                      <div>
                        <b>{match.winnerName}</b>
                        <small>赢下整场 · {match.handCount} 手</small>
                      </div>
                    </div>
                    <div className="room-history-result">
                      <b>{money(match.winnerChips)} 点</b>
                      <time>{matchTime(match.completedAt)}</time>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        </header>
        <div className={`game-table-layout player-count-${game.players.length}`}>
          <section className="game-info-strip" aria-label="牌局筹码信息">
            {game.stage !== "complete" && game.pots.length > 1 ? (
              <details className="game-pot-details">
                <summary className="game-info-pot">
                  <span>底池</span>
                  <strong>{money(game.pot)}</strong>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className="game-pot-breakdown">
                  {game.pots.map((pot, index) => (
                    <div key={`${pot.label}-${index}`}>
                      <span>{pot.label}</span>
                      <b>{money(pot.amount)}</b>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <div className="game-info-pot">
                <span>底池</span>
                <strong>{money(game.pot)}</strong>
              </div>
            )}
            <div className="game-info-stack">
              <span>你的筹码</span>
              <strong>{money(currentPlayer?.stack ?? 0)}</strong>
            </div>
          </section>
          <section className="live-table-area">
            <TableCanvas
              players={game.players}
              board={game.board}
              viewerId={user.id}
              actorId={game.currentPlayerId}
              roomId={game.roomId}
              handNo={game.handNo}
            />
          </section>
        </div>
        <section className={`live-action-panel ${game.canAct ? "your-action" : ""}`}>
          {game.stage === "complete" ? (
            <div className="game-finished">
              <div className="finish-symbol">
                <Crown size={19} />
              </div>
              <div className="finish-copy">
                <span>
                  {game.matchComplete
                    ? "MATCH COMPLETE · 对局结束"
                    : game.winners.some((winner) => winner.hand)
                      ? "SHOWDOWN · 摊牌"
                      : "HAND COMPLETE · 对手弃牌"}
                </span>
                <b>{game.matchWinner ? `${game.matchWinner.name} 赢了！` : game.outcome}</b>
                <small>
                  {game.matchComplete
                    ? game.matchWinner
                      ? `赢家最终筹码 ${money(game.matchWinner.chips)} 点 · 再开一场每人 ${money(roomView.room.settings.startingStack)} 点`
                      : "上场赢家已离开 · 当前房间玩家可投票再开一场"
                    : viewerEliminated
                      ? "你已淘汰 · 无需投票，旁观等待其余玩家决定是否继续。"
                      : game.winners
                          .map((winner) => `${winner.name} +${money(winner.amount)}`)
                          .join("　·　")}
                  　·　已选择继续 {continueCount}/{continueTotal} 人
                </small>
              </div>
              {user.id === roomView.room.hostId && !closeRequest && (
                <button
                  type="button"
                  className="manage-table-button"
                  onClick={() => {
                    setError("");
                    setManageOpen(true);
                  }}
                  disabled={busy}
                  title="在两手之间管理规则、玩家和筹码"
                  aria-label="管理牌桌"
                >
                  <Settings2 size={16} />
                  <span>管理牌桌</span>
                </button>
              )}
              {!eligibleVoterIds.has(user.id) ? (
                <span className="eliminated-tag">已淘汰 · 观战中</span>
              ) : (
                <button
                  className="primary-cta next-hand"
                  onClick={() =>
                    void doRoomAction(game.matchComplete ? "rematch" : "next", {
                      approve: !alreadyContinued,
                    })
                  }
                  disabled={busy}
                  title={
                    alreadyContinued
                      ? "点击撤回你的继续意愿"
                      : "所有需投票的玩家都选择继续后才会开始"
                  }
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : alreadyContinued ? (
                    <Check size={16} />
                  ) : null}
                  {alreadyContinued
                    ? game.matchComplete
                      ? `已同意再开一场 · 撤回 (${continueCount}/${continueTotal})`
                      : `已同意继续 · 撤回 (${continueCount}/${continueTotal})`
                    : game.matchComplete
                      ? `同意再开一场 (${continueCount}/${continueTotal})`
                      : `同意继续下一手 (${continueCount}/${continueTotal})`}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="turn-line">
                {game.canAct ? (
                  <>
                    <span className="turn-spark">✦</span>
                    <div>
                      <small>轮到你行动 · {opponents} 人在局</small>
                      <b>
                        {game.toCall > 0
                          ? `需要跟注 ${money(game.toCall)}`
                          : "可以弃牌、过牌或下注"}
                      </b>
                    </div>
                  </>
                ) : viewerEliminated ? (
                  <>
                    <span className="turn-wait">OUT</span>
                    <div>
                      <small>观战中 · {opponents} 人在局</small>
                      <b>等待其他玩家结束对局</b>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="turn-wait">
                      <LoaderCircle className="spin" size={17} />
                    </span>
                    <div>
                      <small>正在进行 · {opponents} 人在局</small>
                      <b>
                        等待{" "}
                        {game.players.find((p) => p.id === game.currentPlayerId)?.name ?? "玩家"}{" "}
                        行动
                      </b>
                    </div>
                  </>
                )}
                <div className="turn-context">
                  <span className="turn-phase">{phaseName[game.stage]}</span>
                  {currentPlayer?.handScore && game.board.length >= 3 && (
                    <span className="turn-hand-rank">
                      当前牌型 <b>{currentPlayer.handScore.label}</b>
                    </span>
                  )}
                </div>
              </div>
              {game.canAct ? (
                <>
                  <div className="game-action-buttons">
                    {game.toCall > 0 ? (
                      <>
                        <button
                          className="table-action fold-action"
                          onClick={() => void doRoomAction("act", { kind: "fold" })}
                          disabled={busy}
                        >
                          <b>弃牌</b>
                          <small>FOLD</small>
                        </button>
                        <button
                          className="table-action call-action"
                          onClick={() => void doRoomAction("act", { kind: "call" })}
                          disabled={busy}
                        >
                          <b>
                            {game.toCall >= (currentPlayer?.stack ?? 0)
                              ? "跟注并全下"
                              : `跟注 ${money(game.toCall)}`}
                          </b>
                          <small>
                            CALL · {money(Math.min(game.toCall, currentPlayer?.stack ?? 0))}
                          </small>
                        </button>
                        {game.canRaise && (
                          <button
                            className="table-action raise-action"
                            onClick={() => setRaiseOpen((v) => !v)}
                            disabled={busy}
                          >
                            <b>加注</b>
                            <small>RAISE</small>
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          className="table-action fold-action"
                          onClick={() => void doRoomAction("act", { kind: "fold" })}
                          disabled={busy}
                        >
                          <b>弃牌</b>
                          <small>FOLD</small>
                        </button>
                        <button
                          className="table-action check-action"
                          onClick={() => void doRoomAction("act", { kind: "check" })}
                          disabled={busy}
                        >
                          <b>过牌</b>
                          <small>CHECK</small>
                        </button>
                        {game.canRaise && (
                          <button
                            className="table-action raise-action"
                            onClick={() => setRaiseOpen((v) => !v)}
                            disabled={busy}
                          >
                            <b>下注</b>
                            <small>BET</small>
                          </button>
                        )}
                      </>
                    )}
                    {game.canAllIn && (
                      <button
                        className="table-all-in"
                        onClick={() => void doRoomAction("act", { kind: "all-in" })}
                        disabled={busy}
                      >
                        全下
                      </button>
                    )}
                  </div>
                  {raiseOpen && game.canRaise && (
                    <div className="game-raise-editor">
                      <div>
                        <span>{game.highestBet ? "RAISE TO" : "BET TO"}</span>
                        <b>
                          {game.highestBet ? "加注至" : "下注至"} {money(raiseTo)}
                        </b>
                        <div className="raise-presets">
                          <button
                            onClick={() =>
                              setRaiseTo(
                                Math.min(
                                  maxRaiseTo,
                                  Math.max(
                                    game.minRaiseTo,
                                    game.highestBet + Math.round(game.pot / 2),
                                  ),
                                ),
                              )
                            }
                          >
                            半池
                          </button>
                          <button
                            onClick={() =>
                              setRaiseTo(
                                Math.min(
                                  maxRaiseTo,
                                  Math.max(game.minRaiseTo, game.highestBet + game.pot),
                                ),
                              )
                            }
                          >
                            底池
                          </button>
                          <button onClick={() => setRaiseTo(maxRaiseTo)}>全下</button>
                        </div>
                      </div>
                      <input
                        aria-label="选择加注金额"
                        type="range"
                        min={game.minRaiseTo}
                        max={Math.max(game.minRaiseTo, maxRaiseTo)}
                        value={Math.max(game.minRaiseTo, Math.min(raiseTo, maxRaiseTo))}
                        onChange={(e) => setRaiseTo(Number(e.target.value))}
                      />
                      <div className="raise-submit-row">
                        <span>
                          最少 {money(game.minRaiseTo)} · 最多 {money(maxRaiseTo)}
                        </span>
                        <button
                          onClick={() => void doRoomAction("act", { kind: "raise", raiseTo })}
                          disabled={busy || raiseTo < game.minRaiseTo}
                        >
                          确认{game.highestBet ? "加注" : "下注"}至 {money(raiseTo)}{" "}
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </section>
        {error && (
          <div className="game-error">
            {error}
            <button onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {toast && <div className="toast-message">{toast}</div>}
        {closeConfirmOpen && !closeRequest && (
          <div
            className="close-request-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-confirm-title"
          >
            <section className="close-request-card close-confirm-card">
              <h2 id="close-confirm-title">申请关闭整张牌桌？</h2>
              <p>
                发起人计一票；任意两名成员同意即可立即关闭。否则 5
                分钟后自动关闭。关闭时会删除该房间及其牌局记录。
              </p>
              <div className="close-vote-actions">
                <button
                  type="button"
                  className="primary-cta"
                  disabled={busy}
                  onClick={async () => {
                    if (await doRoomAction("request-close")) setCloseConfirmOpen(false);
                  }}
                >
                  确认申请关闭
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => setCloseConfirmOpen(false)}
                >
                  继续游戏
                </button>
              </div>
            </section>
          </div>
        )}
        {manageOpen &&
          game.stage === "complete" &&
          user.id === roomView.room.hostId &&
          !closeRequest && (
            <GameManagement
              view={roomView}
              users={users}
              busy={busy}
              error={error}
              onClose={() => setManageOpen(false)}
              onSave={(settings, resetBlinds) => void saveRoomSettings(settings, resetBlinds)}
              onInvite={(userId) => void inviteUser(userId)}
              onKick={(userId) => void kickPlayer(userId)}
              onTopUp={(userId, amount) => void addChips(userId, amount)}
            />
          )}
        {closeRequest && (
          <div
            className="close-request-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-request-title"
          >
            <section className="close-request-card">
              <span className="section-overline">TABLE CLOSE REQUEST</span>
              <h2 id="close-request-title">{closeRequest.requestedByName} 申请关闭对局</h2>
              <p>
                发起人已同意；任意两名成员同意即可立即关闭。若未凑够两票且无人取消申请，发起 5
                分钟后自动关闭。任一成员都可取消申请；关闭时会清除这场对局的记录。
              </p>
              <div className="close-vote-progress">
                已同意{" "}
                <b>
                  {roomView.members.filter((member) => closeApprovals.has(member.id)).length} / 2
                </b>{" "}
                人
                <span className="close-deadline">
                  最迟{" "}
                  {new Date(closeRequest.createdAt + 5 * 60 * 1000).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  自动关闭
                </span>
              </div>
              <div className="close-vote-list">
                {roomView.members.map((member) => {
                  const approved = closeApprovals.has(member.id);
                  return (
                    <div
                      className={`close-vote-person ${approved ? "vote-approved" : ""}`}
                      key={member.id}
                    >
                      <Avatar avatar={member.avatar} nickname={member.nickname} size="small" />
                      <span>
                        {member.nickname}
                        {member.id === closeRequest.requestedById && <small>发起人</small>}
                      </span>
                      <b>
                        {approved ? (
                          <>
                            <Check size={14} /> 已同意
                          </>
                        ) : (
                          "待确认"
                        )}
                      </b>
                    </div>
                  );
                })}
              </div>
              <div className="close-vote-actions">
                <button
                  className="primary-cta"
                  onClick={() => void doRoomAction("close-vote", { approve: true })}
                  disabled={busy || closeApprovals.has(user.id)}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : closeApprovals.has(user.id) ? (
                    <Check size={16} />
                  ) : null}
                  {closeApprovals.has(user.id) ? "已同意，等待另一名成员" : "同意关闭牌桌"}
                </button>
                <button
                  className="quiet-button"
                  onClick={() => void doRoomAction("close-vote", { approve: false })}
                  disabled={busy}
                >
                  取消关闭申请
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="home-screen">
      <ConnectionWarning message={syncError} />
      <AccountHistory open={accountHistoryOpen} onClose={closeAccountHistory} />
      <header className="home-topbar">
        <div className="auth-brand">
          <div className="brand-mark">
            <Spade size={19} fill="currentColor" />
          </div>
          <div>
            <b>FELT CLUB</b>
            <span>德州扑克 · 好友牌桌</span>
          </div>
        </div>
        <div className="home-user">
          <AvatarUpload
            profile={user}
            onUpload={saveAvatar}
            onError={setError}
            onAccountHistory={() => setAccountHistoryOpen(true)}
            disabled={busy}
          />
          <span>{user.nickname}</span>
        </div>
      </header>
      <section className="home-center">
        <div className="home-suit">♠</div>
        <span className="section-overline">NO-LIMIT TEXAS HOLD’EM</span>
        <h1>朋友都到齐了吗？</h1>
        <p>
          创建一张私人牌桌，邀请 1 到 5 位朋友，
          <br />
          随时开始一局德州扑克。
        </p>
        <button
          className="primary-cta home-start"
          onClick={() => void createRoom()}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <Spade size={17} fill="currentColor" />
          )}{" "}
          开始德州扑克 <ArrowRight size={18} />
        </button>
        <div className="home-detail">
          <span>
            <Users size={14} /> 2–6 位玩家
          </span>
          <i />
          <span>盲注 25 / 50</span>
          <i />
          <span>本地练习筹码</span>
        </div>
      </section>
      {incoming.length > 0 && (
        <section className="home-invitations">
          <div className="notice-heading">
            <Bell size={15} />
            <b>好友邀请</b>
            <span>{incoming.length}</span>
          </div>
          {incoming.map((invite) => (
            <div className="notice-invite" key={invite.id}>
              <div>
                <b>{invite.fromName}</b>
                <span>
                  邀请你加入房间 <strong>{invite.roomId}</strong>
                </span>
              </div>
              <button onClick={() => void respondInvite(invite, "accept")} disabled={busy}>
                <Check size={14} /> 接受
              </button>
              <button
                className="decline-invite"
                onClick={() => void respondInvite(invite, "decline")}
                disabled={busy}
                aria-label="忽略邀请"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </section>
      )}
      {error && (
        <div className="floating-error">
          {error}
          <button onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {showInviteNotice && incoming.some((i) => i.id === showInviteNotice.id) && (
        <div className="invite-overlay">
          <section className="invite-notice-modal">
            <button
              className="notice-close"
              onClick={() => {
                dismissedNotices.current.add(showInviteNotice.id);
                setShowInviteNotice(null);
              }}
              aria-label="关闭通知"
            >
              <X size={17} />
            </button>
            <div className="notice-bell">
              <Bell size={20} />
            </div>
            <span className="section-overline">TABLE INVITATION</span>
            <h2>{showInviteNotice.fromName} 邀请你加入牌桌</h2>
            <p>
              房间号 <b>{showInviteNotice.roomId}</b> · 最多 6 位玩家
            </p>
            <div>
              <button
                className="primary-cta"
                onClick={() => void respondInvite(showInviteNotice, "accept")}
                disabled={busy}
              >
                <Check size={16} /> 接受邀请
              </button>
              <button
                className="quiet-button"
                onClick={() => void respondInvite(showInviteNotice, "decline")}
                disabled={busy}
              >
                拒绝邀请
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast-message">{toast}</div>}
    </main>
  );
}
