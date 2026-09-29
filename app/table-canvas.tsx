"use client";

import { useEffect, useRef } from "react";
import { cardImageUrl } from "@/lib/card-assets";

type CanvasPlayer = {
  id: string;
  name: string;
  avatar: string | null;
  seat: number;
  stack: number;
  hole: string[];
  folded: boolean;
  allIn: boolean;
  eliminated?: boolean;
  streetBet: number;
  position: string;
};
type Props = {
  players: CanvasPlayer[];
  board: string[];
  viewerId: string;
  actorId?: string;
  roomId: string;
  handNo: number;
};
type BoardMotion = {
  handKey: string;
  board: string[];
  revealAt: Record<number, number>;
  dealAt: Record<number, number>;
};
const flipDuration = 520;
const dealDuration = 420;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function drawBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  roundedRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "#11291f";
  ctx.fill();
  ctx.save();
  roundedRect(ctx, x + 3, y + 3, w - 6, h - 6, 4);
  ctx.clip();
  ctx.strokeStyle = "rgba(199, 168, 104, .28)";
  ctx.lineWidth = 1;
  for (let d = -h; d < w + h; d += 9) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d - h, y + h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "#c7a868";
  ctx.lineWidth = 1.2;
  roundedRect(ctx, x + 2, y + 2, w - 4, h - 4, 5);
  ctx.stroke();
}
function drawCard(
  ctx: CanvasRenderingContext2D,
  card: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  images: Map<string, HTMLImageElement>,
) {
  if (!card) return;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.38)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  if (card === "back") {
    drawBack(ctx, x, y, w, h);
    ctx.restore();
    return;
  }
  if (card.startsWith("JOKER-")) {
    const image = images.get(cardImageUrl(card));
    if (image?.complete && image.naturalWidth) {
      roundedRect(ctx, x, y, w, h, 6);
      ctx.clip();
      ctx.drawImage(image, x, y, w, h);
    } else {
      roundedRect(ctx, x, y, w, h, 6);
      ctx.fillStyle = "#fffdfa";
      ctx.fill();
      ctx.fillStyle = card.endsWith("R") ? "#b43439" : "#26352c";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(8, w * 0.2)}px sans-serif`;
      ctx.fillText(card.endsWith("R") ? "大王" : "小王", x + w / 2, y + h * 0.42);
      ctx.font = `700 ${Math.max(12, w * 0.38)}px sans-serif`;
      ctx.fillText("★", x + w / 2, y + h * 0.68);
    }
    ctx.restore();
    return;
  }
  const image = images.get(cardImageUrl(card));
  if (image?.complete && image.naturalWidth) {
    roundedRect(ctx, x, y, w, h, 6);
    ctx.clip();
    ctx.drawImage(image, x, y, w, h);
  } else {
    roundedRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = "#fffdfa";
    ctx.fill();
  }
  ctx.restore();
}
function drawDealtCard(
  ctx: CanvasRenderingContext2D,
  card: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sourceX: number,
  sourceY: number,
  progress: number,
  images: Map<string, HTMLImageElement>,
) {
  const eased = easeOut(clamp(progress));
  ctx.save();
  ctx.translate(
    sourceX * (1 - eased) + (x + w / 2) * eased,
    sourceY * (1 - eased) + (y + h / 2) * eased,
  );
  ctx.rotate((1 - eased) * -0.2);
  ctx.scale(0.84 + eased * 0.16, 0.84 + eased * 0.16);
  drawCard(ctx, card, -w / 2, -h / 2, w, h, images);
  ctx.restore();
}
function drawFlippingCard(
  ctx: CanvasRenderingContext2D,
  card: string,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  images: Map<string, HTMLImageElement>,
) {
  const turn = clamp(progress);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2 - Math.sin(turn * Math.PI) * 8);
  ctx.scale(Math.max(0.025, Math.abs(Math.cos(turn * Math.PI))), 1);
  drawCard(ctx, turn < 0.5 ? "back" : card, -w / 2, -h / 2, w, h, images);
  ctx.restore();
}
function money(amount: number) {
  return amount.toLocaleString("en-US");
}

export default function TableCanvas({ players, board, viewerId, actorId, roomId, handNo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef<BoardMotion | null>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const redrawRef = useRef<() => void>(() => {});
  const signature = JSON.stringify({ players, board, viewerId, actorId, roomId, handNo });
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const images = imagesRef.current;
    const handKey = `${roomId}:${handNo}`;
    const now = performance.now();
    const previous = motionRef.current;
    if (
      !previous ||
      previous.handKey !== handKey ||
      board.length < previous.board.length ||
      previous.board.some((card, index) => card !== board[index])
    ) {
      motionRef.current = {
        handKey,
        board: [...board],
        revealAt: {},
        dealAt: previous && board.length === 0 ? { 0: now, 1: now + 115, 2: now + 230 } : {},
      };
    } else if (board.length > previous.board.length) {
      const revealAt = { ...previous.revealAt };
      let nextStart = Math.max(
        now,
        ...Object.values(revealAt).map((start) => start + flipDuration + 130),
      );
      if (previous.board.length === 0 && previous.dealAt[2] !== undefined)
        nextStart = Math.max(nextStart, previous.dealAt[2] + dealDuration + 120);
      for (let index = previous.board.length; index < board.length; index++) {
        if (index >= 3 && revealAt[index - 1] !== undefined)
          nextStart = Math.max(
            nextStart,
            revealAt[index - 1] + flipDuration + 80 + dealDuration + 120,
          );
        revealAt[index] = nextStart;
        nextStart += index < 2 ? 145 : 630;
      }
      motionRef.current = { ...previous, board: [...board], revealAt };
    }
    const motion = motionRef.current!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const draw = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 4);
      const width = Math.round(box.width * dpr),
        height = Math.round(box.height * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const portrait = window.matchMedia("(orientation: portrait)").matches;
      const expandedTable = players.length >= 5;
      const compactThree = portrait && players.length === 3;
      const logicalWidth = portrait ? 390 : 1000;
      const logicalHeight = portrait ? (expandedTable ? 600 : 550) : 590;
      const uniformScale = portrait
        ? Math.min(box.width / logicalWidth, box.height / logicalHeight)
        : 0;
      const offsetX = portrait ? (box.width - logicalWidth * uniformScale) / 2 : 0;
      const offsetY = portrait ? (box.height - logicalHeight * uniformScale) / 2 : 0;
      const scaleX = portrait ? dpr * uniformScale : canvas.width / 1000;
      const scaleY = portrait ? dpr * uniformScale : canvas.height / 590;
      const adjustX = scaleY / scaleX;
      const centerX = logicalWidth / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(
        scaleX,
        0,
        0,
        scaleY,
        portrait ? offsetX * dpr : 0,
        portrait ? offsetY * dpr : 0,
      );
      const tableCenterY = compactThree ? 245 : portrait ? (expandedTable ? 300 : 265) : 283;
      const tableRadiusY = compactThree ? 195 : portrait ? (expandedTable ? 235 : 205) : 207;
      const glow = ctx.createRadialGradient(
        centerX,
        tableCenterY,
        70,
        centerX,
        tableCenterY,
        logicalWidth * 0.48,
      );
      glow.addColorStop(0, "rgba(24,91,62,.23)");
      glow.addColorStop(1, "rgba(7,22,16,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      const tableRadiusX = portrait ? logicalWidth * 0.45 : 407;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.48)";
      ctx.shadowBlur = 42;
      ctx.shadowOffsetY = 15;
      ctx.beginPath();
      ctx.ellipse(centerX, tableCenterY, tableRadiusX, tableRadiusY, 0, 0, Math.PI * 2);
      const felt = ctx.createLinearGradient(
        0,
        compactThree ? 50 : portrait ? (expandedTable ? 65 : 60) : 76,
        0,
        compactThree ? 440 : portrait ? (expandedTable ? 535 : 470) : 490,
      );
      felt.addColorStop(0, "#174c36");
      felt.addColorStop(0.52, "#103d2c");
      felt.addColorStop(1, "#0b3224");
      ctx.fillStyle = felt;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(
        centerX,
        tableCenterY,
        portrait ? logicalWidth * 0.435 : 395,
        compactThree ? 184 : portrait ? (expandedTable ? 224 : 194) : 195,
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = "rgba(213,187,125,.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(
        centerX,
        tableCenterY,
        portrait ? logicalWidth * 0.42 : 382,
        compactThree ? 171 : portrait ? (expandedTable ? 211 : 181) : 182,
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = "rgba(231,217,177,.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!portrait) {
        ctx.fillStyle = "rgba(236,229,211,.035)";
        ctx.font = "500 12px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("N O - L I M I T  ·  T E X A S  H O L D ’ E M", centerX, 121);
      }
      const cardW = 57 * adjustX,
        cardH = 57 * 1.392,
        gap = 8 * adjustX;
      const boardY = compactThree ? 112 : portrait ? (expandedTable ? 247 : 214) : 210;
      const timestamp = performance.now();
      const fourthDeal =
        motion.revealAt[2] === undefined ? undefined : motion.revealAt[2] + flipDuration + 80;
      const fifthDeal =
        motion.revealAt[3] === undefined ? undefined : motion.revealAt[3] + flipDuration + 80;
      const fourthProgress =
        board.length >= 3
          ? reducedMotion || fourthDeal === undefined
            ? 1
            : easeOut(clamp((timestamp - fourthDeal) / dealDuration))
          : 0;
      const fifthProgress =
        board.length >= 4
          ? reducedMotion || fifthDeal === undefined
            ? 1
            : easeOut(clamp((timestamp - fifthDeal) / dealDuration))
          : 0;
      const visibleCount = 3 + fourthProgress + fifthProgress;
      const boardW = visibleCount * cardW + (visibleCount - 1) * gap;
      const boardStart = centerX - boardW / 2;
      const sourceX = centerX + cardW * 1.9,
        sourceY = boardY - cardH * 0.55;
      let animating = false;
      for (let i = 0; i < 5; i++) {
        const x = boardStart + i * (cardW + gap);
        const reveal = motion.revealAt[i];
        const deal =
          i < 3
            ? motion.dealAt[i]
            : motion.revealAt[i - 1] !== undefined
              ? motion.revealAt[i - 1] + flipDuration + 80
              : undefined;
        if (board[i]) {
          if (
            !reducedMotion &&
            deal !== undefined &&
            reveal !== undefined &&
            timestamp < deal + dealDuration
          ) {
            if (timestamp >= deal)
              drawDealtCard(
                ctx,
                "back",
                x,
                boardY,
                cardW,
                cardH,
                sourceX,
                sourceY,
                (timestamp - deal) / dealDuration,
                images,
              );
            animating = true;
          } else if (!reducedMotion && reveal !== undefined && timestamp < reveal + flipDuration) {
            drawFlippingCard(
              ctx,
              board[i],
              x,
              boardY,
              cardW,
              cardH,
              (timestamp - reveal) / flipDuration,
              images,
            );
            animating = true;
          } else drawCard(ctx, board[i], x, boardY, cardW, cardH, images);
          continue;
        }
        const placeholder =
          (i < 3 && board.length === 0) ||
          (i === 3 && board.length === 3) ||
          (i === 4 && board.length === 4);
        if (!placeholder) continue;
        if (!reducedMotion && deal !== undefined && timestamp < deal + dealDuration) {
          if (timestamp >= deal)
            drawDealtCard(
              ctx,
              "back",
              x,
              boardY,
              cardW,
              cardH,
              sourceX,
              sourceY,
              (timestamp - deal) / dealDuration,
              images,
            );
          animating = true;
        } else drawCard(ctx, "back", x, boardY, cardW, cardH, images);
      }
      const me = players.find((p) => p.id === viewerId);
      const count = players.length;
      const sideSeatX = portrait ? logicalWidth * 0.17 : 126;
      const seatAnchors: Record<number, { x: number; y: number; cardY: number; cardX: number }> = {
        0: {
          x: centerX,
          y: compactThree ? 400 : portrait ? (expandedTable ? 494 : 454) : 503,
          cardY: compactThree ? 285 : portrait ? (expandedTable ? 380 : 348) : 403,
          cardX: centerX,
        },
        1: {
          x: sideSeatX,
          y: compactThree ? 325 : portrait ? 392 : 261,
          cardY: compactThree ? 235 : portrait ? 306 : 326,
          cardX: sideSeatX,
        },
        2: { x: centerX, y: portrait ? 36 : 57, cardY: portrait ? 129 : 128, cardX: centerX },
        3: {
          x: logicalWidth - sideSeatX,
          y: compactThree ? 325 : portrait ? 392 : 261,
          cardY: compactThree ? 235 : portrait ? 306 : 326,
          cardX: logicalWidth - sideSeatX,
        },
        4: {
          x: portrait ? 85 : 255,
          y: portrait ? 80 : 90,
          cardY: portrait ? 168 : 178,
          cardX: portrait ? 85 : 255,
        },
        5: {
          x: portrait ? logicalWidth - 85 : 745,
          y: portrait ? 80 : 90,
          cardY: portrait ? 168 : 178,
          cardX: portrait ? logicalWidth - 85 : 745,
        },
        6: {
          x: portrait ? 58 : 255,
          y: portrait ? (expandedTable ? 427 : 392) : 390,
          cardY: portrait ? (expandedTable ? 340 : 306) : 310,
          cardX: portrait ? 58 : 255,
        },
        7: {
          x: portrait ? logicalWidth - 58 : 745,
          y: portrait ? (expandedTable ? 427 : 392) : 390,
          cardY: portrait ? (expandedTable ? 340 : 306) : 310,
          cardX: portrait ? logicalWidth - 58 : 745,
        },
      };
      const layouts: Record<number, number[]> = {
        2: [0, 2],
        3: [0, 1, 3],
        4: [0, 1, 2, 3],
        5: [0, 6, 4, 5, 7],
        6: [0, 6, 4, 2, 5, 7],
      };
      const positions = layouts[count] ?? layouts[2];
      const relativeSeat = (seat: number) => (seat - (me?.seat ?? 0) + count) % count;
      const order = [...players].sort((a, b) => relativeSeat(a.seat) - relativeSeat(b.seat));
      for (const p of order) {
        const seatPosition = positions[relativeSeat(p.seat)] ?? 0;
        const at = seatAnchors[seatPosition];
        const isMe = p.id === viewerId;
        const active = actorId === p.id;
        const alpha = p.folded || p.eliminated ? 0.4 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.ellipse(at.x, at.y, (active ? 26 : 23) * adjustX, active ? 26 : 23, 0, 0, Math.PI * 2);
        ctx.fillStyle = isMe ? "#d9c38c" : "#20382e";
        ctx.fill();
        ctx.lineWidth = active ? 2.5 : 1.25;
        ctx.strokeStyle = active ? "#e9cf8c" : "rgba(225,213,183,.26)";
        ctx.stroke();
        if (active) {
          ctx.beginPath();
          ctx.ellipse(at.x, at.y, 32 * adjustX, 32, 0, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(230,202,135,.45)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        const avatar = p.avatar ? images.get(`avatar:${p.id}`) : undefined;
        const avatarR = portrait ? 21 : 20;
        if (avatar?.complete && avatar.naturalWidth) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(at.x, at.y, avatarR * adjustX, avatarR, 0, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(
            avatar,
            at.x - avatarR * adjustX,
            at.y - avatarR,
            avatarR * 2 * adjustX,
            avatarR * 2,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = isMe ? "#17231d" : "#f0e8d6";
          ctx.font = portrait ? "600 18px Inter, sans-serif" : "600 16px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(p.name.slice(0, 1).toUpperCase(), at.x, at.y + 1);
        }
        const nameY = at.y + 30;
        const sideSeat = portrait && Math.abs(at.x - centerX) > 1;
        const labelWidth = logicalWidth * 0.31;
        const playerLabel = isMe ? `${p.name} · 你` : p.name;
        ctx.fillStyle = active ? "#f0d89c" : "#ede8dc";
        ctx.font = portrait ? "600 18px Inter, sans-serif" : "600 14px Inter, sans-serif";
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "center";
        if (sideSeat) ctx.fillText(playerLabel, at.x, nameY, labelWidth);
        else ctx.fillText(playerLabel, at.x, nameY);
        ctx.fillStyle = "rgba(237,232,220,.82)";
        ctx.font = portrait ? "14px Inter, sans-serif" : "12px Inter, sans-serif";
        const stackLabel = `${money(p.stack)} 筹码`;
        if (sideSeat) ctx.fillText(stackLabel, at.x, nameY + 17, labelWidth);
        else ctx.fillText(stackLabel, at.x, nameY + 17);
        const tagBaseWidth = p.position.length > 3 ? (portrait ? 54 : 48) : 43;
        const tagW = tagBaseWidth * adjustX;
        const tagH = portrait ? 20 : 17;
        roundedRect(ctx, at.x - tagW / 2, nameY + 23, tagW, tagH, 7);
        ctx.fillStyle = p.position.includes("BTN") ? "#d2b66d" : "rgba(11,28,21,.86)";
        ctx.fill();
        ctx.fillStyle = p.position.includes("BTN") ? "#243026" : "#c5b995";
        ctx.font = portrait ? "700 12px Inter, sans-serif" : "700 10px Inter, sans-serif";
        ctx.fillText(p.position, at.x, nameY + (portrait ? 37 : 35));
        if (p.folded || p.allIn || p.eliminated) {
          ctx.fillStyle = p.eliminated ? "#c9a667" : p.allIn ? "#e8c779" : "#d4d0c7";
          ctx.font = portrait ? "700 12px Inter, sans-serif" : "700 10px Inter, sans-serif";
          const relativePosition = positions[relativeSeat(p.seat)];
          const statusOffset = portrait
            ? relativePosition === 2
              ? 57
              : relativePosition === 4 || relativePosition === 5
                ? 51
                : 54
            : 51;
          ctx.fillText(
            p.eliminated ? "OUT" : p.allIn ? "ALL IN" : "FOLDED",
            at.x,
            nameY + statusOffset,
          );
        }
        const cards: string[] = p.hole.length === 2 ? p.hole : p.folded ? [] : ["back", "back"];
        const baseCw = isMe ? (portrait ? 60 : 57) : portrait ? 46 : 43;
        const cw = baseCw * adjustX;
        const ch = baseCw * 1.392;
        const cgap = (portrait ? 6 : 5) * adjustX;
        const start = at.cardX - (cw * cards.length + cgap * Math.max(0, cards.length - 1)) / 2;
        for (let i = 0; i < cards.length; i++)
          drawCard(ctx, cards[i], start + i * (cw + cgap), at.cardY, cw, ch, images);
        ctx.restore();
      }
      const betColumns = count > 4 ? 2 : 1;
      const betRows = Math.ceil(count / betColumns);
      const betPanelWidth = portrait ? 164 : 192;
      const betPanelPadding = portrait ? 4 : 7;
      const betTitleHeight = portrait ? 11 : 15;
      const betRowHeight = portrait ? 11 : 15;
      const betPanelHeight = betPanelPadding * 2 + betTitleHeight + betRows * betRowHeight;
      const betPanelX = logicalWidth - betPanelWidth - (portrait ? 4 : 10);
      const betPanelY = portrait ? 1 : 132;
      ctx.save();
      roundedRect(ctx, betPanelX, betPanelY, betPanelWidth, betPanelHeight, 8);
      ctx.fillStyle = "rgba(7,18,13,.86)";
      ctx.fill();
      ctx.strokeStyle = "rgba(208,183,122,.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#d9c58a";
      ctx.font = portrait ? "700 8px Inter, sans-serif" : "700 10px Inter, sans-serif";
      ctx.fillText(
        "本轮下注",
        betPanelX + betPanelPadding,
        betPanelY + betPanelPadding + betTitleHeight / 2,
      );
      const betColumnGap = portrait ? 6 : 8;
      const betColumnWidth =
        (betPanelWidth - betPanelPadding * 2 - betColumnGap * (betColumns - 1)) / betColumns;
      const betFont = portrait ? "500 8px Inter, sans-serif" : "500 10px Inter, sans-serif";
      ctx.font = betFont;
      for (let index = 0; index < order.length; index++) {
        const player = order[index];
        const column = Math.floor(index / betRows);
        const row = index % betRows;
        const columnX = betPanelX + betPanelPadding + column * (betColumnWidth + betColumnGap);
        const textY = betPanelY + betPanelPadding + betTitleHeight + row * betRowHeight;
        const amount = money(player.streetBet);
        const amountWidth = Math.min(
          ctx.measureText(amount).width + 2,
          betColumnWidth * (betColumns === 1 ? 0.42 : 0.48),
        );
        const nameWidth = betColumnWidth - amountWidth - 5;
        const label = player.id === viewerId ? `${player.name}·你` : player.name;
        ctx.globalAlpha = player.folded || player.eliminated ? 0.58 : 1;
        ctx.font = betFont;
        ctx.fillStyle = "#e3e3d8";
        ctx.textAlign = "left";
        ctx.fillText(label, columnX, textY + betRowHeight / 2, nameWidth);
        ctx.fillStyle = "#e1ca8c";
        ctx.textAlign = "right";
        ctx.fillText(amount, columnX + betColumnWidth, textY + betRowHeight / 2, amountWidth);
      }
      ctx.restore();
      if (animating) frame = requestAnimationFrame(draw);
    };
    const load = () => {
      for (const card of [...board, ...players.flatMap((p) => p.hole)]) {
        if (!card || card === "back") continue;
        const src = cardImageUrl(card);
        if (images.has(src)) continue;
        const image = new Image();
        image.onload = () => redrawRef.current();
        image.src = src;
        images.set(src, image);
      }
      for (const p of players)
        if (p.avatar && !images.has(`avatar:${p.id}`)) {
          const image = new Image();
          image.onload = () => redrawRef.current();
          image.src = p.avatar;
          images.set(`avatar:${p.id}`, image);
        }
      redrawRef.current();
    };
    redrawRef.current = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(() => redrawRef.current());
    resize.observe(canvas);
    load();
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      redrawRef.current = () => {};
    };
  }, [signature]);
  return <canvas ref={canvasRef} className="table-canvas" aria-label="德州扑克房间牌桌" />;
}
