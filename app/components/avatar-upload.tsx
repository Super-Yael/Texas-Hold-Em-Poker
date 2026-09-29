"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, History, Plus } from "lucide-react";
import type { Profile } from "@/lib/table-types";
import Avatar from "./avatar";

export default function AvatarUpload({
  profile,
  onUpload,
  onError,
  disabled = false,
  showText = false,
  menuOnClick = false,
  onAccountHistory,
  className = "",
}: {
  profile: Profile;
  onUpload: (avatar: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  showText?: boolean;
  menuOnClick?: boolean;
  onAccountHistory?: () => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = menuOnClick || !!onAccountHistory;
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  const openPicker = () => {
    if (disabled) return;
    setMenuOpen(false);
    inputRef.current?.click();
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || file.size > 500 * 1024) {
      onError("头像请使用小于 500KB 的 PNG、JPG 或 WebP 图片");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onUpload(String(reader.result));
    reader.onerror = () => onError("读取头像失败，请重新选择图片");
    reader.readAsDataURL(file);
  };
  return (
    <div
      ref={rootRef}
      className={`avatar-upload-control ${showText ? "avatar-upload-with-text" : ""} ${className} ${disabled ? "avatar-upload-disabled" : ""}`}
    >
      <button
        type="button"
        className="avatar-upload-trigger"
        title={hasMenu ? "账号菜单" : profile.avatar ? "更改头像" : "添加头像"}
        aria-label={hasMenu ? "账号菜单" : profile.avatar ? "更改头像" : "添加头像"}
        aria-haspopup={hasMenu ? "menu" : undefined}
        aria-expanded={hasMenu ? menuOpen : undefined}
        disabled={disabled}
        onClick={hasMenu ? () => setMenuOpen((open) => !open) : openPicker}
      >
        <Avatar avatar={profile.avatar} nickname={profile.nickname} size="small" />
        {showText && <span>{hasMenu ? "账号" : profile.avatar ? "更换头像" : "添加头像"}</span>}
        <i>{hasMenu ? <ChevronDown size={12} /> : <Plus size={11} />}</i>
      </button>
      {hasMenu && menuOpen && (
        <div className="avatar-upload-menu" role="menu">
          {onAccountHistory && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onAccountHistory();
              }}
            >
              <History size={15} />
              账号历史记录
            </button>
          )}
          <button type="button" role="menuitem" onClick={openPicker}>
            <Plus size={15} />
            更改头像
          </button>
        </div>
      )}
      <input
        className="avatar-file-input"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        hidden
        onChange={handleChange}
      />
    </div>
  );
}
