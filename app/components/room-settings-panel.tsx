"use client";

import type { FormEvent } from "react";
import { Settings2 } from "lucide-react";
import type { RoomSettings } from "@/lib/settings";
import { money } from "@/lib/format";

export default function RoomSettingsPanel({
  settings,
  isHost,
  busy,
  onSave,
  betweenHands = false,
  currentBlinds,
}: {
  settings: RoomSettings;
  isHost: boolean;
  busy: boolean;
  onSave: (value: RoomSettings, resetBlinds?: boolean) => void;
  betweenHands?: boolean;
  currentBlinds?: { smallBlind: number; bigBlind: number };
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave(
      {
        maxPlayers: Number(data.get("maxPlayers")),
        deckCount: Number(data.get("deckCount")),
        smallBlind: Number(data.get("smallBlind")),
        bigBlind: Number(data.get("bigBlind")),
        startingStack: Number(data.get("startingStack")),
        ante: Number(data.get("ante")),
        blindIncreaseEvery: Number(data.get("blindIncreaseEvery")),
        fourOfAKindMultiplier: Number(data.get("fourOfAKindMultiplier")),
        straightMultiplier: Number(data.get("straightMultiplier")),
        jokersEnabled: data.get("jokersEnabled") === "on",
        jokerMultiplier: Number(data.get("jokerMultiplier")),
      },
      data.get("resetBlinds") === "on",
    );
  };
  return (
    <section className="lobby-panel room-settings-panel">
      <div className="panel-heading">
        <div>
          <Settings2 size={16} />
          <b>{betweenHands ? "下一手规则" : "牌桌设置"}</b>
        </div>
        <span>
          {betweenHands
            ? "房主修改 · 下一手生效"
            : isHost
              ? "仅房主可修改 · 开局后可在两手之间调整"
              : "由房主设置 · 两手之间可调整"}
        </span>
      </div>
      {currentBlinds && (
        <p className="current-blinds-note">
          当前盲注 {money(currentBlinds.smallBlind)} / {money(currentBlinds.bigBlind)}
          ；下方填写的是基础盲注。仅改其他设置时，当前盲注级别保持不变。
        </p>
      )}
      {isHost ? (
        <form key={JSON.stringify(settings)} className="room-settings-form" onSubmit={submit}>
          <section className="settings-group">
            <div className="settings-group-heading">
              <b>牌桌与牌型</b>
              <span>人数、副数和加倍规则</span>
            </div>
            <div className="settings-group-fields">
              <label>
                人数上限
                <select name="maxPlayers" defaultValue={settings.maxPlayers}>
                  {[2, 3, 4, 5, 6].map((count) => (
                    <option key={count} value={count}>
                      {count} 人
                    </option>
                  ))}
                </select>
              </label>
              <label>
                使用几副牌
                <select name="deckCount" defaultValue={settings.deckCount}>
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count} 副 · {count * 52} 张
                    </option>
                  ))}
                </select>
              </label>
              <label>
                四条奖励
                <select name="fourOfAKindMultiplier" defaultValue={settings.fourOfAKindMultiplier}>
                  {[1, 2, 3, 5].map((value) => (
                    <option key={value} value={value}>
                      {value === 1 ? "关闭" : `${value} 倍`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                顺子奖励
                <select name="straightMultiplier" defaultValue={settings.straightMultiplier}>
                  {[1, 2, 3, 5].map((value) => (
                    <option key={value} value={value}>
                      {value === 1 ? "关闭" : `${value} 倍`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-joker-toggle">
                <input
                  type="checkbox"
                  name="jokersEnabled"
                  defaultChecked={settings.jokersEnabled}
                />
                加入大小王（百搭）
              </label>
              <label>
                手持王奖励
                <select name="jokerMultiplier" defaultValue={settings.jokerMultiplier}>
                  {[2, 3, 5].map((value) => (
                    <option key={value} value={value}>
                      {value} 倍
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="settings-group-note">
              顺子奖励不含同花顺；摊牌赢家手牌含王时触发王奖励，多个倍数相乘。
            </p>
          </section>
          <section className="settings-group">
            <div className="settings-group-heading">
              <b>盲注与节奏</b>
              <span>下注起点和盲注升级</span>
            </div>
            <div className="settings-group-fields">
              <label>
                {betweenHands ? "基础小盲注" : "小盲注"}
                <input
                  name="smallBlind"
                  type="number"
                  min="1"
                  max="500000"
                  step="1"
                  required
                  defaultValue={settings.smallBlind}
                />
              </label>
              <label>
                {betweenHands ? "基础大盲注" : "大盲注"}
                <input
                  name="bigBlind"
                  type="number"
                  min="2"
                  max="1000000"
                  step="1"
                  required
                  defaultValue={settings.bigBlind}
                />
              </label>
              <label>
                每人前注
                <input
                  name="ante"
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  required
                  defaultValue={settings.ante}
                />
              </label>
              <label>
                每几手盲注翻倍
                <input
                  name="blindIncreaseEvery"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  required
                  defaultValue={settings.blindIncreaseEvery}
                />
              </label>
              {betweenHands && (
                <label className="settings-reset-blinds">
                  <input type="checkbox" name="resetBlinds" />
                  下一手恢复到填写的基础盲注
                </label>
              )}
            </div>
            <p className="settings-group-note">盲注升级间隔填 0 表示关闭；前注不能高于大盲。</p>
          </section>
          <section className="settings-group settings-stack-group">
            <div className="settings-group-heading">
              <b>筹码</b>
              <span>{betweenHands ? "新玩家或下一场的起始筹码" : "每位玩家的起始筹码"}</span>
            </div>
            <div className="settings-group-fields">
              <label>
                {betweenHands ? "新玩家 / 下一场初始筹码" : "初始筹码"}
                <input
                  name="startingStack"
                  type="number"
                  min="20"
                  max="10000000"
                  step="1"
                  required
                  defaultValue={settings.startingStack}
                />
              </label>
            </div>
            <p className="settings-group-note">
              初始筹码至少为大盲的 10 倍{betweenHands ? "；已在牌桌上的玩家筹码不会改变。" : "。"}
            </p>
          </section>
          <div className="settings-form-foot">
            <span>
              加倍奖励从本手输家的剩余筹码中按比例支付，筹码不足时按实际可支付金额封顶。
              {betweenHands ? "保存后需重新投票继续。" : ""}
            </span>
            <button type="submit" disabled={busy}>
              保存设置
            </button>
          </div>
        </form>
      ) : (
        <div className="room-settings-summary">
          <section className="settings-group">
            <div className="settings-group-heading">
              <b>牌桌与牌型</b>
            </div>
            <div className="settings-summary-fields">
              <span>
                人数上限<b>{settings.maxPlayers} 人</b>
              </span>
              <span>
                牌的副数<b>{settings.deckCount} 副</b>
              </span>
              <span>
                四条奖励
                <b>
                  {settings.fourOfAKindMultiplier > 1
                    ? `${settings.fourOfAKindMultiplier} 倍`
                    : "关闭"}
                </b>
              </span>
              <span>
                顺子奖励
                <b>
                  {settings.straightMultiplier > 1 ? `${settings.straightMultiplier} 倍` : "关闭"}
                </b>
              </span>
              <span>
                大小王
                <b>
                  {settings.jokersEnabled ? `百搭 · 手持 ${settings.jokerMultiplier} 倍` : "关闭"}
                </b>
              </span>
            </div>
          </section>
          <section className="settings-group">
            <div className="settings-group-heading">
              <b>盲注与节奏</b>
            </div>
            <div className="settings-summary-fields">
              <span>
                小盲 / 大盲
                <b>
                  {money(settings.smallBlind)} / {money(settings.bigBlind)}
                </b>
              </span>
              <span>
                每人前注<b>{settings.ante ? money(settings.ante) : "无"}</b>
              </span>
              <span>
                盲注升级
                <b>
                  {settings.blindIncreaseEvery
                    ? `每 ${settings.blindIncreaseEvery} 手翻倍`
                    : "关闭"}
                </b>
              </span>
            </div>
          </section>
          <section className="settings-group settings-stack-group">
            <div className="settings-group-heading">
              <b>筹码</b>
            </div>
            <div className="settings-summary-fields">
              <span>
                初始筹码<b>{money(settings.startingStack)}</b>
              </span>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
